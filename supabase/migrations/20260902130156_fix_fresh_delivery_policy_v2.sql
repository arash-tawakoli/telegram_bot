create or replace function app_private.current_listing_is_delivery_fresh(p_source_id bigint, p_raw jsonb, p_requested boolean)
returns boolean language plpgsql stable set search_path to '' as $$
declare v_source public.sources%rowtype; v_live_connector_count integer:=0; v_primary_enumerable boolean:=false; v_primary_newest_first boolean:=false; v_lane text:=lower(coalesce(p_raw->>'delivery_lane',''));
begin
 select * into v_source from public.sources s where s.id=p_source_id;
 if not found or not coalesce(v_source.enabled,false) or v_source.runtime_mode<>'live' or v_source.delivery_mode<>'live' or v_source.baseline_completed_at is null or v_source.last_success_at is null or v_source.last_success_at<now()-interval '2 hours' then return false; end if;
 if p_source_id=5 then p_requested:=true; end if; if not coalesce(p_requested,false) then return false; end if;
 select count(*) into v_live_connector_count from public.source_connectors c where c.source_id=p_source_id and c.enabled=true and coalesce(c.shadow_only,false)=false;
 select coalesce(c.enumerable,false),lower(coalesce(c.config->>'freshness_mode',''))='newest_first' into v_primary_enumerable,v_primary_newest_first from public.source_connectors c where c.source_id=p_source_id and c.enabled=true and coalesce(c.shadow_only,false)=false order by c.priority limit 1;
 if p_source_id=1 then return lower(coalesce(p_raw->>'provider',''))='immoscout_mcp' and (v_lane in ('fresh','fresh_global','fresh_borough') or (v_lane='' and lower(coalesce(p_raw->>'query','')) like '%neueste inserate%'));
 elsif p_source_id=2 then return coalesce(p_raw->>'lane','')='fast'; elsif p_source_id=3 then return lower(coalesce(p_raw->>'is_new','false'))='true'; elsif p_source_id=5 then return true; end if;
 if v_primary_newest_first then return true; end if;
 if v_source.coverage_strategy='tenant_api' and v_primary_enumerable and v_source.coverage_status='complete' then return true; end if;
 if v_live_connector_count=1 and v_primary_enumerable and v_source.coverage_status='complete' then return true; end if; return false;
end $$;

create or replace function app_private.enforce_current_source_freshness()
returns trigger language plpgsql set search_path to '' as $$
declare v_preserve_fresh boolean:=false; v_lane text:=lower(coalesce(new.raw->>'delivery_lane',''));
begin
 if not coalesce(new.fresh_delivery_eligible,false) then return new; end if;
 if tg_op='UPDATE' then
   v_preserve_fresh:=coalesce(old.fresh_delivery_eligible,false) and (lower(coalesce(old.raw->>'delivery_lane','')) in ('fresh','fresh_global','fresh_borough') or (old.source_id=1 and lower(coalesce(old.raw->>'query','')) like '%neueste inserate%') or (old.source_id=2 and coalesce(old.raw->>'lane','')='fast') or (old.source_id=3 and lower(coalesce(old.raw->>'is_new','false'))='true'));
 end if;
 if new.source_id=1 then
   if v_lane in ('fresh','fresh_global','fresh_borough') or (v_lane='' and lower(coalesce(new.raw->>'query','')) like '%neueste inserate%') or v_preserve_fresh then
     if v_lane='' then new.raw:=coalesce(new.raw,'{}'::jsonb)||jsonb_build_object('delivery_lane','fresh'); end if;
   else new.fresh_delivery_eligible:=false; end if;
 elsif new.source_id=2 then
   if coalesce(new.raw->>'lane','')='fast' or v_preserve_fresh then new.raw:=coalesce(new.raw,'{}'::jsonb)||jsonb_build_object('delivery_lane','fresh'); else new.fresh_delivery_eligible:=false; end if;
 elsif new.source_id=3 then
   if lower(coalesce(new.raw->>'is_new','false'))='true' or v_preserve_fresh then new.raw:=coalesce(new.raw,'{}'::jsonb)||jsonb_build_object('delivery_lane','fresh'); else new.fresh_delivery_eligible:=false; end if;
 end if; return new;
end $$;

