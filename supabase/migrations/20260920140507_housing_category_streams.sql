set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.listings add column property_kind text check(property_kind in ('apartment','house','room','unknown'));
alter table public.listings add column offer_mode text check(offer_mode in ('rent','swap','sale','wanted','unknown'));
alter table public.search_profiles add column min_room_area_sqm numeric not null default 0 check(min_room_area_sqm between 0 and 300);
alter table public.sources add column search_capabilities jsonb not null default '{}'::jsonb check(jsonb_typeof(search_capabilities)='object');

-- Metadata describes configured search paths, not a promise of active inventory.
update public.sources s set search_capabilities=jsonb_build_object(
 'version',1,
 'configured_kinds',case when s.id in (19) then jsonb_build_array('apartment','room') when s.id in (21,22) then jsonb_build_array('apartment') when s.id in (18,31,44,45,49,51,54,55,56,57,59,60,62,63,64) then '[]'::jsonb else jsonb_build_array('apartment') end,
 'offer_modes',case when s.id in (21,22) then jsonb_build_array('swap') else jsonb_build_array('rent') end,
 'evidence','configured_adapter_scope',
 'discovery',case when s.id in (44,45,55,56,60) then 'registration_only' when not s.enabled or s.runtime_mode<>'live' then 'not_live' else 'public_search_or_inventory' end,
 'additional_kinds_require_evidence',true
);

create or replace function app_private.apply_property_classification()
returns trigger language plpgsql set search_path='' as $fn$
declare c jsonb:=new.raw->'_classification';
begin
 if tg_op='UPDATE' and old.raw?'category_stream' and not new.raw?'category_stream' then
  new.raw:=new.raw||jsonb_build_object('category_stream',old.raw->'category_stream','_newness',old.raw->'_newness');
  new.fresh_delivery_eligible:=old.fresh_delivery_eligible;
 end if;
 if c->>'version'='1' then
  new.property_kind:=case when c->>'kind' in ('apartment','house','room','unknown') then c->>'kind' else 'unknown' end;
  new.offer_mode:=case when c->>'mode' in ('rent','swap','sale','wanted','unknown') then c->>'mode' else 'unknown' end;
  new.property_type:=case when new.offer_mode='swap' then 'Tauschwohnung' when new.property_kind='apartment' then 'Wohnung' when new.property_kind='house' then 'Haus' when new.property_kind='room' then 'WG' else null end;
  if new.offer_mode in ('sale','wanted') then
   new.is_active:=false;new.quality_status:='rejected';new.quality_reason:='not_a_residential_rental_offer';
  end if;
 elsif new.source_id in (21,22) then
  new.offer_mode:='swap';new.property_type:='Tauschwohnung';
 end if;
 return new;
end $fn$;
create trigger listings_z_property_classification before insert or update of raw,property_type,title on public.listings for each row execute function app_private.apply_property_classification();

create or replace function app_private.matches_property_category(p_types text[],p_kind text,p_mode text)
returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(p_mode in ('rent','swap') and p_kind in ('apartment','house','room') and (
  coalesce(cardinality(p_types),0)=0 or
  (p_mode='swap' and 'Tauschwohnung'=any(p_types)) or
  (p_mode='rent' and case p_kind when 'apartment' then 'Wohnung' when 'house' then 'Haus' when 'room' then 'WG' end=any(p_types))
 ),false);
$fn$;
create or replace function app_private.matches_property_filters(p public.search_profiles,l public.listings)
returns boolean language sql stable set search_path='' as $fn$
 select app_private.matches_property_category(p.property_types,
  coalesce(l.property_kind,case l.property_type when 'Wohnung' then 'apartment' when 'Haus' then 'house' when 'WG' then 'room' when 'Tauschwohnung' then 'apartment' else 'unknown' end),
  coalesce(l.offer_mode,case when l.source_id in (21,22) or l.property_type='Tauschwohnung' or (coalesce(l.title,'') ~* '(tauschwohnung|tauschangebot|wohnungstausch|\mtausche\M)' and coalesce(l.title,'') !~* '(kein(e|en)?|ohne) +(tauschwohnung|wohnungstausch|tausch)') then 'swap' else 'rent' end))
 and case when coalesce(l.property_kind,case when l.property_type='WG' then 'room' end)='room' then
  (p.min_room_area_sqm<=0 or l.area_sqm is null or l.area_sqm>=p.min_room_area_sqm)
 else (coalesce(p.min_rooms,0)<=0 or l.rooms is null or l.rooms>=p.min_rooms)
  and (coalesce(p.min_area_sqm,0)<=0 or l.area_sqm is null or l.area_sqm>=p.min_area_sqm) end;
$fn$;

