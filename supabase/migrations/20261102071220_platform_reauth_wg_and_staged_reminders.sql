alter table public.platform_reauth_notifications
  drop constraint if exists platform_reauth_notifications_provider_check;
alter table public.platform_reauth_notifications
  add constraint platform_reauth_notifications_provider_check
  check (provider = any (array['immoscout','immowelt','immomio','kleinanzeigen','wg_gesucht']::text[]));

alter table public.platform_reauth_notifications
  add column if not exists reminder_stage smallint not null default 0
  check (reminder_stage between 0 and 3);

create or replace function app_private.enqueue_platform_reauth_notification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
    where u.id=new.user_id and u.is_active
      and (u.auto_apply_enabled or (u.test_auto_apply_allowed and u.test_auto_apply_enabled))
  )
  and (
    app_private.application_provider_preference_enabled(new.user_id,new.provider)
    or (new.provider='immoscout' and exists (
      select 1 from public.bot_users u
      where u.id=new.user_id and u.test_auto_apply_allowed and u.test_auto_apply_enabled
    ))
  )
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
    insert into public.platform_reauth_notifications(user_id,provider,reason,reminder_stage,available_at)
    values (new.user_id,new.provider,coalesce(nullif(new.last_error,''),'needs_login'),0,now());
  end if;
  return new;
end
$function$;

revoke all on function app_private.enqueue_platform_reauth_notification() from public,anon,authenticated;
grant execute on function app_private.enqueue_platform_reauth_notification() to service_role;
