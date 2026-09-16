create or replace function app_private.invoke_immoscout_canary(
  p_action text,
  p_user uuid,
  p_listing uuid,
  p_confirm text default null
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_secret text;
  v_request_id bigint;
  v_timeout integer;
begin
  if p_action not in ('inspect','send_once') then
    raise exception 'invalid_action';
  end if;

  select public.get_bot_secret('internal_worker_secret') into v_secret;
  if v_secret is null or v_secret = '' then
    raise exception 'configuration_unavailable';
  end if;

  v_timeout := case when p_action = 'send_once' then 45000 else 15000 end;

  select net.http_post(
    url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/immoscout-send-canary',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-internal-secret',v_secret
    ),
    body := jsonb_strip_nulls(jsonb_build_object(
      'action',p_action,
      'userId',p_user,
      'listingId',p_listing,
      'confirm',p_confirm
    )),
    timeout_milliseconds := v_timeout
  ) into v_request_id;

  return v_request_id;
end
$$;

revoke all on function app_private.invoke_immoscout_canary(text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function app_private.invoke_immoscout_canary(text,uuid,uuid,text) to service_role;

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
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-internal-secret',v_secret
    ),
    body := jsonb_build_object('action','health'),
    timeout_milliseconds := 15000
  ) into v_request_id;

  return v_request_id;
end
$$;

revoke all on function app_private.invoke_application_worker_health() from public, anon, authenticated;
grant execute on function app_private.invoke_application_worker_health() to service_role;
