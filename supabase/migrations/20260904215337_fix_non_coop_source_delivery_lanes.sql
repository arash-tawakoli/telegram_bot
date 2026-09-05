-- Non-cooperative/non-housing-cooperative source fixes.
-- Existing listings are never promoted: guard_current_listing_delivery keeps freshness immutable on UPDATE.

update public.source_connectors
set label='HousingAnywhere current Hamburg search (Primary)',
    connector_kind='html_discovery', enumerable=false, enabled=true, shadow_only=false,
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'role','primary','adapter','source-worker/housinganywhere','freshness_mode','native_new'
    )
where source_id=9 and priority=1;
update public.source_connectors set shadow_only=true where source_id=9 and priority>1;

update public.source_connectors
set label='Ohne-Makler Hamburg current inventory (Primary)',
    connector_kind='html_discovery', enumerable=false, enabled=true, shadow_only=false,
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'role','primary','adapter','source-worker/ohne-makler','freshness_mode','monotonic_new_id',
      'fresh_id_floor',coalesce((select max(source_listing_key::bigint) from public.listings where source_id=12 and source_listing_key ~ '^\d+$'),0)
    )
where source_id=12 and priority=1;
update public.source_connectors set shadow_only=true where source_id=12 and priority>1;

update public.source_connectors
set label='Covivio official Hamburg search (Primary)',
    connector_kind='html_discovery', enumerable=false, enabled=true, shadow_only=false,
    config=jsonb_build_object(
      'role','primary','adapter','source-worker/covivio','url','https://www.covivio.immo/wohnen/immobilie-finden/'
    )
where source_id=20 and priority=1;
update public.source_connectors
set label='Covivio official-detail public index (Fallback 1)',
    connector_kind='indexed_html', enumerable=false, enabled=true, shadow_only=false,
    config=jsonb_build_object(
      'role','fallback_1','adapter','source-worker/covivio-index','query','site:covivio.immo/objekt/hamburg/ Covivio Wohnung Hamburg'
    )
where source_id=20 and priority=2;
update public.source_connectors set shadow_only=true where source_id=20 and priority>2;

update public.source_connectors
set label='Wohnungsswap official current site (Primary)',
    connector_kind='html_discovery', enumerable=false, enabled=true, shadow_only=false,
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'role','primary','adapter','source-worker/wohnungsswap'
    )
where source_id=22 and priority=1;
update public.source_connectors
set label='Wohnungsswap public detail index (Fallback 1)',
    connector_kind='indexed_html', enumerable=false, enabled=true, shadow_only=false,
    config=jsonb_build_object(
      'role','fallback_1','adapter','source-worker/wohnungsswap-index','query','site:wohnungsswap.de/tauschangebot/ Hamburg Wohnungsswap'
    )
where source_id=22 and priority=2;
update public.source_connectors set shadow_only=true where source_id=22 and priority>2;

create or replace function app_private.current_listing_is_delivery_fresh(
  p_source_id bigint,
  p_raw jsonb,
  p_requested boolean
) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_source public.sources%rowtype;
  v_live_connector_count integer := 0;
  v_primary_enumerable boolean := false;
  v_primary_newest_first boolean := false;
  v_primary_adapter text := '';
  v_lane text := lower(coalesce(p_raw->>'delivery_lane',''));
begin
  select * into v_source from public.sources s where s.id = p_source_id;
  if not found
    or not coalesce(v_source.enabled,false)
    or v_source.runtime_mode <> 'live'
    or v_source.delivery_mode <> 'live'
    or v_source.baseline_completed_at is null
    or v_source.last_success_at is null
    or v_source.last_success_at < now() - interval '2 hours'
  then
    return false;
  end if;

  if p_source_id = 5 then p_requested := true; end if;
  if not coalesce(p_requested,false) then return false; end if;

  select count(*) into v_live_connector_count
  from public.source_connectors c
  where c.source_id = p_source_id
    and c.enabled = true
    and coalesce(c.shadow_only,false) = false;

  select coalesce(c.enumerable,false),
         lower(coalesce(c.config->>'freshness_mode','')) = 'newest_first',
         coalesce(c.config->>'adapter','')
    into v_primary_enumerable, v_primary_newest_first, v_primary_adapter
  from public.source_connectors c
  where c.source_id = p_source_id
    and c.enabled = true
    and coalesce(c.shadow_only,false) = false
  order by c.priority
  limit 1;

  if p_source_id = 1 then
    return lower(coalesce(p_raw->>'provider','')) = 'immoscout_mcp'
      and (v_lane in ('fresh','fresh_global','fresh_borough')
        or (v_lane = '' and lower(coalesce(p_raw->>'query','')) like '%neueste inserate%'));
  elsif p_source_id = 2 then
    return coalesce(p_raw->>'lane','') = 'fast';
  elsif p_source_id = 3 then
    return lower(coalesce(p_raw->>'is_new','false')) = 'true';
  elsif p_source_id = 5 then
    return true;
  elsif p_source_id = 8 then
    return lower(coalesce(p_raw->>'provider','')) = 'grand_city_property'
      and exists (
        select 1 from public.source_connectors c
        where c.source_id = 8 and c.priority = 1 and c.enabled = true
          and coalesce(c.shadow_only,false) = false
          and coalesce(c.config->>'adapter','') = 'source-worker/gcp'
      );
  elsif p_source_id = 9 then
    return v_primary_adapter = 'source-worker/housinganywhere'
      and lower(coalesce(p_raw->>'provider','')) = 'housinganywhere'
      and lower(coalesce(p_raw->>'native_new','false')) = 'true';
  elsif p_source_id = 12 then
    return v_primary_adapter = 'source-worker/ohne-makler'
      and lower(coalesce(p_raw->>'provider','')) = 'ohne_makler'
      and lower(coalesce(p_raw->>'monotonic_new','false')) = 'true';
  elsif p_source_id = 20 then
    return v_primary_adapter = 'source-worker/covivio'
      and lower(coalesce(p_raw->>'provider','')) = 'covivio';
  elsif p_source_id = 22 then
    return v_primary_adapter = 'source-worker/wohnungsswap'
      and lower(coalesce(p_raw->>'provider','')) = 'wohnungsswap'
      and nullif(p_raw->>'published_at','') is not null
      and (p_raw->>'published_at')::timestamptz > v_source.baseline_completed_at;
  elsif p_source_id in (40,44,45,55) then
    return lower(coalesce(p_raw->'provider_index'->>'verified','false')) = 'true'
      and coalesce(p_raw->'provider_index'->>'mirror_source_id','') in ('1','3');
  end if;

  if v_primary_newest_first then return true; end if;
  if v_source.coverage_strategy = 'tenant_api'
    and v_primary_enumerable
    and v_source.coverage_status = 'complete'
  then return true; end if;
  if v_live_connector_count = 1
    and v_primary_enumerable
    and v_source.coverage_status = 'complete'
  then return true; end if;
  return false;
end
$$;
