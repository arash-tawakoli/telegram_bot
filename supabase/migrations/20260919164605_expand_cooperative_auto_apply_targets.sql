set local lock_timeout='5s';
-- Expand cooperative auto-apply routing without changing crawling or user opt-ins.
create or replace function app_private.immomio_application_target(p_raw jsonb,p_canonical_url text default null)
returns jsonb language plpgsql immutable set search_path='' as $fn$
declare v text; m text[]; ids text[]:=array[]::text[]; id text;
begin
 foreach v in array array[p_raw->>'applicationLink',p_raw->>'application_link',p_raw->>'applicationUrl',p_raw->>'application_url',p_raw->>'tenant_apply_url',p_canonical_url] loop
  if v is null or length(v)>4096 or v ~ '[[:cntrl:]]' then continue; end if;
  v:=btrim(v);
  m:=regexp_match(v,'^https://tenant[.]immomio[.]com/(?:de/)?apply/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/?(?:[?#][^[:space:]\\]*)?$','i');
  if m is not null then id:=lower(m[1]); if not id=any(ids) then ids:=array_append(ids,id); end if; end if;
 end loop;
 if cardinality(ids)=0 then return jsonb_build_object('status','missing'); end if;
 if cardinality(ids)>1 then return jsonb_build_object('status','conflict'); end if;
 return jsonb_build_object('status','resolved','provider','immomio','source_identifier',ids[1],'url','https://tenant.immomio.com/apply/'||ids[1]);
end $fn$;
create or replace function app_private.application_provider_target(p_source_id smallint,p_raw jsonb,p_canonical_url text)
returns text language plpgsql immutable set search_path='' as $fn$
declare t jsonb;
begin
 t:=app_private.immomio_application_target(p_raw,p_canonical_url);
 if t->>'status'='conflict' then return null; end if;
 if t->>'status'='resolved' then return 'immomio'; end if;
 return case when p_source_id=1 then 'immoscout' when p_source_id=2 then 'kleinanzeigen' else null end;
end $fn$;
create or replace function app_private.application_provider_for_listing(p_source_id smallint,p_raw jsonb)
returns text language sql stable set search_path='' as $fn$ select app_private.application_provider_target(p_source_id,p_raw,null); $fn$;
create or replace function app_private.application_target_ready(p_user uuid,p_source_id smallint,p_raw jsonb,p_canonical_url text)
returns boolean language plpgsql stable set search_path='' as $fn$
declare v_provider text;
begin
 v_provider:=app_private.application_provider_target(p_source_id,p_raw,p_canonical_url);
 if v_provider is null or not exists(select 1 from public.platform_connections c where c.user_id=p_user and c.provider=v_provider and c.status='connected') then return false; end if;
 if v_provider='immomio' then return true; end if;
 return exists(select 1 from app_private.application_platforms p where p.source_id=p_source_id and p.verified_at is not null);
end $fn$;
create or replace function app_private.application_provider_ready(p_user uuid,p_source_id smallint,p_raw jsonb)
returns boolean language sql stable set search_path='' as $fn$ select app_private.application_target_ready(p_user,p_source_id,p_raw,null); $fn$;
do $patch$
declare signature text; original text; patched text;
begin
 foreach signature in array array['public.claim_application()','public.claim_immomio_application()','public.claim_kleinanzeigen_application()','app_private.dispatch_due_application_workers()','app_private.enqueue_matched_application()','public.enqueue_application_now(uuid,uuid)'] loop
  original:=pg_get_functiondef(signature::regprocedure);
  patched:=replace(original,'app_private.application_provider_for_listing(l.source_id,l.raw)','app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)');
  patched:=replace(patched,'app_private.application_provider_ready(u.id,l.source_id,l.raw)','app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)');
  if patched=original then raise exception 'Expected application routing call not found in %',signature; end if;
  execute patched;
 end loop;
