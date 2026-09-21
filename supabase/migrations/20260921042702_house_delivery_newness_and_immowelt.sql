
create or replace function app_private.delivery_newness_qualified(
  p_listing_id uuid,
  p_as_of timestamptz default now()
)
returns boolean
language plpgsql
stable
set search_path=''
as $function$
declare
  l public.listings%rowtype;
  c app_private.source_category_streams%rowtype;
  published timestamptz;
  proof jsonb;
begin
  select * into l from public.listings where id=p_listing_id;
  if not found then return false; end if;

  if l.raw ? 'category_stream' then
    select * into c
    from app_private.source_category_streams
    where source_id=l.source_id
      and category=l.raw->>'category_stream';

    if not found
       or not c.enabled
       or c.verified_at is null
       or c.baseline_at is null
       or not coalesce(l.fresh_delivery_eligible,false)
       or l.first_seen_at<c.baseline_at
       or l.first_seen_at<p_as_of-interval '24 hours'
       or l.first_seen_at>p_as_of+interval '5 minutes'
    then
      return false;
    end if;

    proof:=l.raw->'_newness';

    if proof->>'method'='source_timestamp' then
      begin
        published:=(proof->>'source_published_at')::timestamptz;
      exception when others then
        return false;
      end;

    elsif proof->>'method'='complete_snapshot_delta'
          and proof->>'previous_complete_at' is not null then
      begin
        published:=(proof->>'previous_complete_at')::timestamptz;
      exception when others then
        return false;
      end;
      if published<c.baseline_at or l.first_seen_at<published then
        return false;
      end if;

    elsif proof->>'method'='poll_delta'
          and proof->>'previous_success_at' is not null then
      begin
        published:=(proof->>'previous_success_at')::timestamptz;
      exception when others then
        return false;
      end;
      if published<c.baseline_at or l.first_seen_at<published then
        return false;
      end if;

    else
      return false;
    end if;

    return coalesce(
      published>=p_as_of-interval '24 hours'
      and published<=p_as_of+interval '5 minutes',
      false
    );
  end if;

  return app_private.delivery_newness_qualified_legacy(p_listing_id,p_as_of);
end
$function$;

insert into app_private.source_category_streams(
  source_id,category,adapter,url,enabled,verified_at,poll_minutes
)
values(
  3,
  'house',
  'immowelt',
  'https://www.immowelt.de/suche/mieten/haus/hamburg/hamburg-20095/ad08de1113/',
  true,
  now(),
  5
)
on conflict(source_id,category) do update
set adapter=excluded.adapter,
    url=excluded.url,
    enabled=true,
    verified_at=coalesce(app_private.source_category_streams.verified_at,excluded.verified_at),
    poll_minutes=5;

update public.sources
set search_capabilities=
  jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(search_capabilities,'{}'::jsonb),
        '{version}',
        '2'::jsonb,
        true
      ),
      '{configured_kinds}',
      '["apartment","house"]'::jsonb,
      true
    ),
    '{category_streams}',
    '["house"]'::jsonb,
    true
  ) || jsonb_build_object('evidence','verified_category_stream'),
    updated_at=now()
where id=3;

update public.listings
set raw=jsonb_set(
  coalesce(raw,'{}'::jsonb),
  '{_classification}',
  jsonb_build_object(
    'version',1,
    'kind','house',
    'mode',
    case
      when coalesce(title,'') ~* '(erbpacht|zum kauf|kaufpreis|zu verkaufen|verkauf|mietkauf)' then 'sale'
      when coalesce(title,'') ~* '(mitbewohner(in)? gesucht|^[[:space:]]*(tauschwohnung[: -]*)?suche[[:space:]])' then 'wanted'
      when coalesce(title,'') ~* '(tauschwohnung|tauschangebot|wohnungstausch|[[:<:]]tausche[[:>:]])' then 'swap'
      else coalesce(offer_mode,'rent')
    end
  ),
  true
)
where raw->>'category_stream'='house'
  and (
    coalesce(title,'') ~* '(erbpacht|zum kauf|kaufpreis|zu verkaufen|verkauf|mietkauf)'
    or coalesce(title,'') ~* '(mitbewohner(in)? gesucht|^[[:space:]]*(tauschwohnung[: -]*)?suche[[:space:]])'
    or (
      coalesce(title,'') ~* '(tauschwohnung|tauschangebot|wohnungstausch|[[:<:]]tausche[[:>:]])'
      and coalesce(offer_mode,'rent')<>'swap'
    )
  );
