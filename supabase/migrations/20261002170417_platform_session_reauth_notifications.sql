-- RECONSTRUCTED EQUIVALENT from the live catalog captured 2026-10-21.
-- Original historical SQL bytes were not recoverable; this migration restores the observed contract.

create table if not exists public.platform_reauth_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  provider text not null check (provider = any (array['immoscout','immowelt','immomio','kleinanzeigen']::text[])),
  reason text not null default 'needs_login',
  status text not null default 'pending' check (status = any (array['pending','sending','sent','failed','resolved']::text[])),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists platform_reauth_notifications_open_idx
  on public.platform_reauth_notifications(user_id,provider) where status in ('pending','sending');
create index if not exists platform_reauth_notifications_ready_idx
  on public.platform_reauth_notifications(status,available_at,created_at);
create index if not exists platform_reauth_notifications_user_provider_idx
  on public.platform_reauth_notifications(user_id,provider,created_at desc);
alter table public.platform_reauth_notifications enable row level security;
revoke all on table public.platform_reauth_notifications from public,anon,authenticated;
grant all on table public.platform_reauth_notifications to service_role;

CREATE OR REPLACE FUNCTION app_private.enqueue_platform_reauth_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status <> 'needs_login'
     or (tg_op = 'UPDATE' and old.status is not distinct from 'needs_login')
  then
    if new.status = 'connected' and (tg_op = 'INSERT' or old.status is distinct from 'connected') then
      update public.platform_reauth_notifications
      set status='resolved', updated_at=now()
      where user_id=new.user_id and provider=new.provider
        and status in ('pending','sending','sent','failed');
    end if;
    return new;
  end if;

  if exists (
    select 1 from public.bot_users u
    where u.id=new.user_id and u.is_active and u.auto_apply_enabled
      and public.application_user_eligible(u.id)
  )
  and app_private.application_provider_preference_enabled(new.user_id,new.provider)
  and not exists (
    select 1 from public.platform_reauth_notifications n
    where n.user_id=new.user_id and n.provider=new.provider
      and n.status in ('pending','sending')
  )
  and not exists (
    select 1 from public.platform_reauth_notifications n
    where n.user_id=new.user_id and n.provider=new.provider
      and n.status='sent' and n.last_sent_at > now()-interval '24 hours'
  )
  then
    insert into public.platform_reauth_notifications(user_id,provider,reason)
    values (new.user_id,new.provider,coalesce(nullif(new.last_error,''),'needs_login'));
  end if;
  return new;
end
$function$;

drop trigger if exists platform_connections_enqueue_reauth on public.platform_connections;
create trigger platform_connections_enqueue_reauth
after insert or update of status on public.platform_connections
for each row execute function app_private.enqueue_platform_reauth_notification();

revoke all on function app_private.enqueue_platform_reauth_notification() from public,anon,authenticated;
grant execute on function app_private.enqueue_platform_reauth_notification() to service_role;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='platform-session-reminder' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  perform cron.schedule('platform-session-reminder','*/10 * * * *',$job$
    select net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/platform-session-reminder',
      headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
      body:='{"action":"run"}'::jsonb,
      timeout_milliseconds:=55000
    )
    where exists (select 1 from public.platform_reauth_notifications n where n.status='pending' and n.available_at<=now())
       or exists (select 1 from public.platform_connections c join public.bot_users u on u.id=c.user_id where c.status='connected' and u.is_active and u.auto_apply_enabled);
  $job$);
end $$;
