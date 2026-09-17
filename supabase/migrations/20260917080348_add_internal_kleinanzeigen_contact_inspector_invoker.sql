create or replace function app_private.invoke_kleinanzeigen_contact_inspect(p_user uuid,p_listing uuid,p_action text default 'form')
returns bigint
language sql
security definer
set search_path to ''
as $$
  select net.http_post(
    url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-contact-inspect',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
    body := jsonb_build_object('userId',p_user::text,'listingId',p_listing::text,'action',p_action),
    timeout_milliseconds := 30000
  )
$$;
revoke all on function app_private.invoke_kleinanzeigen_contact_inspect(uuid,uuid,text) from public, anon, authenticated;
grant execute on function app_private.invoke_kleinanzeigen_contact_inspect(uuid,uuid,text) to service_role;
