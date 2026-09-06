create or replace function public.prepare_telegram_update(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim integer;
  v_user_id bigint := coalesce(
    (p_payload #>> '{callback_query,from,id}')::bigint,
    (p_payload #>> '{message,from,id}')::bigint
  );
  v_chat_id bigint := coalesce(
    (p_payload #>> '{callback_query,message,chat,id}')::bigint,
    (p_payload #>> '{message,chat,id}')::bigint
  );
  v_username text := coalesce(
    p_payload #>> '{callback_query,from,username}',
    p_payload #>> '{message,from,username}'
  );
  v_first_name text := coalesce(
    p_payload #>> '{callback_query,from,first_name}',
    p_payload #>> '{message,from,first_name}'
  );
  v_last_name text := coalesce(
    p_payload #>> '{callback_query,from,last_name}',
    p_payload #>> '{message,from,last_name}'
  );
  v_language_code text := coalesce(
    p_payload #>> '{callback_query,from,language_code}',
    p_payload #>> '{message,from,language_code}'
  );
  v_user public.bot_users%rowtype;
  v_subscription public.user_subscriptions%rowtype;
  v_is_new boolean := false;
begin
  if v_user_id is null or v_chat_id is null then
    raise exception 'missing telegram user or chat id';
  end if;

  v_claim := public.claim_telegram_update(p_payload);
  if v_claim <= 0 then
    return jsonb_build_object('claim', v_claim);
  end if;

  select * into v_user
  from public.bot_users
  where telegram_user_id = v_user_id;

  if found then
    if v_user.chat_id is distinct from v_chat_id
       or v_user.username is distinct from v_username
       or v_user.first_name is distinct from v_first_name
       or v_user.last_name is distinct from v_last_name
       or v_user.language_code is distinct from v_language_code then
      update public.bot_users
      set chat_id = v_chat_id,
          username = v_username,
          first_name = v_first_name,
          last_name = v_last_name,
          language_code = v_language_code,
          updated_at = now()
      where id = v_user.id
      returning * into v_user;
    end if;
  else
    insert into public.bot_users(
      telegram_user_id,
      chat_id,
      username,
      first_name,
      last_name,
      language_code,
      last_start_at
    ) values (
      v_user_id,
      v_chat_id,
      v_username,
      v_first_name,
      v_last_name,
      v_language_code,
      now()
    )
    returning * into v_user;
    v_is_new := true;
  end if;

  select * into v_subscription
  from public.user_subscriptions
  where user_id = v_user.id;

  return jsonb_build_object(
    'claim', v_claim,
    'is_new_user', v_is_new,
    'user', to_jsonb(v_user),
    'subscription', case when v_subscription.id is null then null else to_jsonb(v_subscription) end
  );
end;
$$;

revoke all on function public.prepare_telegram_update(jsonb) from public, anon, authenticated;
grant execute on function public.prepare_telegram_update(jsonb) to service_role;