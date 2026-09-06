CREATE OR REPLACE FUNCTION app_private.current_listing_is_delivery_fresh(p_source_id bigint, p_raw jsonb, p_requested boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_source public.sources%rowtype; v_live_connector_count integer:=0; v_primary_enumerable boolean:=false; v_primary_newest_first boolean:=false; v_primary_adapter text:=''; v_lane text:=lower(coalesce(p_raw->>'delivery_lane',''));
begin
  select * into v_source from public.sources s where s.id=p_source_id;
  if not found or not coalesce(v_source.enabled,false) or v_source.runtime_mode<>'live' or v_source.delivery_mode<>'live' or v_source.baseline_completed_at is null or v_source.last_success_at is null or v_source.last_success_at<now()-interval '2 hours' then return false; end if;
  if p_source_id=5 then p_requested:=true; end if; if not coalesce(p_requested,false) then return false; end if;
  select count(*) into v_live_connector_count from public.source_connectors c where c.source_id=p_source_id and c.enabled=true and coalesce(c.shadow_only,false)=false;
  select coalesce(c.enumerable,false),lower(coalesce(c.config->>'freshness_mode',''))='newest_first',coalesce(c.config->>'adapter','') into v_primary_enumerable,v_primary_newest_first,v_primary_adapter from public.source_connectors c where c.source_id=p_source_id and c.enabled=true and coalesce(c.shadow_only,false)=false order by c.priority limit 1;
  if p_source_id=1 then return lower(coalesce(p_raw->>'provider',''))='immoscout_mcp' and (v_lane in ('fresh','fresh_global','fresh_borough') or (v_lane='' and lower(coalesce(p_raw->>'query','')) like '%neueste inserate%'));
  elsif p_source_id=2 then return coalesce(p_raw->>'lane','')='fast';
  elsif p_source_id=3 then return lower(coalesce(p_raw->>'is_new','false'))='true';
  elsif p_source_id=5 then return true;
  elsif p_source_id=8 then return lower(coalesce(p_raw->>'provider',''))='grand_city_property' and exists(select 1 from public.source_connectors c where c.source_id=8 and c.priority=1 and c.enabled=true and coalesce(c.shadow_only,false)=false and coalesce(c.config->>'adapter','')='source-worker/gcp');
  elsif p_source_id=9 then return v_primary_adapter='source-worker/housinganywhere' and lower(coalesce(p_raw->>'provider',''))='housinganywhere' and lower(coalesce(p_raw->>'native_new','false'))='true';
  elsif p_source_id in (10,17,21) then return
    v_primary_adapter=case p_source_id when 10 then 'source-worker/wunder-catalog' when 17 then 'source-worker/city-catalog' else 'source-worker/swap-catalog' end
    and coalesce(p_raw->>'provider','')=case p_source_id when 10 then 'wunderflats_catalog' when 17 then 'city_wohnen_catalog' else 'tauschwohnung_catalog' end
    and coalesce(p_raw->>'catalog_baseline_verified','false')='true'
    and exists(select 1 from public.source_coverage_state st join public.source_connectors c on c.source_id=st.source_id and c.priority=1
      where st.source_id=p_source_id and st.cursor->>'adapter'=v_primary_adapter and st.cursor->>'url'=c.config->>'url'
      and st.cursor->>'baseline_done'='true');
  elsif p_source_id=12 then return v_primary_adapter='source-worker/ohne-makler' and lower(coalesce(p_raw->>'provider',''))='ohne_makler' and lower(coalesce(p_raw->>'monotonic_new','false'))='true';
  elsif p_source_id=19 then return v_primary_adapter='source-worker/nestpick-public' and lower(coalesce(p_raw->>'provider',''))='nestpick_public_api' and lower(coalesce(p_raw->>'native_new','false'))='true';
  elsif p_source_id=20 then return v_primary_adapter='source-worker/covivio' and lower(coalesce(p_raw->>'provider',''))='covivio' and lower(coalesce(p_raw->>'discovery_lane',''))='official_sitemap' and nullif(p_raw->>'lastmod','') is not null and (p_raw->>'lastmod')::timestamptz>v_source.baseline_completed_at;
  elsif p_source_id=22 then return v_primary_adapter='source-worker/wohnungsswap' and lower(coalesce(p_raw->>'provider',''))='wohnungsswap' and nullif(p_raw->>'published_at','') is not null and (p_raw->>'published_at')::timestamptz>v_source.baseline_completed_at;
  elsif p_source_id in (40,44,45,55) then return lower(coalesce(p_raw->'provider_index'->>'verified','false'))='true' and coalesce(p_raw->'provider_index'->>'mirror_source_id','') in ('1','3'); end if;
  if v_primary_newest_first then return true; end if;
  if v_source.coverage_strategy='tenant_api' and v_primary_enumerable and v_source.coverage_status='complete' then return true; end if;
  if v_live_connector_count=1 and v_primary_enumerable and v_source.coverage_status='complete' then return true; end if;
  return false;
end $function$
;