do $patch$
declare d text; a integer; b integer; n text;
begin
 d:=pg_get_functiondef('app_private.queue_listing_delivery_v3()'::regprocedure);
 a:=position(E'    and (\n      coalesce(cardinality(p.property_types)' in d);
 b:=position(E'    and (\n      p.max_warm_rent' in d);
 if a=0 or b<=a then raise exception 'Unexpected delivery matcher version';end if;
 d:=left(d,a-1)||E'    and app_private.matches_property_filters(p,new)\n'||substring(d from b);
 foreach n in array array[
 E'    and (coalesce(p.min_rooms,0)<=0 or new.rooms is null or new.rooms>=p.min_rooms)\n',
 E'    and (coalesce(p.min_area_sqm,0)<=0 or new.area_sqm is null or new.area_sqm>=p.min_area_sqm)\n'
 ] loop if position(n in d)=0 then raise exception 'Expected size filter missing';end if;d:=replace(d,n,'');end loop;
 execute d;
end $patch$;

-- Category state is isolated from apartment inventory and is never created per user.
create table app_private.source_category_streams(
 source_id smallint not null references public.sources(id),
 category text not null check(category in ('house','room')),
 adapter text not null check(adapter in ('scout','kleinanzeigen','ohne-makler','wg-gesucht','immowelt','immobilien-de','immobilie1')),
 url text, enabled boolean not null default false,
 verified_at timestamptz, baseline_at timestamptz,
 last_started_at timestamptz,last_success_at timestamptz,last_error text,
 failures integer not null default 0, cursor jsonb not null default '{}',
 lease_token uuid,lease_until timestamptz,
 poll_minutes integer not null default 5 check(poll_minutes between 3 and 60),
 request_count bigint not null default 0,candidate_count bigint not null default 0,
 primary key(source_id,category)
);
alter table app_private.source_category_streams enable row level security;
revoke all on app_private.source_category_streams from public,anon,authenticated;
grant select,insert,update on app_private.source_category_streams to service_role;
insert into app_private.source_category_streams(source_id,category,adapter,url) values
 (1,'house','scout',null),
 (2,'house','kleinanzeigen','https://www.kleinanzeigen.de/s-haus-mieten/hamburg/anzeige:angebote/c205l9409?sortingField=SORTING_DATE'),
 (2,'room','kleinanzeigen','https://www.kleinanzeigen.de/s-auf-zeit-wg/hamburg/anzeige:angebote/c199l9409?sortingField=SORTING_DATE'),
 (6,'room','wg-gesucht','https://www.wg-gesucht.de/wg-zimmer-in-Hamburg.55.0.1.0.html'),
 (12,'house','ohne-makler','https://www.ohne-makler.net/immobilien/haus-mieten/hamburg/');

create or replace function public.claim_source_category_streams(p_source_id smallint)
returns setof app_private.source_category_streams language sql set search_path='' as $fn$
 with picked as(select c.source_id,c.category from app_private.source_category_streams c join public.sources s on s.id=c.source_id
 where c.source_id=p_source_id and c.enabled and c.verified_at is not null and s.enabled and s.runtime_mode='live' and s.delivery_mode='live'
 and (c.lease_until is null or c.lease_until<now())
 and (c.last_started_at is null or c.last_started_at<now()-make_interval(mins=>least(60,c.poll_minutes*(1+least(c.failures,5)))))
 order by c.last_started_at nulls first,c.category limit 2 for update of c skip locked)
 update app_private.source_category_streams c set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',last_started_at=now()
 from picked p where c.source_id=p.source_id and c.category=p.category returning c.*;
$fn$;
create or replace function public.finish_source_category_stream(p_source_id smallint,p_category text,p_token uuid,p_success boolean,p_cursor jsonb,p_requests integer,p_candidates integer,p_error text default null)
returns boolean language plpgsql set search_path='' as $fn$
declare n integer;
begin
 update app_private.source_category_streams set lease_token=null,lease_until=null,
  baseline_at=case when p_success then coalesce(baseline_at,now()) else baseline_at end,
  last_success_at=case when p_success then now() else last_success_at end,
  cursor=case when p_success then p_cursor else cursor end,
  failures=case when p_success then 0 else failures+1 end,last_error=case when p_success then null else left(p_error,600) end,
  request_count=request_count+greatest(0,p_requests),candidate_count=candidate_count+greatest(0,p_candidates)
 where source_id=p_source_id and category=p_category and lease_token=p_token and lease_until>now();
 get diagnostics n=row_count;return n=1;
end $fn$;
create or replace function public.source_category_status()
returns jsonb language sql stable set search_path='' as $fn$
 select jsonb_build_object('sources',(select jsonb_agg(jsonb_build_object('id',id,'name',name,'live',enabled and runtime_mode='live' and delivery_mode='live','capabilities',search_capabilities) order by id) from public.sources),
 'streams',(select coalesce(jsonb_agg(jsonb_build_object('source_id',source_id,'category',category,'enabled',enabled,'verified_at',verified_at,'baseline_at',baseline_at,'last_success_at',last_success_at,'error',last_error) order by source_id,category),'[]'::jsonb) from app_private.source_category_streams));
