-- Telegram identities are backend-owned, not auth.users identities.
create table public.platform_sessions (
 user_id uuid not null references public.bot_users(id) on delete restrict,
 source_id bigint not null references public.sources(id),
 context_id uuid,
 session_id uuid,
 status text not null default 'needs_login' check(status in ('needs_login','login','saved','disconnecting')),
 lease_token uuid,
 lease_until timestamptz,
 updated_at timestamptz not null default now(),
 primary key(user_id,source_id),
 check(source_id in (1,2))
);
alter table public.platform_sessions enable row level security;
revoke all on public.platform_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.platform_sessions to service_role;
create index platform_sessions_source_idx on public.platform_sessions(source_id);
grant select on app_private.application_platforms to service_role;

create function public.claim_platform_session(p_user uuid,p_source bigint,p_disconnect boolean default false)
returns setof public.platform_sessions language plpgsql security definer set search_path='' as $$
begin
 if p_user is null or p_source is null or p_source not in (1,2) or p_disconnect is null then return; end if;
 if not p_disconnect and not exists(select 1 from public.bot_users where id=p_user and is_active and app_private.user_is_premium(id)) then return; end if;
 insert into public.platform_sessions(user_id,source_id) values(p_user,p_source) on conflict do nothing;
 return query update public.platform_sessions set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now()
 where user_id=p_user and source_id=p_source and (lease_until is null or lease_until<now()) returning *;
end $$;
revoke all on function public.claim_platform_session(uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.claim_platform_session(uuid,bigint,boolean) to service_role;

alter table public.applications add column lease_token uuid, add column lease_until timestamptz,
 add column next_attempt_at timestamptz not null default now();
create index applications_pending_idx on public.applications(next_attempt_at) where status='pending';

create function public.application_user_eligible(p_user uuid) returns boolean
language sql security definer set search_path='' stable as $$
 select exists(select 1 from public.bot_users where id=p_user and is_active and app_private.user_is_premium(id));
$$;
revoke all on function public.application_user_eligible(uuid) from public,anon,authenticated;
grant execute on function public.application_user_eligible(uuid) to service_role;

create function app_private.enqueue_matched_application() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.applications(user_id,listing_id,source_id)
 select u.id,l.id,l.source_id from public.bot_users u join public.listings l on l.id=new.listing_id
 join app_private.application_platforms p on p.source_id=l.source_id and p.verified_at is not null
 where u.id=new.recipient_user_id and u.is_active and u.auto_apply_enabled and app_private.user_is_premium(u.id)
 and l.is_active and l.source_id in (1,2) and app_private.current_listing_is_delivery_fresh(l.source_id,l.raw,l.fresh_delivery_eligible)
 on conflict(user_id,listing_id) do nothing;
 return new;
end $$;
revoke all on function app_private.enqueue_matched_application() from public,anon,authenticated;
create trigger enqueue_matched_application after insert on public.delivery_events
for each row execute function app_private.enqueue_matched_application();

create function public.claim_application() returns setof public.applications
language plpgsql security definer set search_path='' as $$
begin
 -- Never retry a request after the remote-send boundary, even if its worker died.
 update public.applications set status='manual_required',last_error='submission_unconfirmed'
 where status='processing' and submission_started_at is not null and (lease_until is null or lease_until<now());
 return query update public.applications set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 where id=(select id from public.applications where status='pending' and submission_started_at is null
 and next_attempt_at<=now() and (lease_until is null or lease_until<now()) order by next_attempt_at for update skip locked limit 1)
 returning *;
end $$;
revoke all on function public.claim_application() from public,anon,authenticated;
grant execute on function public.claim_application() to service_role;

create function public.authorize_application_send(p_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.applications%rowtype;
begin
 select * into a from public.applications where id=p_id for update;
 if not found or p_token is null or a.lease_token is distinct from p_token or a.lease_until is null or a.lease_until<=now() then return false; end if;
 return public.begin_application_submission(p_id);
end $$;
revoke all on function public.authorize_application_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_application_send(uuid,uuid) to service_role;

-- Reuse Supabase Cron. No Edge invocation when the work list is empty.
do $schedule$
begin
 if exists(select 1 from pg_namespace where nspname='cron') then
  perform cron.schedule('platform-applications','* * * * *',$job$
   select net.http_post(
    url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/application-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
    body:='{"action":"process"}'::jsonb,timeout_milliseconds:=55000)
   where exists(select 1 from public.applications where
    (status='pending' and next_attempt_at<=now() and (lease_until is null or lease_until<now()))
    or (status='processing' and (lease_until is null or lease_until<now())));
  $job$);
 end if;
end $schedule$;
;

