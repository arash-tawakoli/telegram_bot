set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.bot_events add column ui_timings jsonb;
alter table public.bot_users add column application_ui_state jsonb not null default '{}'::jsonb;

create or replace function public.save_ui_state(p_user uuid,p_update_id bigint,p_attempt integer,p_step text,p_state jsonb,p_revision integer)
returns jsonb language plpgsql set search_path='' as $fn$
declare u public.bot_users%rowtype;current_revision integer;result jsonb;
begin
 select * into u from public.bot_users where id=p_user for update;
 if not found or not u.is_active or not exists(select 1 from public.bot_events where telegram_update_id=p_update_id and telegram_user_id=u.telegram_user_id and processing_status='processing' and processing_attempt=p_attempt) then raise exception 'ui_lease_lost';end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>24000 or p_step not in ('types','location','boroughs','neighborhoods','rent','rent_custom','rooms','area','roomarea','options','review','applicant_setup') then
  if p_step is not null then raise exception 'invalid_ui_state';end if;
 end if;
 current_revision:=coalesce((u.onboarding_state->>'_revision')::integer,0);
 if current_revision<>p_revision then raise exception 'ui_state_changed';end if;
 if u.onboarding_step is not distinct from p_step and (coalesce(u.onboarding_state,'{}')-'_revision')=(coalesce(p_state,'{}')-'_revision') then return coalesce(u.onboarding_state,'{}');end if;
 result:=case when p_step is null then '{}'::jsonb else jsonb_set(p_state,'{_revision}',to_jsonb(current_revision+1),true) end;
 update public.bot_users set onboarding_step=p_step,onboarding_state=result,updated_at=now() where id=p_user;
 return result;
end $fn$;

