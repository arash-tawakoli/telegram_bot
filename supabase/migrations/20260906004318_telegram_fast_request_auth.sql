create or replace function public.prepare_telegram_fast_request(p_payload jsonb, p_action text, p_supplied_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_result jsonb;
begin
  v_expected := public.get_bot_secret('telegram_webhook_secret');
  if v_expected is null or p_supplied_secret is distinct from v_expected then
    return jsonb_build_object('authorized', false);
  end if;

  v_result := public.prepare_telegram_fast_action(p_payload, p_action);
  return jsonb_build_object('authorized', true) || v_result;
end;
$$;

revoke all on function public.prepare_telegram_fast_request(jsonb,text,text) from public, anon, authenticated;
grant execute on function public.prepare_telegram_fast_request(jsonb,text,text) to service_role;