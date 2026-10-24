-- Add shadow-gated statewide category streams for Kleinanzeigen, Immowelt, and Ohne-Makler.

ALTER TABLE app_private.source_category_streams DROP CONSTRAINT IF EXISTS source_category_streams_category_check;

ALTER TABLE app_private.source_category_streams ADD CONSTRAINT source_category_streams_category_check CHECK (category = ANY (ARRAY['apartment'::text,'house'::text,'room'::text,'swap'::text]));

CREATE OR REPLACE FUNCTION app_private.enqueue_due_source_jobs(p_limit integer DEFAULT 65)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r record;
  v_msg_id bigint;
  v_job_id uuid;
  v_count integer := 0;
begin
  for r in
    select s.id
    from public.sources s
    where s.enabled = true
      and s.runtime_mode = 'live'
      and (
        s.delivery_mode = 'live'
        or (
          s.delivery_mode = 'shadow'
          and (
            (
              s.id = 69
              and exists (
                select 1 from public.source_coverage_state coverage
                where coverage.source_id = s.id
              )
            )
            or (
              s.coverage_strategy = 'category_streams_only'
              and exists (
                select 1 from app_private.source_category_streams streams
                where streams.source_id = s.id
                  and streams.enabled = true
                  and streams.verified_at is not null
              )
            )
          )
        )
      )
      and not exists (
        select 1
        from public.source_jobs j
        where j.source_id = s.id
          and j.status in ('enqueued','processing','retry')
          and j.queue_msg_id is not null
      )
      and (
        s.last_checked_at is null
        or s.last_checked_at <= now() - make_interval(
          mins => least(
            60,
            greatest(1, s.poll_interval_minutes) *
            case
              when coalesce(s.consecutive_failures,0) <= 1 then 1
              when s.consecutive_failures = 2 then 2
              when s.consecutive_failures = 3 then 4
              when s.consecutive_failures = 4 then 8
              else 12
            end
          )
        )
      )
    order by
      coalesce(s.crawl_priority,2147483647),
      coalesce(s.last_checked_at,'-infinity'::timestamptz),
      s.id
    limit greatest(1,least(coalesce(p_limit,65),65))
    for update of s skip locked
  loop
    v_job_id := gen_random_uuid();

    select x into v_msg_id
    from pgmq.send(
      'source_jobs',
      jsonb_build_object(
        'job_id',v_job_id,
        'source_id',r.id,
        'worker','source-worker'
      )
    ) as x
    limit 1;

    insert into public.source_jobs(
      id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at
    )
    values(
      v_job_id,v_msg_id,r.id,'enqueued','source-worker',now(),now()
    );

    update public.sources
    set last_checked_at=now(),updated_at=now()
    where id=r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_source_category_streams(p_source_id smallint)
 RETURNS SETOF app_private.source_category_streams
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 with picked as(select c.source_id,c.category from app_private.source_category_streams c join public.sources s on s.id=c.source_id
 where c.source_id=p_source_id and c.enabled and c.verified_at is not null and s.enabled and s.runtime_mode='live' and (s.delivery_mode='live' or (s.delivery_mode='shadow' and s.coverage_strategy='category_streams_only'))
 and (c.lease_until is null or c.lease_until<now())
 and (c.last_started_at is null or c.last_started_at<now()-make_interval(mins=>least(60,c.poll_minutes*(1+least(c.failures,5)))))
 order by c.last_started_at nulls first,c.category limit 2 for update of c skip locked)
 update app_private.source_category_streams c set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',last_started_at=now()
 from picked p where c.source_id=p.source_id and c.category=p.category returning c.*;
$function$;

