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
      and s.delivery_mode = 'live'
      and not exists (
        select 1
        from public.source_jobs j
        where j.source_id = s.id
          and j.status in ('enqueued', 'processing', 'retry')
          and j.queue_msg_id is not null
      )
      and (
        s.last_checked_at is null
        or s.last_checked_at <= now() - interval '5 minutes'
      )
    order by coalesce(s.crawl_priority, 2147483647),
             coalesce(s.last_checked_at, '-infinity'::timestamptz),
             s.id
    limit greatest(1, least(coalesce(p_limit, 65), 65))
    for update skip locked
  loop
    v_job_id := gen_random_uuid();

    select x into v_msg_id
    from pgmq.send(
      'source_jobs',
      jsonb_build_object('job_id', v_job_id, 'source_id', r.id, 'worker', 'source-worker')
    ) as x
    limit 1;

    insert into public.source_jobs(
      id, queue_msg_id, source_id, status, worker, enqueued_at, updated_at
    ) values (
      v_job_id, v_msg_id, r.id, 'enqueued', 'source-worker', now(), now()
    );

    update public.sources
    set last_checked_at = now(), updated_at = now()
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finish_source_job(p_job_id uuid, p_success boolean, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.source_jobs%rowtype; v_delay integer;
begin
  select * into j from public.source_jobs where id=p_job_id for update;
  if not found then return false; end if;

  if p_success then
    perform pgmq.archive('source_jobs',j.queue_msg_id);
    update public.source_jobs set status='done',error_message=null,finished_at=now(),updated_at=now() where id=p_job_id;
    return true;
  end if;

  perform pgmq.archive('source_jobs',j.queue_msg_id);
  update public.source_jobs set status='dead',error_message=left(coalesce(p_error,'worker failed'),1500),finished_at=now(),updated_at=now() where id=p_job_id;
  return false;
end;
$function$;

update public.sources set poll_interval_minutes=5, updated_at=now();

create table app_private.dispatch_control (
  singleton boolean primary key default true check(singleton),
  owner uuid,
  expires_at timestamptz,
  next_send_at timestamptz not null default now()
);
insert into app_private.dispatch_control(singleton) values(true);
alter table app_private.dispatch_control enable row level security;
create function public.acquire_dispatcher(p_owner uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update app_private.dispatch_control set owner=p_owner,expires_at=now()+interval '10 minutes'
 where singleton and (owner is null or expires_at<now());
 return found;
end $$;
create function public.dispatcher_slot(p_owner uuid,p_complete boolean default false) returns timestamptz language plpgsql security definer set search_path='' as $$
declare r app_private.dispatch_control%rowtype;
begin
 select * into r from app_private.dispatch_control where singleton for update;
 if r.owner is distinct from p_owner or r.expires_at<now() then raise exception 'dispatcher lease lost'; end if;
 if p_complete then
   update app_private.dispatch_control set next_send_at=clock_timestamp()+interval '15 seconds' where singleton returning next_send_at into r.next_send_at;
 end if;
 return r.next_send_at;
end $$;
create function public.release_dispatcher(p_owner uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin update app_private.dispatch_control set owner=null,expires_at=null where singleton and owner=p_owner;return found;end $$;

alter table public.bot_events add column processing_status text not null default 'done' check(processing_status in ('pending','processing','done','failed'));
-- Legacy UI inserts remain done during rollout; new claims explicitly insert pending.
alter table public.bot_events add column processing_attempt integer not null default 0;
alter table public.bot_events add column processing_at timestamptz;
alter table public.bot_events add column processing_error text;
create index bot_events_retry_idx on public.bot_events(processing_status,processing_at) where processing_status in ('pending','processing','failed');
create function public.claim_telegram_update(p_payload jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare v_id bigint := (p_payload->>'update_id')::bigint;v_user bigint:=coalesce((p_payload#>>'{callback_query,from,id}')::bigint,(p_payload#>>'{message,from,id}')::bigint);v_attempt integer;
begin
 if v_id is null then raise exception 'missing update_id'; end if;
 perform pg_advisory_xact_lock(v_user);
 insert into public.bot_events(telegram_update_id,event_type,telegram_user_id,payload,processing_status)
 values(v_id,case when p_payload ? 'callback_query' then 'callback_query' else 'message' end,v_user,p_payload,'pending') on conflict(telegram_update_id) do nothing;
 if exists(select 1 from public.bot_events where telegram_user_id=v_user and telegram_update_id<>v_id and processing_status='processing' and processing_at>now()-interval '10 minutes') then return -1; end if;
 update public.bot_events set processing_status='processing',processing_attempt=processing_attempt+1,processing_at=now(),processing_error=null
 where telegram_update_id=v_id and (processing_status in ('pending','failed') or (processing_status='processing' and processing_at<now()-interval '10 minutes')) returning processing_attempt into v_attempt;
 if found then return v_attempt; end if;
 if exists(select 1 from public.bot_events where telegram_update_id=v_id and processing_status='done') then return 0;end if;
 return -1;
end $$;
create function public.finish_telegram_update(p_update_id bigint,p_attempt integer,p_success boolean,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.bot_events set processing_status=case when p_success then 'done' else 'failed' end,processing_at=now(),processing_error=left(p_error,1000)
 where telegram_update_id=p_update_id and processing_status='processing' and processing_attempt=p_attempt;
 return found;
end $$;

revoke execute on function public.acquire_dispatcher(uuid) from public,anon,authenticated;
grant execute on function public.acquire_dispatcher(uuid) to service_role;

revoke execute on function public.dispatcher_slot(uuid,boolean) from public,anon,authenticated;
grant execute on function public.dispatcher_slot(uuid,boolean) to service_role;

revoke execute on function public.release_dispatcher(uuid) from public,anon,authenticated;
grant execute on function public.release_dispatcher(uuid) to service_role;

revoke execute on function public.claim_telegram_update(jsonb) from public,anon,authenticated;
grant execute on function public.claim_telegram_update(jsonb) to service_role;

revoke execute on function public.finish_telegram_update(bigint,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_telegram_update(bigint,integer,boolean,text) to service_role;

create or replace view app_private.source_health_report as
select s.id,s.name,s.tier,s.runtime_mode,s.poll_interval_minutes,s.last_success_at,s.consecutive_failures,
 count(c.id) filter(where c.started_at>now()-interval '24 hours') as checks_24h,
 count(c.id) filter(where c.started_at>now()-interval '24 hours' and c.success) as successful_checks_24h,
 coalesce(sum(c.fetched_count) filter(where c.started_at>now()-interval '24 hours' and c.success),0) as fetched_24h,
 case when count(c.id) filter(where c.started_at>now()-interval '24 hours')>=12 and count(c.id) filter(where c.started_at>now()-interval '24 hours' and not c.success)=0 and coalesce(sum(c.fetched_count) filter(where c.started_at>now()-interval '24 hours'),0)>0 then 'review_for_promotion' else 'collect_evidence' end as recommendation
from public.sources s left join public.crawl_runs c on c.source_id=s.id and c.started_at>now()-interval '24 hours'
group by s.id;
revoke all on app_private.source_health_report from public,anon,authenticated;
grant select on app_private.source_health_report to service_role;

create table app_private.telegram_effects(update_id bigint not null,effect_key text not null,result jsonb,primary key(update_id,effect_key));
alter table app_private.telegram_effects enable row level security;
create function public.toggle_saved_once(p_update_id bigint,p_user_id uuid,p_listing_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare v_result jsonb;v_listing uuid;v_existing uuid;
begin
 perform pg_advisory_xact_lock(p_update_id);
 select result into v_result from app_private.telegram_effects where update_id=p_update_id and effect_key='toggle_saved';
 if found then return (v_result->>'saved')::boolean;end if;
 select coalesce(duplicate_of_listing_id,id) into v_listing from public.listings where id=p_listing_id;
 if not found then raise exception 'listing unavailable';end if;
 select id into v_existing from public.saved_listings where user_id=p_user_id and listing_id=v_listing;
 if found then delete from public.saved_listings where id=v_existing;v_result:='{"saved":false}'::jsonb;
 else insert into public.saved_listings(user_id,listing_id) values(p_user_id,v_listing);v_result:='{"saved":true}'::jsonb;end if;
 insert into app_private.telegram_effects values(p_update_id,'toggle_saved',v_result);
 return (v_result->>'saved')::boolean;
end $$;
revoke execute on function public.toggle_saved_once(bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.toggle_saved_once(bigint,uuid,uuid) to service_role;

create table app_private.source_shadow_runs(id bigint generated always as identity primary key,source_id smallint not null references public.sources,checked_at timestamptz not null default now(),connector_priority integer not null,reachable boolean not null,candidate_count integer not null default 0,details jsonb not null default '{}');
alter table app_private.source_shadow_runs enable row level security;
create index source_shadow_runs_source_time on app_private.source_shadow_runs(source_id,checked_at desc);
create function public.record_source_probe(p_source_id smallint,p_priority integer,p_reachable boolean,p_count integer,p_details jsonb) returns void language sql security definer set search_path='' as $$
 insert into app_private.source_shadow_runs(source_id,connector_priority,reachable,candidate_count,details) values(p_source_id,p_priority,p_reachable,p_count,p_details);
$$;
revoke execute on function public.record_source_probe(smallint,integer,boolean,integer,jsonb) from public,anon,authenticated;
grant execute on function public.record_source_probe(smallint,integer,boolean,integer,jsonb) to service_role;

create function app_private.retry_telegram_updates() returns integer language plpgsql set search_path='' as $$
declare r record;v_count integer:=0;
begin
 for r in select payload from public.bot_events
 where processing_attempt<5 and ((processing_status in ('pending','failed') and coalesce(processing_at,created_at)<now()-interval '1 minute') or (processing_status='processing' and processing_at<now()-interval '10 minutes'))
 order by telegram_update_id limit 10
 loop
 perform net.http_post(url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/telegram-ui',headers:=jsonb_build_object('Content-Type','application/json','x-telegram-bot-api-secret-token',public.get_bot_secret('telegram_webhook_secret')),body:=r.payload,timeout_milliseconds:=55000);v_count:=v_count+1;
 end loop;return v_count;
end $$;
select cron.schedule('telegram-inbox-recovery','* * * * *','select app_private.retry_telegram_updates();');
select cron.schedule('source-shadow-probes','*/5 * * * *', $cron$select net.http_post(url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-shadow',headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),body:='{}'::jsonb,timeout_milliseconds:=55000);$cron$);
select cron.schedule('shadow-history-cleanup','27 4 * * *',$cron$delete from app_private.source_shadow_runs where checked_at<now()-interval '30 days';delete from app_private.telegram_effects where update_id in(select telegram_update_id from public.bot_events where created_at<now()-interval '30 days' and processing_status='done');$cron$);
