create or replace function app_private.process_partial_coop_provider_checks()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  b record;
  v_block text;
  v_plain text;
  v_external_id text;
  v_mirror public.listings%rowtype;
  v_source public.sources%rowtype;
  v_key text;
  v_exists boolean;
  v_matched integer;
  v_inserted integer;
  v_processed integer := 0;
  v_retry_request_id bigint;
begin
  for r in
    select q.id,q.source_id,q.query_kind,q.request_id,q.requested_at,q.error as request_state,
           c.needle,c.query_url,h.status_code,h.timed_out,h.error_msg,h.content
    from app_private.coop_provider_index_requests q
    join app_private.coop_provider_query_config() c
      on c.source_id=q.source_id and c.query_kind=q.query_kind
    join net._http_response h on h.id=q.request_id
    where q.processed_at is null
    order by q.requested_at
    limit 40
  loop
    v_matched := 0;
    v_inserted := 0;

    if coalesce(r.timed_out,false) or r.error_msg is not null then
      if coalesce(r.request_state,'') <> 'retrying_once' then
        select net.http_get(url := r.query_url, timeout_milliseconds := 15000)
          into v_retry_request_id;
        update app_private.coop_provider_index_requests
        set request_id=v_retry_request_id,
            requested_at=now(),
            status_code=r.status_code,
            error='retrying_once'
        where id=r.id;
        continue;
      end if;

      update app_private.coop_provider_index_requests
      set processed_at=now(),status_code=r.status_code,
          error=left(coalesce(r.error_msg,'transport failure'),1000)
      where id=r.id;
      v_processed := v_processed + 1;
      continue;
    end if;

    if r.status_code is distinct from 200 then
      update app_private.coop_provider_index_requests
      set processed_at=now(),status_code=r.status_code,
          error=left('HTTP '||coalesce(r.status_code::text,'unknown'),1000)
      where id=r.id;
      v_processed := v_processed + 1;
      continue;
    end if;

    select * into v_source from public.sources where id=r.source_id;
    if not found then
      update app_private.coop_provider_index_requests set processed_at=now(),status_code=r.status_code,error='source missing' where id=r.id;
      v_processed := v_processed + 1;
      continue;
    end if;

    update public.sources
    set last_success_at=now(),updated_at=now()
    where id=r.source_id;

    for b in
      select x[1] as block
      from regexp_matches(r.content,'(<li><div class="dd algo[\s\S]*?</li>)','gi') x
    loop
      v_block := lower(b.block);
      v_plain := lower(regexp_replace(b.block,'<[^>]+>',' ','g'));
      if v_block not like '%'||r.needle||'%'
         or v_plain not like '%hamburg%'
         or v_plain !~ '(wohnung|apartment|appartement|mietwohnung)'
         or v_plain !~ '(miete|vermiet|mietwohnung)'
      then
        continue;
      end if;

      v_external_id := null;
      v_mirror := null;
      if r.query_kind='immoscout' then
        v_external_id := coalesce(
          (regexp_match(v_block,'immobilienscout24\.de%2fexpose%2f([0-9]+)'))[1],
          (regexp_match(v_block,'immobilienscout24\.de/expose/([0-9]+)'))[1]
        );
        if v_external_id is not null then
          select l.* into v_mirror
          from public.listings l
          where l.source_id=1 and l.is_active=true and l.quality_status<>'rejected'
            and l.canonical_url ~ ('/expose/'||v_external_id||'([/?#]|$)')
          order by l.fresh_delivery_eligible desc,l.last_seen_at desc
          limit 1;
        end if;
      else
        v_external_id := coalesce(
          (regexp_match(v_block,'immowelt\.de%2fexpose%2f([a-f0-9-]{36})'))[1],
          (regexp_match(v_block,'immowelt\.de/expose/([a-f0-9-]{36})'))[1]
        );
        if v_external_id is not null then
          select l.* into v_mirror
          from public.listings l
          where l.source_id=3 and l.is_active=true and l.quality_status<>'rejected'
            and lower(l.canonical_url) ~ ('/expose/'||v_external_id||'([/?#]|$)')
          order by l.fresh_delivery_eligible desc,l.last_seen_at desc
          limit 1;
        end if;
      end if;

      if v_external_id is null or v_mirror.id is null then
        continue;
      end if;
      if v_mirror.last_seen_at < now()-interval '2 hours'
         or v_source.baseline_completed_at is null
         or v_mirror.first_seen_at < v_source.baseline_completed_at
         or now()-v_mirror.first_seen_at > interval '24 hours'
      then
        continue;
      end if;

      v_matched := v_matched + 1;
      v_key := 'provider-index:'||r.query_kind||':'||v_external_id;
      select exists(select 1 from public.listings where source_id=r.source_id and source_listing_key=v_key) into v_exists;

      if not v_exists then
        insert into public.listings(
          source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,
          warm_rent,cold_rent,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,
          first_seen_at,last_seen_at,is_active,heating_costs,additional_costs,operating_costs,deposit,deposit_text,
          resolved_image_url,image_source,image_status,image_last_checked_at,image_error,
          enrichment_status,enrichment_checked_at,enrichment_error,enrichment_evidence,field_conflicts,enrichment_delivery_eligible,
          quality_status,quality_reason,warm_rent_is_calculated,fresh_delivery_eligible,latitude,longitude
        ) values (
          r.source_id,v_key,v_external_id,v_mirror.canonical_url,v_mirror.title,v_mirror.address,v_mirror.district,v_mirror.postal_code,v_mirror.city,
          v_mirror.warm_rent,v_mirror.cold_rent,v_mirror.rooms,v_mirror.area_sqm,v_mirror.available_from,v_mirror.property_type,v_mirror.furnished,v_mirror.wbs_required,v_mirror.image_url,v_mirror.cross_source_hash,
          coalesce(v_mirror.raw,'{}'::jsonb)||jsonb_build_object('provider_index',jsonb_build_object('verified',true,'query_kind',r.query_kind,'mirror_source_id',v_mirror.source_id,'mirror_listing_id',v_mirror.id,'verified_at',now())),
          now(),now(),true,v_mirror.heating_costs,v_mirror.additional_costs,v_mirror.operating_costs,v_mirror.deposit,v_mirror.deposit_text,
          v_mirror.resolved_image_url,v_mirror.image_source,v_mirror.image_status,v_mirror.image_last_checked_at,v_mirror.image_error,
          v_mirror.enrichment_status,v_mirror.enrichment_checked_at,v_mirror.enrichment_error,v_mirror.enrichment_evidence,v_mirror.field_conflicts,v_mirror.enrichment_delivery_eligible,
          v_mirror.quality_status,v_mirror.quality_reason,v_mirror.warm_rent_is_calculated,true,v_mirror.latitude,v_mirror.longitude
        );
        v_inserted := v_inserted + 1;
      else
        update public.listings
        set last_seen_at=now(),is_active=true
        where source_id=r.source_id and source_listing_key=v_key;
      end if;
    end loop;

    update app_private.coop_provider_index_requests
    set processed_at=now(),status_code=r.status_code,matched_count=v_matched,inserted_count=v_inserted,error=null
    where id=r.id;

    update public.listings p
    set is_active=false
    where p.source_id=r.source_id and p.is_active=true and p.raw ? 'provider_index'
      and not exists (
        select 1 from public.listings m
        where m.id=(p.raw->'provider_index'->>'mirror_listing_id')::uuid
          and m.is_active=true and m.last_seen_at >= now()-interval '2 hours'
      );

    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end;
$$;