create or replace function public.save_search_profile_ui(p_user uuid,p_update_id bigint,p_attempt integer,p_values jsonb)
returns jsonb language plpgsql set search_path='' as $fn$
declare u public.bot_users%rowtype;v public.search_profiles%rowtype;slot integer;types text[];reward jsonb;
begin
 select * into u from public.bot_users where id=p_user for update;
 if not found or not u.is_active or not exists(select 1 from public.bot_events where telegram_update_id=p_update_id and telegram_user_id=u.telegram_user_id and processing_status='processing' and processing_attempt=p_attempt) then raise exception 'ui_lease_lost';end if;
 if jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>24000 then raise exception 'invalid_profile';end if;
 slot:=coalesce((p_values->>'profile_slot')::integer,1);
 if slot<1 or slot>(case when app_private.user_is_premium(p_user) then 3 else 1 end) then raise exception 'profile_slot_not_allowed';end if;
 if coalesce(p_values->>'_flow','')!~'^[a-f0-9]{12}$' then raise exception 'ui_state_changed';end if;
 if coalesce(u.onboarding_state->>'_flow','')<>coalesce(p_values->>'_flow','') or coalesce(u.onboarding_state->>'_revision','0')<>coalesce(p_values->>'_revision','0') then raise exception 'ui_state_changed';end if;
 select array_agg(distinct x) into types from jsonb_array_elements_text(p_values->'property_types') x;
 if cardinality(types) is null or cardinality(types)=0 or not types<@array['Wohnung','Haus','WG','Tauschwohnung']::text[] then raise exception 'invalid_property_types';end if;
 if (p_values->>'max_warm_rent')::numeric not between 100 and 5000 or (p_values->>'max_warm_rent') is null or coalesce((p_values->>'min_rooms')::numeric,0) not between 0 and 20 or coalesce((p_values->>'min_area_sqm')::numeric,0) not between 0 and 1000 or coalesce((p_values->>'min_room_area_sqm')::numeric,0) not between 0 and 300 then raise exception 'invalid_profile_limits';end if;
 if p_values->>'location_mode' not in ('all_hamburg','boroughs','neighborhoods') or p_values->>'location_mode' is null then raise exception 'invalid_profile_location';end if;
 if (p_values->>'location_mode'='boroughs' and jsonb_array_length(coalesce(p_values->'boroughs','[]'))=0) or (p_values->>'location_mode'='neighborhoods' and jsonb_array_length(coalesce(p_values->'neighborhoods','[]'))=0) then raise exception 'invalid_profile_location';end if;
 select * into v from public.search_profiles where user_id=p_user and profile_slot=slot for update;
 insert into public.search_profiles(user_id,profile_slot,name,property_types,location_mode,districts,boroughs,neighborhoods,max_warm_rent,min_rooms,min_area_sqm,min_room_area_sqm,wbs_only,furnished_preference,require_known_warm_rent,max_deposit,updated_at)
 values(p_user,slot,coalesce(v.name,case when slot=1 then 'Meine Suche' else 'Meine Suche '||slot end),types,p_values->>'location_mode',
 array(select jsonb_array_elements_text(coalesce(p_values->'districts','[]'))),array(select jsonb_array_elements_text(coalesce(p_values->'boroughs','[]'))),array(select jsonb_array_elements_text(coalesce(p_values->'neighborhoods','[]'))),
 (p_values->>'max_warm_rent')::numeric,coalesce((p_values->>'min_rooms')::numeric,0),coalesce((p_values->>'min_area_sqm')::numeric,0),coalesce((p_values->>'min_room_area_sqm')::numeric,v.min_room_area_sqm,0),
 case when p_values?'wbs_only' then (p_values->>'wbs_only')::boolean else coalesce(v.wbs_only,false) end,
 case when p_values?'furnished_preference' then p_values->>'furnished_preference' else coalesce(v.furnished_preference,'any') end,
 case when p_values?'require_known_warm_rent' then (p_values->>'require_known_warm_rent')::boolean else coalesce(v.require_known_warm_rent,false) end,
 case when p_values?'max_deposit' then (p_values->>'max_deposit')::numeric else v.max_deposit end,now())
 on conflict(user_id,profile_slot) do update set property_types=excluded.property_types,location_mode=excluded.location_mode,districts=excluded.districts,boroughs=excluded.boroughs,neighborhoods=excluded.neighborhoods,max_warm_rent=excluded.max_warm_rent,min_rooms=excluded.min_rooms,min_area_sqm=excluded.min_area_sqm,min_room_area_sqm=excluded.min_room_area_sqm,wbs_only=excluded.wbs_only,furnished_preference=excluded.furnished_preference,require_known_warm_rent=excluded.require_known_warm_rent,max_deposit=excluded.max_deposit,updated_at=now();
 -- is_active, move_in_from, user id and unrelated fields intentionally are not overwritten.
 update public.bot_users set onboarding_step=null,onboarding_state='{}',updated_at=now() where id=p_user;
 reward:=public.complete_referral_reward(p_user);
 return coalesce(reward,'{}');
end $fn$;