end $patch$;
create table app_private.application_send_keys (
 user_id uuid not null references public.bot_users(id) on delete cascade,
 provider text not null check(provider='immomio'),
 source_identifier uuid not null,
 application_id uuid references public.applications(id) on delete set null,
 reserved_at timestamptz not null default now(),
 request_started_at timestamptz,
 primary key(user_id,provider,source_identifier)
);
create index application_send_keys_application_idx on app_private.application_send_keys(application_id) where application_id is not null;
alter table app_private.application_send_keys enable row level security;
revoke all on app_private.application_send_keys from public,anon,authenticated;
grant select,insert on app_private.application_send_keys to service_role;
grant update(request_started_at) on app_private.application_send_keys to service_role;
insert into app_private.application_send_keys(user_id,provider,source_identifier,application_id,reserved_at)
select distinct on (a.user_id,t.target->>'source_identifier') a.user_id,'immomio',(t.target->>'source_identifier')::uuid,a.id,coalesce(a.submission_started_at,a.sent_at,a.created_at)
from public.applications a join public.listings l on l.id=a.listing_id
cross join lateral (select app_private.immomio_application_target(l.raw,l.canonical_url) target) t
where t.target->>'status'='resolved' and (a.submission_started_at is not null or a.status='sent' or a.last_error='submission_unconfirmed')
order by a.user_id,t.target->>'source_identifier',coalesce(a.submission_started_at,a.sent_at,a.created_at),a.id
on conflict do nothing;
create or replace function public.begin_application_submission(p_id uuid)
returns boolean language plpgsql set search_path='' as $fn$
declare a public.applications%rowtype; l public.listings%rowtype; t jsonb; owner_id uuid;
begin
 select * into a from public.applications where id=p_id for update;
 if not found or a.status<>'pending' or a.submission_started_at is not null then return false; end if;
 select * into l from public.listings where id=a.listing_id;
 if not found then return false; end if;
 if not exists(
  select 1 from public.bot_users u join public.sources s on s.id=l.source_id
  where u.id=a.user_id and u.is_active and u.auto_apply_enabled
   and app_private.user_is_premium(u.id) and app_private.applicant_profile_complete(u.id)
   and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
   and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
   and l.is_active and coalesce(l.quality_status,'unchecked')<>'rejected' and coalesce(l.is_primary_listing,false)
   and s.enabled and s.runtime_mode='live' and s.delivery_mode='live' and l.source_id=a.source_id
   and app_private.delivery_newness_qualified(l.id,statement_timestamp())
   and exists(select 1 from public.delivery_events d where d.listing_id=l.id and d.recipient_user_id=u.id and d.event_type='new_listing' and d.status in ('pending','processing','sent'))
 ) then update public.applications set status='failed',last_error='not_eligible' where id=p_id; return false; end if;
 t:=app_private.immomio_application_target(l.raw,l.canonical_url);
 if t->>'status'='resolved' then
  insert into app_private.application_send_keys(user_id,provider,source_identifier,application_id)
  values(a.user_id,'immomio',(t->>'source_identifier')::uuid,a.id) on conflict do nothing;
  select k.application_id into owner_id from app_private.application_send_keys k where k.user_id=a.user_id and k.provider='immomio' and k.source_identifier=(t->>'source_identifier')::uuid;
  if owner_id is distinct from a.id then update public.applications set status='manual_required',last_error='duplicate_provider_object' where id=p_id; return false; end if;
 end if;
 update public.applications set status='processing',attempts=attempts+1,submission_started_at=now() where id=p_id;
 return true;
end $fn$;
create or replace function public.get_immomio_application_listing(p_listing_id uuid)
returns jsonb language sql stable set search_path='' as $fn$
 select jsonb_build_object('id',l.id,'source_id',l.source_id,'canonical_url',l.canonical_url,'title',l.title,'is_active',l.is_active,'external_id',l.external_id,'source_listing_key',l.source_listing_key,'application_target',t.target,
 'raw',coalesce(l.raw,'{}'::jsonb)||case when t.target->>'status'='resolved' then jsonb_build_object('applicationLink',t.target->>'url') else '{}'::jsonb end)
 from public.listings l cross join lateral (select app_private.immomio_application_target(l.raw,l.canonical_url) target) t where l.id=p_listing_id;
