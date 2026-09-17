create or replace function app_private.invoke_kleinanzeigen_worker_probe(p_user uuid,p_listing uuid)
returns bigint
language sql
security definer
set search_path to ''
as $$
  select net.http_post(
    url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-application-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
    body := jsonb_build_object('action','probe','userId',p_user::text,'listingId',p_listing::text),
    timeout_milliseconds := 30000
  )
$$;
revoke all on function app_private.invoke_kleinanzeigen_worker_probe(uuid,uuid) from public, anon, authenticated;
grant execute on function app_private.invoke_kleinanzeigen_worker_probe(uuid,uuid) to service_role;