create or replace function app_private.queue_listing_delivery_v3()
returns trigger language plpgsql set search_path to '' as $$
declare v_group uuid; v_primary boolean; v_source_ready boolean; v_source_type text; v_haystack text:=lower(concat_ws(' ',new.property_type,new.title,new.district,new.address,new.raw::text));
begin
 if new.quality_status='rejected' or not coalesce(new.enrichment_delivery_eligible,true) or not coalesce(new.fresh_delivery_eligible,false) then return new; end if;
 if v_haystack ~ '(^|[[:space:]])(ich|wir)[[:space:]]+suche(n)?[[:space:]].{0,40}(wohnung|apartment|wg-zimmer|zimmer|haus)' or v_haystack ~ '[[:space:]]sucht[[:space:]]+(dringend[[:space:]]+)?(eine[nr]?[[:space:]]+)?(wohnung|apartment|wg-zimmer|zimmer|haus)' or v_haystack ~ '^[[:space:]]*(wohnung|apartment|wg-zimmer|zimmer|haus)[[:space:]]+gesucht' then return new; end if;
 select (s.enabled and s.runtime_mode='live' and s.delivery_mode='live'),s.source_type into v_source_ready,v_source_type from public.sources s where s.id=new.source_id;
 if not coalesce(v_source_ready,false) then perform app_private.assign_listing_dedupe(new.id); return new; end if;
 v_group:=app_private.assign_listing_dedupe(new.id); select l.is_primary_listing into v_primary from public.listings l where l.id=new.id; if not coalesce(v_primary,false) or v_group is null then return new; end if;
 insert into public.delivery_events(profile_id,listing_id,dedupe_key,status,delivery_format,recipient_user_id,next_retry_at)
 select p.id,new.id,'group:'||v_group::text,'pending','photo_card',p.user_id,null
 from public.search_profiles p join public.bot_users owner_user on owner_user.id=p.user_id and owner_user.is_active=true
 where p.is_active=true and (p.profile_slot=1 or app_private.user_is_premium(p.user_id))
 and (coalesce(cardinality(p.property_types),0)=0 or (v_haystack ~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)' and 'Tauschwohnung'=any(p.property_types)) or (v_haystack !~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)' and coalesce(new.property_type,'Wohnung')=any(p.property_types)))
 and (p.max_warm_rent is null or (coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0)) is not null and coalesce(nullif(new.warm_rent,0),nullif(new.cold_rent,0))<=p.max_warm_rent)) and (not p.require_known_warm_rent or coalesce(new.warm_rent,0)>0)
 and (p.max_deposit is null or new.deposit is null or new.deposit<=p.max_deposit) and (not p.wbs_only or new.wbs_required is true) and (p.furnished_preference='any' or (p.furnished_preference='yes' and new.furnished is true) or (p.furnished_preference='no' and new.furnished is false))
 and (coalesce(p.min_rooms,0)<=0 or new.rooms is null or new.rooms>=p.min_rooms) and (coalesce(p.min_area_sqm,0)<=0 or new.area_sqm is null or new.area_sqm>=p.min_area_sqm)
 and (p.location_mode='all_hamburg' or (p.location_mode='boroughs' and coalesce(cardinality(p.boroughs),0)>=7) or (p.location_mode='neighborhoods' and exists(select 1 from unnest(p.neighborhoods) n where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(n)||'%')) or (p.location_mode='boroughs' and exists(select 1 from public.hamburg_neighborhoods hn join public.hamburg_boroughs hb on hb.id=hn.borough_id where hb.name=any(p.boroughs) and lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(hn.name)||'%')) or (coalesce(cardinality(p.districts),0)>0 and ('Ganz Hamburg'=any(p.districts) or exists(select 1 from unnest(p.districts) d where lower(concat_ws(' ',new.district,new.address,new.title,new.raw::text)) like '%'||lower(d)||'%'))))
 on conflict do nothing; return new;
end $$;
update public.sources set coverage_status='partial',updated_at=now() where id=1;
update public.delivery_events de set next_retry_at=null from public.listings l where de.listing_id=l.id and de.status='pending' and coalesce(de.dispatch_attempts,0)=0 and de.error_message is null and de.next_retry_at is not null and abs(extract(epoch from (de.next_retry_at-(l.first_seen_at+interval '2 hours'))))<=5;
