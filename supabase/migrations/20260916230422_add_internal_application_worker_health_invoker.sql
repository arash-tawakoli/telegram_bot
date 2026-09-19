create or replace function app_private.invoke_application_worker_health()
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select public.get_bot_secret('internal_worker_secret') into v_secret;
  if v_secret is null or v_secret = '' then
    raise exception 'configuration_unavailable';
  end if;
  select net.http_post(
    url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/application-worker',
    headers := jsonb_build_object('content-type','application/json','x-internal-secret',v_secret),
    body := jsonb_build_object('action','health'),
    timeout_milliseconds := 15000
  ) into v_request_id;
  return v_request_id;
end
$$;

revoke all on function app_private.invoke_application_worker_health() from public, anon, authenticated;
grant execute on function app_private.invoke_application_worker_health() to service_role;