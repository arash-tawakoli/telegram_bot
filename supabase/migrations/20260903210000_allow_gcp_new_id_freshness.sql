create or replace function app_private.current_listing_is_delivery_fresh(
  p_source_id bigint,
  p_raw jsonb,
  p_requested boolean
)
returns boolean
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_source public.sources%rowtype;
  v_live_connector_count integer := 0;
  v_primary_enumerable boolean := false;
  v_primary_newest_first boolean := false;
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
         lower(coalesce(c.config->>'freshness_mode','')) = 'newest_first'
    into v_primary_enumerable, v_primary_newest_first
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
        select 1
        from public.source_connectors c
        where c.source_id = 8
          and c.priority = 1
          and c.enabled = true
          and coalesce(c.shadow_only,false) = false
          and coalesce(c.config->>'adapter','') = 'source-worker/gcp'
      );
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
$function$;