CREATE OR REPLACE FUNCTION public.finish_source_category_stream(p_source_id smallint, p_category text, p_token uuid, p_success boolean, p_cursor jsonb, p_requests integer, p_candidates integer, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n integer;
begin
 update app_private.source_category_streams set lease_token=null,lease_until=null,
  baseline_at=case when p_success then coalesce(baseline_at,now()) else baseline_at end,
  last_success_at=case when p_success then now() else last_success_at end,
  cursor=case when p_success then p_cursor else cursor end,
  failures=case when p_success then 0 else failures+1 end,last_error=case when p_success then null else left(p_error,600) end,
  request_count=request_count+greatest(0,p_requests),candidate_count=candidate_count+greatest(0,p_candidates)
 where source_id=p_source_id and category=p_category and lease_token=p_token and lease_until>now();
 get diagnostics n=row_count;
 if n=1 and p_success then
  update public.sources s
  set delivery_mode='live', baseline_completed_at=coalesce(s.baseline_completed_at,now()), coverage_status='partial', updated_at=now()
  where s.id=p_source_id and s.coverage_strategy='category_streams_only'
    and s.delivery_mode='shadow' and s.baseline_completed_at is null
    and exists (select 1 from app_private.source_category_streams c where c.source_id=s.id and c.enabled and c.verified_at is not null)
    and not exists (select 1 from app_private.source_category_streams c where c.source_id=s.id and c.enabled and c.verified_at is not null and (c.baseline_at is null or c.last_success_at is null or c.failures>0 or c.last_error is not null));
 end if;
 return n=1;
end $function$;

INSERT INTO public.sources (id,source_type,name,tier,homepage_url,search_url,poll_interval_minutes,enabled,notes,warmed_up,button_label,delivery_mode,worker_slug,listing_priority,crawl_priority,coverage_strategy,runtime_mode,coverage_status,baseline_completed_at,search_capabilities,updated_at) VALUES
(70,'Marketplace','Kleinanzeigen Schleswig-Holstein','K1','https://www.kleinanzeigen.de','https://www.kleinanzeigen.de/s-wohnung-mieten/schleswig-holstein/wohnungen--mieten/k0c203l408?sortingField=SORTING_DATE',60,true,'Separate Schleswig-Holstein category streams. Delivery remains shadow until each configured category has a successful baseline. This is a rolling current-listing window, not a complete historical inventory.',false,'Kleinanzeigen Schleswig-Holstein','shadow','source-worker',21,70,'category_streams_only','live','partial',NULL,'{"version":2,"evidence":"verified_category_stream","discovery":"public_search_or_inventory","offer_modes":["rent","swap"],"category_streams":["apartment","house","room","swap"],"configured_kinds":["apartment","house","room","swap"],"region_state_code":"SH","additional_kinds_require_evidence":true}'::jsonb,now()),
(71,'Immobilienportal','Immowelt Schleswig-Holstein','K1','https://www.immowelt.de','https://www.immowelt.de/suche/mieten/wohnung/schleswig-holstein/ad04de1/',60,true,'Separate Schleswig-Holstein apartment and house streams. Delivery remains shadow until each configured category has a successful baseline. This is a rolling current-listing window, not a complete historical inventory.',false,'Immowelt Schleswig-Holstein','shadow','source-worker',22,71,'category_streams_only','live','partial',NULL,'{"version":2,"evidence":"verified_category_stream","discovery":"public_search_or_inventory","offer_modes":["rent"],"category_streams":["apartment","house"],"configured_kinds":["apartment","house"],"region_state_code":"SH","additional_kinds_require_evidence":true}'::jsonb,now()),
(72,'Immobilienportal','Ohne-Makler Schleswig-Holstein','K1','https://www.ohne-makler.net','https://www.ohne-makler.net/immobilien/wohnung-mieten/schleswig-holstein/',60,true,'Separate Schleswig-Holstein apartment and house streams. Delivery remains shadow until each configured category has a successful baseline. This is a rolling current-listing window, not a complete historical inventory.',false,'Ohne-Makler Schleswig-Holstein','shadow','source-worker',23,72,'category_streams_only','live','partial',NULL,'{"version":2,"evidence":"verified_category_stream","discovery":"public_search_or_inventory","offer_modes":["rent"],"category_streams":["apartment","house"],"configured_kinds":["apartment","house"],"region_state_code":"SH","additional_kinds_require_evidence":true}'::jsonb,now())
ON CONFLICT (id) DO UPDATE SET
 source_type=EXCLUDED.source_type, name=EXCLUDED.name, tier=EXCLUDED.tier, homepage_url=EXCLUDED.homepage_url, search_url=EXCLUDED.search_url, poll_interval_minutes=EXCLUDED.poll_interval_minutes, enabled=EXCLUDED.enabled, notes=EXCLUDED.notes, button_label=EXCLUDED.button_label, worker_slug=EXCLUDED.worker_slug, listing_priority=EXCLUDED.listing_priority, crawl_priority=EXCLUDED.crawl_priority, coverage_strategy=EXCLUDED.coverage_strategy, runtime_mode=EXCLUDED.runtime_mode,
 coverage_status=CASE WHEN public.sources.baseline_completed_at IS NULL THEN 'partial' ELSE public.sources.coverage_status END,
 delivery_mode=CASE WHEN public.sources.baseline_completed_at IS NULL THEN 'shadow' ELSE public.sources.delivery_mode END,
 search_capabilities=EXCLUDED.search_capabilities, updated_at=now();

INSERT INTO app_private.source_category_streams AS current_streams (source_id,category,adapter,url,enabled,verified_at,poll_minutes) VALUES
(70,'apartment','kleinanzeigen','https://www.kleinanzeigen.de/s-wohnung-mieten/schleswig-holstein/wohnungen--mieten/k0c203l408?sortingField=SORTING_DATE',true,now(),60),
(70,'house','kleinanzeigen','https://www.kleinanzeigen.de/s-haus-mieten/schleswig-holstein/c205l408?sortingField=SORTING_DATE',true,now(),60),
(70,'room','kleinanzeigen','https://www.kleinanzeigen.de/s-auf-zeit-wg/schleswig-holstein/wg-zimmer/k0c199l408?sortingField=SORTING_DATE',true,now(),60),
(70,'swap','kleinanzeigen','https://www.kleinanzeigen.de/s-wohnung-mieten/schleswig-holstein/wohnungstausch-wohnung/k0c203l408?sortingField=SORTING_DATE',true,now(),60),
(71,'apartment','immowelt','https://www.immowelt.de/suche/mieten/wohnung/schleswig-holstein/ad04de1/',true,now(),60),
(71,'house','immowelt','https://www.immowelt.de/suche/mieten/haus/schleswig-holstein/ad04de1/',true,now(),60),
(72,'apartment','ohne-makler','https://www.ohne-makler.net/immobilien/wohnung-mieten/schleswig-holstein/',true,now(),60),
(72,'house','ohne-makler','https://www.ohne-makler.net/immobilien/haus-mieten/schleswig-holstein/',true,now(),60)
ON CONFLICT (source_id,category) DO UPDATE SET
 adapter=EXCLUDED.adapter, url=EXCLUDED.url, enabled=EXCLUDED.enabled, verified_at=coalesce(current_streams.verified_at,EXCLUDED.verified_at), poll_minutes=EXCLUDED.poll_minutes;

DO $validation$
BEGIN
  IF (SELECT count(*) FROM public.sources WHERE id IN (70,71,72) AND coverage_strategy='category_streams_only' AND delivery_mode='shadow' AND baseline_completed_at IS NULL AND search_capabilities->>'region_state_code'='SH') <> 3 THEN
    RAISE EXCEPTION 'Schleswig-Holstein category-only sources are not staged safely';
  END IF;
  IF (SELECT count(*) FROM app_private.source_category_streams WHERE source_id=70 AND enabled AND verified_at IS NOT NULL) <> 4 THEN
    RAISE EXCEPTION 'Kleinanzeigen Schleswig-Holstein must have four verified categories';
  END IF;
  IF (SELECT count(*) FROM app_private.source_category_streams WHERE source_id=71 AND enabled AND verified_at IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'Immowelt Schleswig-Holstein must have two verified categories';
  END IF;
  IF (SELECT count(*) FROM app_private.source_category_streams WHERE source_id=72 AND enabled AND verified_at IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'Ohne-Makler Schleswig-Holstein must have two verified categories';
  END IF;
END;
$validation$;