$fn$;
create or replace function public.authorize_immomio_application_send(p_id uuid,p_token uuid,p_source_identifier uuid)
returns boolean language plpgsql set search_path='' as $fn$
declare a public.applications%rowtype; target jsonb;
begin
 select * into a from public.applications where id=p_id for update;
 if not found or p_token is null or p_source_identifier is null or a.lease_token is distinct from p_token or a.lease_until is null or a.lease_until<=now() then return false; end if;
 select app_private.immomio_application_target(l.raw,l.canonical_url) into target from public.listings l where l.id=a.listing_id;
 if target->>'status' is distinct from 'resolved' or (target->>'source_identifier')::uuid is distinct from p_source_identifier then return false; end if;
 return public.begin_application_submission(p_id);
end $fn$;
create or replace function public.validate_immomio_application_send(p_id uuid,p_token uuid,p_user uuid,p_listing uuid,p_source_identifier uuid)
returns boolean language sql stable set search_path='' as $fn$
 select exists(
  select 1 from public.applications a join public.listings l on l.id=a.listing_id join public.sources s on s.id=l.source_id join public.bot_users u on u.id=a.user_id
  join app_private.application_send_keys k on k.application_id=a.id and k.user_id=a.user_id and k.provider='immomio' and k.source_identifier=p_source_identifier
  cross join lateral(select app_private.immomio_application_target(l.raw,l.canonical_url) target)t
  where a.id=p_id and a.user_id=p_user and a.listing_id=p_listing and a.lease_token=p_token and a.lease_until>now()
   and a.status='processing' and a.submission_started_at is not null
   and t.target->>'status'='resolved' and (t.target->>'source_identifier')::uuid=p_source_identifier
   and u.is_active and u.auto_apply_enabled and app_private.user_is_premium(u.id) and app_private.applicant_profile_complete(u.id)
   and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
   and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
   and l.is_active and coalesce(l.is_primary_listing,false) and coalesce(l.quality_status,'unchecked')<>'rejected'
   and s.enabled and s.runtime_mode='live' and s.delivery_mode='live'
   and app_private.delivery_newness_qualified(l.id,statement_timestamp())
   and exists(select 1 from public.delivery_events d where d.listing_id=l.id and d.recipient_user_id=u.id and d.event_type='new_listing' and d.status in ('pending','processing','sent'))
 );
$fn$;
create or replace function public.consume_immomio_application_send(p_id uuid,p_token uuid,p_user uuid,p_listing uuid,p_source_identifier uuid)
returns boolean language plpgsql set search_path='' as $fn$
declare n integer;
begin
 perform 1 from public.applications a where a.id=p_id for update;
 if not public.validate_immomio_application_send(p_id,p_token,p_user,p_listing,p_source_identifier) then return false; end if;
 update app_private.application_send_keys k set request_started_at=clock_timestamp()
 where k.application_id=p_id and k.user_id=p_user and k.provider='immomio' and k.source_identifier=p_source_identifier and k.request_started_at is null;
 get diagnostics n=row_count; return n=1;
