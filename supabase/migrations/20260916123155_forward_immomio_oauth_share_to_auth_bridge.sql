create or replace function app_private.forward_immomio_oauth_share()
returns trigger
language plpgsql
security definer
set search_path = public, app_private, net, extensions
as $$
declare
  v_text text;
  v_user_id uuid;
begin
  v_text := new.payload->'message'->>'text';
  if new.telegram_user_id is null
     or v_text is null
     or v_text not like 'https://tenant.immomio.com/robots.txt?%'
  then
    return new;
  end if;

  select id into v_user_id
  from public.bot_users
  where telegram_user_id = new.telegram_user_id
  limit 1;

  if v_user_id is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/immomio-auth-bridge',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret',public.get_bot_secret('internal_worker_secret')
    ),
    body := jsonb_build_object(
      'action','complete_latest',
      'userId',v_user_id::text
    )
  );

  return new;
exception when others then
  return new;
end;
$$;

revoke all on function app_private.forward_immomio_oauth_share() from public;

drop trigger if exists trg_forward_immomio_oauth_share on public.bot_events;
create trigger trg_forward_immomio_oauth_share
after insert on public.bot_events
for each row
execute function app_private.forward_immomio_oauth_share();