$fn$;

-- Keep the current newness function as the compatibility path. Category discovery
-- requires an absolute source timestamp OR an actual complete-snapshot delta.
do $copy$ declare d text; begin
 d:=pg_get_functiondef('app_private.delivery_newness_qualified(uuid,timestamptz)'::regprocedure);
 execute replace(d,'FUNCTION app_private.delivery_newness_qualified(', 'FUNCTION app_private.delivery_newness_qualified_legacy(');
end $copy$;
create or replace function app_private.delivery_newness_qualified(p_listing_id uuid,p_as_of timestamptz default now())
returns boolean language plpgsql stable set search_path='' as $fn$
declare l public.listings%rowtype;c app_private.source_category_streams%rowtype;published timestamptz;proof jsonb;
begin
 select * into l from public.listings where id=p_listing_id;if not found then return false;end if;
 if l.raw ? 'category_stream' then
  select * into c from app_private.source_category_streams where source_id=l.source_id and category=l.raw->>'category_stream';
  if not found or not c.enabled or c.verified_at is null or c.baseline_at is null or not coalesce(l.fresh_delivery_eligible,false)
   or l.first_seen_at<c.baseline_at or l.first_seen_at<p_as_of-interval '24 hours' or l.first_seen_at>p_as_of+interval '5 minutes' then return false;end if;
  proof:=l.raw->'_newness';
  if proof->>'method'='source_timestamp' then
   begin published:=(proof->>'source_published_at')::timestamptz;exception when others then return false;end;
  elsif proof->>'method'='complete_snapshot_delta' and (proof->>'previous_complete_at') is not null then
   begin published:=(proof->>'previous_complete_at')::timestamptz;exception when others then return false;end;
  else return false;end if;
  return coalesce(published>=p_as_of-interval '24 hours' and published<=p_as_of+interval '5 minutes',false);
 end if;
 return app_private.delivery_newness_qualified_legacy(p_listing_id,p_as_of);
end $fn$;

revoke all on function app_private.apply_property_classification(),app_private.matches_property_category(text[],text,text),app_private.matches_property_filters(public.search_profiles,public.listings),app_private.delivery_newness_qualified(uuid,timestamptz),app_private.delivery_newness_qualified_legacy(uuid,timestamptz) from public,anon,authenticated;
grant execute on function app_private.apply_property_classification(),app_private.matches_property_category(text[],text,text),app_private.matches_property_filters(public.search_profiles,public.listings),app_private.delivery_newness_qualified(uuid,timestamptz),app_private.delivery_newness_qualified_legacy(uuid,timestamptz) to service_role;
revoke all on function public.claim_source_category_streams(smallint),public.finish_source_category_stream(smallint,text,uuid,boolean,jsonb,integer,integer,text),public.source_category_status() from public,anon,authenticated;
grant execute on function public.claim_source_category_streams(smallint),public.finish_source_category_stream(smallint,text,uuid,boolean,jsonb,integer,integer,text),public.source_category_status() to service_role;

-- A complete apartment snapshot cannot deactivate an independently monitored category.
do $patch$ declare d text;begin
 d:=pg_get_functiondef('public.deactivate_missing_source_listings(smallint,text[])'::regprocedure);
 if position('and not (l.source_listing_key = any(p_keys))' in d)=0 then raise exception 'Unexpected snapshot reconciler';end if;
 execute replace(d,'and not (l.source_listing_key = any(p_keys))','and not coalesce(l.raw ? ''category_stream'',false) and not (l.source_listing_key = any(p_keys))');
end $patch$;

-- The dispatcher rechecks category eligibility against the same database policy.
create or replace function public.category_delivery_qualified(p_listing_id uuid)
returns boolean language sql stable set search_path='' as $fn$
 select app_private.delivery_newness_qualified(p_listing_id,statement_timestamp());
$fn$;
revoke all on function public.category_delivery_qualified(uuid) from public,anon,authenticated;
grant execute on function public.category_delivery_qualified(uuid) to service_role;

create or replace function public.reconcile_source_category(p_source_id smallint,p_category text,p_token uuid,p_keys text[])
returns integer language plpgsql set search_path='' as $fn$
declare n integer;begin
 if p_keys is null or cardinality(p_keys)>10000 or not exists(select 1 from app_private.source_category_streams where source_id=p_source_id and category=p_category and lease_token=p_token and lease_until>now() and enabled) then raise exception 'category_reconcile_not_authorized';end if;
 update public.listings set is_active=false where source_id=p_source_id and raw->>'category_stream'=p_category and is_active and not (source_listing_key=any(p_keys));
 get diagnostics n=row_count;return n;
end $fn$;
revoke all on function public.reconcile_source_category(smallint,text,uuid,text[]) from public,anon,authenticated;
grant execute on function public.reconcile_source_category(smallint,text,uuid,text[]) to service_role;
