-- RECONSTRUCTED EQUIVALENT from the live catalog captured 2026-10-21.
-- Original historical SQL bytes were not recoverable; this migration restores the observed contract.

create table if not exists public.user_engagement_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bot_users(id) on delete cascade,
  campaign_key text not null,
  status text not null default 'pending' check (status = any (array['pending','processing','sent','failed','cancelled']::text[])),
  scheduled_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  sent_at timestamptz,
  clicked_at timestamptz,
  feedback_value text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_engagement_notifications_user_id_campaign_key_key unique (user_id,campaign_key)
);
create index if not exists user_engagement_notifications_due_idx
  on public.user_engagement_notifications(status,available_at,created_at)
  where status in ('pending','processing');
create index if not exists user_engagement_notifications_user_idx
  on public.user_engagement_notifications(user_id,campaign_key,sent_at desc);
alter table public.user_engagement_notifications enable row level security;
revoke all on table public.user_engagement_notifications from public,anon,authenticated;
grant all on table public.user_engagement_notifications to service_role;

CREATE OR REPLACE FUNCTION public.materialize_engagement_notifications(p_now timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer := 0;
begin
  if p_limit is null or p_limit < 1 then
    return 0;
  end if;

  with candidates(user_id, campaign_key, scheduled_at) as (
    select u.id, 'profile_reminder_24h', u.created_at
    from public.bot_users u
    where u.is_active
      and u.chat_id is not null
      and u.engagement_notifications_enabled
      and u.created_at <= p_now - interval '24 hours'
      and not exists (
        select 1 from public.search_profiles p
        where p.user_id = u.id and p.is_active
      )

    union all

    select u.id, 'profile_reminder_72h', u.created_at + interval '72 hours'
    from public.bot_users u
    where u.is_active
      and u.chat_id is not null
      and u.engagement_notifications_enabled
      and u.created_at <= p_now - interval '72 hours'
      and not exists (
        select 1 from public.search_profiles p
        where p.user_id = u.id and p.is_active
      )
      and exists (
        select 1 from public.user_engagement_notifications n
        where n.user_id = u.id
          and n.campaign_key = 'profile_reminder_24h'
          and n.status = 'sent'
          and n.sent_at <= p_now - interval '48 hours'
      )

    union all

    select u.id, 'platform_reminder_24h', min(p.created_at) + interval '24 hours'
    from public.bot_users u
    join public.search_profiles p on p.user_id = u.id and p.is_active
    where u.is_active
      and u.chat_id is not null
      and u.engagement_notifications_enabled
      and app_private.user_is_premium(u.id)
      and not exists (
        select 1 from public.platform_connections c
        where c.user_id = u.id and c.status = 'connected'
      )
    group by u.id
    having min(p.created_at) <= p_now - interval '24 hours'

    union all

    select u.id, 'autoapply_reminder_3d', max(c.updated_at) + interval '3 days'
    from public.bot_users u
    join public.platform_connections c on c.user_id = u.id and c.status = 'connected'
    where u.is_active
      and u.chat_id is not null
      and u.engagement_notifications_enabled
      and u.auto_apply_enabled = false
      and app_private.user_is_premium(u.id)
    group by u.id
    having max(c.updated_at) <= p_now - interval '3 days'

    union all

    select u.id, 'feedback_day7', min(p.created_at) + interval '7 days'
    from public.bot_users u
    join public.search_profiles p on p.user_id = u.id and p.is_active
    where u.is_active
      and u.chat_id is not null
      and u.engagement_notifications_enabled
    group by u.id
    having min(p.created_at) <= p_now - interval '7 days'

    union all

    select u.id, 'premium_day14', min(p.created_at) + interval '14 days'
    from public.bot_users u
    join public.search_profiles p on p.user_id = u.id and p.is_active
    where u.is_active
      and u.chat_id is not null
      and u.engagement_notifications_enabled
      and not app_private.user_is_premium(u.id)
    group by u.id
    having min(p.created_at) <= p_now - interval '14 days'

    union all

    select u.id, 'premium_day30', min(p.created_at) + interval '30 days'
    from public.bot_users u
    join public.search_profiles p on p.user_id = u.id and p.is_active
    where u.is_active
      and u.chat_id is not null
      and u.engagement_notifications_enabled
      and not app_private.user_is_premium(u.id)
    group by u.id
    having min(p.created_at) <= p_now - interval '30 days'

    union all

    select u.id, 'reactivation_day21', greatest(u.created_at, coalesce(u.last_start_at, u.created_at)) + interval '21 days'
    from public.bot_users u
    where u.is_active
      and u.chat_id is not null
      and u.engagement_notifications_enabled
      and exists (
        select 1 from public.search_profiles p
        where p.user_id = u.id and p.is_active
      )
      and not exists (
        select 1 from public.bot_events e
        where e.telegram_user_id = u.telegram_user_id
          and e.created_at > p_now - interval '21 days'
      )
      and greatest(u.created_at, coalesce(u.last_start_at, u.created_at)) <= p_now - interval '21 days'

    union all

    select u.id, 'reactivation_monthly_' || to_char(p_now at time zone 'Europe/Berlin', 'YYYYMM'), p_now
    from public.bot_users u
    where u.is_active
      and u.chat_id is not null
      and u.engagement_notifications_enabled
      and u.created_at <= p_now - interval '45 days'
      and exists (
        select 1 from public.search_profiles p
        where p.user_id = u.id and p.is_active
      )
      and not exists (
        select 1 from public.bot_events e
        where e.telegram_user_id = u.telegram_user_id
          and e.created_at > p_now - interval '30 days'
      )
      and not exists (
        select 1 from public.user_engagement_notifications n
        where n.user_id = u.id
          and n.campaign_key like 'reactivation_%'
          and n.sent_at > p_now - interval '30 days'
      )
  )
  insert into public.user_engagement_notifications(user_id, campaign_key, scheduled_at, available_at)
  select c.user_id, c.campaign_key, c.scheduled_at, greatest(c.scheduled_at, p_now)
  from candidates c
  order by c.scheduled_at
  limit p_limit
  on conflict (user_id, campaign_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$function$;

revoke all on function public.materialize_engagement_notifications(timestamp with time zone,integer) from public,anon,authenticated;
grant execute on function public.materialize_engagement_notifications(timestamp with time zone,integer) to service_role;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='telegram-engagement-hourly' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  perform cron.schedule('telegram-engagement-hourly','15 * * * *',$job$
    select net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/telegram-engagement',
      headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
      body:='{"action":"run"}'::jsonb,
      timeout_milliseconds:=55000
    );
  $job$);
end $$;