end $fn$;
create or replace function public.cooperative_auto_apply_readiness(p_user uuid default null)
returns table(source_id bigint,source_name text,connector_kind text,source_live boolean,route text,retained_object_links bigint,active_new_object_links bigint,account_connected boolean,user_enabled boolean,profile_complete boolean,premium boolean,registration_status text,readiness text)
language sql stable set search_path='' as $fn$
 with source_data as (
  select s.*,c.connector_kind,c.config,exists(select 1 from public.source_connectors cr where cr.source_id=s.id and nullif(cr.config->>'tenant_registration_url','') is not null) has_registration
  from public.sources s left join lateral(select sc.connector_kind,sc.config from public.source_connectors sc where sc.source_id=s.id and sc.enabled order by sc.shadow_only,sc.priority limit 1)c on true where s.source_type='Baugenossenschaft'
 ), agg as (
  select sd.id,count(l.id) filter(where t.target->>'status'='resolved') links,
   count(l.id) filter(where t.target->>'status'='resolved' and l.is_active and coalesce(l.quality_status,'unchecked')<>'rejected' and coalesce(l.is_primary_listing,false) and app_private.delivery_newness_qualified(l.id,statement_timestamp())) eligible
  from source_data sd left join public.listings l on l.source_id=sd.id cross join lateral(select app_private.immomio_application_target(l.raw,l.canonical_url) target)t group by sd.id
 ), user_state as (
  select case when p_user is null then null else exists(select 1 from public.platform_connections c where c.user_id=p_user and c.provider='immomio' and c.status='connected') end connected,
   case when p_user is null then null else exists(select 1 from public.bot_users u where u.id=p_user and u.is_active and u.auto_apply_enabled) end enabled,
   case when p_user is null then null else coalesce(app_private.applicant_profile_complete(p_user),false) end complete,
   case when p_user is null then null else coalesce(app_private.user_is_premium(p_user),false) end paid
 )
 select sd.id::bigint,sd.name,sd.connector_kind,(sd.enabled and sd.runtime_mode='live' and sd.delivery_mode='live'),
  case when sd.connector_kind='immomio_tenant' then 'immomio_public' when agg.links>0 then 'immomio_hybrid' when sd.has_registration then 'immomio_registration_only' else 'other_or_unverified' end,
  agg.links,agg.eligible,u.connected,u.enabled,u.complete,u.paid,
  case when sd.has_registration then 'not_verified_per_user' else 'not_checked' end,
  case when not(sd.enabled and sd.runtime_mode='live' and sd.delivery_mode='live') then 'source_not_live'
   when sd.connector_kind is distinct from 'immomio_tenant' and agg.links=0 then case when sd.has_registration then 'needs_object_offer_access' else 'needs_provider_adapter' end
   when p_user is null then 'user_not_checked' when not u.enabled then 'auto_apply_not_enabled' when not u.paid then 'premium_required' when not u.complete then 'applicant_profile_incomplete' when not u.connected then 'immomio_account_not_connected' when agg.eligible=0 then 'no_current_qualified_object' else 'ready_for_provider_check_not_send_verified' end
 from source_data sd join agg on agg.id=sd.id cross join user_state u order by sd.id;
$fn$;
revoke all on function app_private.immomio_application_target(jsonb,text),app_private.application_provider_target(smallint,jsonb,text),app_private.application_target_ready(uuid,smallint,jsonb,text),app_private.application_provider_for_listing(smallint,jsonb),app_private.application_provider_ready(uuid,smallint,jsonb) from public,anon,authenticated;
grant execute on function app_private.immomio_application_target(jsonb,text),app_private.application_provider_target(smallint,jsonb,text),app_private.application_target_ready(uuid,smallint,jsonb,text),app_private.application_provider_for_listing(smallint,jsonb),app_private.application_provider_ready(uuid,smallint,jsonb) to service_role;
revoke all on function public.get_immomio_application_listing(uuid),public.authorize_immomio_application_send(uuid,uuid,uuid),public.validate_immomio_application_send(uuid,uuid,uuid,uuid,uuid),public.cooperative_auto_apply_readiness(uuid),public.consume_immomio_application_send(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_immomio_application_listing(uuid),public.authorize_immomio_application_send(uuid,uuid,uuid),public.validate_immomio_application_send(uuid,uuid,uuid,uuid,uuid),public.cooperative_auto_apply_readiness(uuid),public.consume_immomio_application_send(uuid,uuid,uuid,uuid,uuid) to service_role;