create or replace function public.finish_ui_update(p_update_id bigint,p_attempt integer,p_success boolean,p_error text default null,p_timings jsonb default '{}')
returns boolean language plpgsql set search_path='' as $fn$
declare safe jsonb;
begin
 select coalesce(jsonb_object_agg(key,value),'{}') into safe from jsonb_each(coalesce(p_timings,'{}')) where key in ('prepare_ms','state_ms','render_ms','telegram_ms','total_ms','rpc_count','telegram_count','busy_count') and (case when jsonb_typeof(value)='number' then value::numeric else null end) between 0 and 600000;
 update public.bot_events set processing_status=case when p_success then 'done' else 'failed' end,processing_at=now(),processing_error=left(p_error,300),ui_timings=safe,
 payload=case when p_success and (left(coalesce(payload#>>'{message,reply_to_message,text}',''),1)='👤' or coalesce(payload#>>'{message,text}','')~'https://(tenant[.]immomio[.]com/de/auth/login|login[.]kleinanzeigen[.]de/android/com[.]ebay[.]kleinanzeigen/callback)') then jsonb_build_object('update_id',p_update_id,'redacted','private_applicant_input') else payload end
 where telegram_update_id=p_update_id and processing_status='processing' and processing_attempt=p_attempt;
 return found;
end $fn$;

create table app_private.ui_action_jobs(
 id uuid primary key default gen_random_uuid(),update_id bigint not null, user_id uuid not null references public.bot_users(id) on delete cascade,
 chat_id bigint not null,message_id bigint not null,action text not null check(action in ('check','disconnect')),provider smallint not null check(provider in (1,2,3)),
 status text not null default 'pending' check(status in ('pending','processing','done','failed')),attempt integer not null default 0,
 lease_token uuid,lease_until timestamptz,created_at timestamptz not null default now(),finished_at timestamptz,error text,connection_updated_at timestamptz,
 unique(update_id,action,provider)
);
alter table app_private.ui_action_jobs enable row level security;
revoke all on app_private.ui_action_jobs from public,anon,authenticated;
grant select,insert,update,delete on app_private.ui_action_jobs to service_role;
create index ui_action_jobs_pending on app_private.ui_action_jobs(created_at) where status in ('pending','processing');
create index ui_action_jobs_user on app_private.ui_action_jobs(user_id);

create or replace function public.enqueue_ui_action(p_update_id bigint,p_attempt integer,p_user uuid,p_chat bigint,p_message bigint,p_action text,p_provider smallint)
returns uuid language plpgsql set search_path='' as $fn$
declare j uuid; connection_version timestamptz;
begin
 if not exists(select 1 from public.bot_users u join public.bot_events e on e.telegram_user_id=u.telegram_user_id where u.id=p_user and u.chat_id=p_chat and u.is_active and e.telegram_update_id=p_update_id and e.processing_status='processing' and e.processing_attempt=p_attempt and app_private.user_is_premium(u.id)) then raise exception 'ui_action_not_authorized';end if;
 select updated_at into connection_version from public.platform_connections where user_id=p_user and provider=case p_provider when 1 then 'immoscout' when 2 then 'kleinanzeigen' else 'immomio' end;
 insert into app_private.ui_action_jobs(update_id,user_id,chat_id,message_id,action,provider,connection_updated_at) values(p_update_id,p_user,p_chat,p_message,p_action,p_provider,connection_version) on conflict do nothing returning id into j;
 if j is null then select id into j from app_private.ui_action_jobs where update_id=p_update_id and action=p_action and provider=p_provider;end if;
 return j;
end $fn$;
create or replace function public.dispatch_ui_action(p_id uuid)
returns void language plpgsql set search_path='' as $fn$
begin
 update app_private.ui_action_jobs j set status='failed',finished_at=now(),error='user_not_eligible' where id=p_id and status='pending' and not exists(select 1 from public.bot_users u where u.id=j.user_id and u.chat_id=j.chat_id and u.is_active and app_private.user_is_premium(u.id));
 if exists(select 1 from app_private.ui_action_jobs where id=p_id and status='pending' and attempt<3) then
 perform net.http_post(url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/telegram-gateway',headers:=jsonb_build_object('Content-Type','application/json','x-telegram-bot-api-secret-token',public.get_bot_secret('telegram_webhook_secret')),body:=jsonb_build_object('ui_action_job',p_id),timeout_milliseconds:=55000);
 end if;
end $fn$;
create or replace function public.claim_ui_action(p_id uuid)
returns setof app_private.ui_action_jobs language sql set search_path='' as $fn$
 update app_private.ui_action_jobs j set status='processing',attempt=attempt+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds'
 where id=p_id and attempt<3 and (status='pending' or (status='processing' and lease_until<now()))
 and exists(select 1 from public.bot_users u where u.id=j.user_id and u.chat_id=j.chat_id and u.is_active and app_private.user_is_premium(u.id)) returning j.*;
$fn$;
create or replace function public.finish_ui_action(p_id uuid,p_token uuid,p_error text default null)
returns boolean language plpgsql set search_path='' as $fn$
declare j app_private.ui_action_jobs%rowtype;
begin
 update app_private.ui_action_jobs set status=case when p_error is null then 'done' else 'failed' end,finished_at=now(),error=left(p_error,200),lease_until=null
 where id=p_id and lease_token=p_token and status='processing' and lease_until>now() returning * into j;
 if not found then return false;end if;
 return not exists(select 1 from public.bot_events e join public.bot_users u on u.telegram_user_id=e.telegram_user_id where u.id=j.user_id and e.telegram_update_id>j.update_id);
end $fn$;

-- Local credential deletion is atomic and cannot delete a subsequently renewed login.
create or replace function public.disconnect_ui_action(p_id uuid,p_token uuid)
returns boolean language plpgsql set search_path='' as $fn$
declare j app_private.ui_action_jobs%rowtype;v_provider text;v_updated timestamptz;
begin
 select * into j from app_private.ui_action_jobs where id=p_id and lease_token=p_token and action='disconnect' and status='processing' and lease_until>now() for update;
 if not found then return false;end if;
 if not exists(select 1 from public.bot_users where id=j.user_id and chat_id=j.chat_id and is_active and app_private.user_is_premium(id)) then return false;end if;
 v_provider:=case j.provider when 1 then 'immoscout' when 2 then 'kleinanzeigen' else 'immomio' end;
 select updated_at into v_updated from public.platform_connections where user_id=j.user_id and provider=v_provider for update;
 if v_updated is distinct from j.connection_updated_at then return false;end if;
 delete from public.platform_connections where user_id=j.user_id and provider=v_provider;
 delete from public.platform_auth_flows where user_id=j.user_id and provider=v_provider and created_at<=j.created_at;
 return true;
end $fn$;
revoke all on function public.disconnect_ui_action(uuid,uuid) from public,anon,authenticated;
grant execute on function public.disconnect_ui_action(uuid,uuid) to service_role;

-- Reuse the existing recovery timer; no per-click cron or timer-driven idle edge.
do $patch$ declare d text; begin
 d:=pg_get_functiondef('app_private.retry_telegram_updates()'::regprocedure);
 if position('end loop;return v_count;' in d)=0 then raise exception 'Unexpected recovery function';end if;
 d:=replace(d,'/functions/v1/telegram-ui','/functions/v1/telegram-gateway');
 d:=replace(d,'end loop;return v_count;',E'end loop;\n for r in select id from app_private.ui_action_jobs where attempt<3 and ((status=''pending'' and created_at<now()-interval ''1 minute'') or (status=''processing'' and lease_until<now())) order by created_at limit 5 loop\n update app_private.ui_action_jobs set status=''pending'' where id=r.id;\n perform public.dispatch_ui_action(r.id);\n end loop;\n update app_private.ui_action_jobs set status=''failed'',finished_at=now(),error=''recovery_exhausted'',lease_until=null where status=''processing'' and attempt>=3 and lease_until<now();\n delete from app_private.ui_action_jobs where status in (''done'',''failed'') and finished_at<now()-interval ''7 days'';\n update public.bot_users set application_ui_state=''{}'' where application_ui_state<>''{}''::jsonb and coalesce(application_ui_state->>''updated_at'','''')<to_char(now()-interval ''1 day'',''YYYY-MM-DD"T"HH24:MI:SS'');\n return v_count;');
 execute d;
end $patch$;
revoke all on function public.save_ui_state(uuid,bigint,integer,text,jsonb,integer),public.save_search_profile_ui(uuid,bigint,integer,jsonb),public.finish_ui_update(bigint,integer,boolean,text,jsonb),public.enqueue_ui_action(bigint,integer,uuid,bigint,bigint,text,smallint),public.dispatch_ui_action(uuid),public.claim_ui_action(uuid),public.finish_ui_action(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_ui_state(uuid,bigint,integer,text,jsonb,integer),public.save_search_profile_ui(uuid,bigint,integer,jsonb),public.finish_ui_update(bigint,integer,boolean,text,jsonb),public.enqueue_ui_action(bigint,integer,uuid,bigint,bigint,text,smallint),public.dispatch_ui_action(uuid),public.claim_ui_action(uuid),public.finish_ui_action(uuid,uuid,text) to service_role;
