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
begin
  if p_action not in ('inspect','send_once') then
    raise exception 'invalid_action';
  end if;
  select public.get_bot_secret('internal_worker_secret') into v_secret;
  if v_secret is null or v_secret = '' then
    raise exception 'configuration_unavailable';
  end if;
  select net.http_post(
    url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/immoscout-send-canary',
    headers := jsonb_build_object('content-type','application/json','x-internal-secret',v_secret),
    body := jsonb_strip_nulls(jsonb_build_object(
      'action',p_action,
      'userId',p_user,
      'listingId',p_listing,
      'confirm',p_confirm
    ))
  ) into v_request_id;
  return v_request_id;
end
$$;

revoke all on function app_private.invoke_immoscout_canary(text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function app_private.invoke_immoscout_canary(text,uuid,uuid,text) to service_role;