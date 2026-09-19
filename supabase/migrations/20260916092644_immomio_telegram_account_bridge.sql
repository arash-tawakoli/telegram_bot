create or replace function app_private.telegram_api_call(p_method text, p_body jsonb)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_token text;
begin
  v_token := public.get_bot_secret('telegram_bot_token_runtime');
  if v_token is null or v_token = '' then
    raise exception 'telegram token unavailable';
  end if;
  return net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/' || p_method,
    body := p_body,
    params := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

create or replace function app_private.handle_immomio_telegram_update(p_payload jsonb, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_callback text := coalesce(p_payload #>> '{callback_query,data}','');
  v_text text := coalesce(p_payload #>> '{message,text}','');
  v_chat_id bigint := coalesce((p_payload #>> '{callback_query,message,chat,id}')::bigint,(p_payload #>> '{message,chat,id}')::bigint);
  v_message_id bigint := coalesce((p_payload #>> '{callback_query,message,message_id}')::bigint,(p_payload #>> '{message,message_id}')::bigint);
  v_status text;
  v_email text;
  v_verifier text;
  v_state text;
  v_challenge text;
  v_login_url text;
  v_callback_url text;
  v_markup jsonb;
  v_body jsonb;
  v_eligible boolean;
begin
  if p_user is null or v_chat_id is null then return false; end if;

  if v_callback in ('platforms:immomio','platforms:login:3','platforms:immomio-relogin','platforms:check:3','platforms:disconnect:3') then
    select public.application_user_eligible(p_user) into v_eligible;
    if v_eligible is distinct from true then
      perform app_private.telegram_api_call('editMessageText',jsonb_build_object(
        'chat_id',v_chat_id,'message_id',v_message_id,'parse_mode','HTML','disable_web_page_preview',true,
        'text','💎 Immomio-Verbindungen benötigen Premium.',
        'reply_markup',jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(jsonb_build_object('text','← Automatische Bewerbung','callback_data','platforms'))))
      ));
      return true;
    end if;

    if v_callback='platforms:disconnect:3' then
      delete from public.platform_auth_flows where user_id=p_user and provider='immomio';
      delete from public.platform_connections where user_id=p_user and provider='immomio';
      perform app_private.telegram_api_call('editMessageText',jsonb_build_object(
        'chat_id',v_chat_id,'message_id',v_message_id,'parse_mode','HTML','disable_web_page_preview',true,
        'text','🔐 <b>Immomio</b>\n\nVerbindung gelöscht.',
        'reply_markup',jsonb_build_object('inline_keyboard',jsonb_build_array(
          jsonb_build_array(jsonb_build_object('text','🔐 Immomio verbinden','callback_data','platforms:login:3')),
          jsonb_build_array(jsonb_build_object('text','← Automatische Bewerbung','callback_data','platforms'))
        ))
      ));
      return true;
    end if;

    select status into v_status from public.platform_connections where user_id=p_user and provider='immomio';
    if v_callback in ('platforms:immomio','platforms:check:3') and v_status='connected' then
      perform app_private.telegram_api_call('editMessageText',jsonb_build_object(
        'chat_id',v_chat_id,'message_id',v_message_id,'parse_mode','HTML','disable_web_page_preview',true,
        'text','🔐 <b>Immomio</b>\n\nStatus: 🟢 verbunden\n\nDein Immomio-Konto ist für den authentifizierten Bewerbungsweg hinterlegt.',
        'reply_markup',jsonb_build_object('inline_keyboard',jsonb_build_array(
          jsonb_build_array(jsonb_build_object('text','🔄 Neu verbinden','callback_data','platforms:immomio-relogin')),
          jsonb_build_array(jsonb_build_object('text','Immomio trennen','callback_data','platforms:disconnect:3')),
          jsonb_build_array(jsonb_build_object('text','← Automatische Bewerbung','callback_data','platforms'))
        ))
      ));
      return true;
    end if;

    select lower(trim(email)) into v_email from public.applicant_profiles where user_id=p_user;
    if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      perform app_private.telegram_api_call('editMessageText',jsonb_build_object(
        'chat_id',v_chat_id,'message_id',v_message_id,'parse_mode','HTML','disable_web_page_preview',true,
        'text','⚠️ Für Immomio fehlt im Bewerberprofil eine gültige E-Mail-Adresse.',
        'reply_markup',jsonb_build_object('inline_keyboard',jsonb_build_array(
          jsonb_build_array(jsonb_build_object('text','👤 Bewerberprofil','callback_data','platforms:profile')),
          jsonb_build_array(jsonb_build_object('text','← Automatische Bewerbung','callback_data','platforms'))
        ))
      ));
      return true;
    end if;

    v_verifier := translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_');
    v_state := substr(translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_'),1,40);
    v_challenge := translate(rtrim(encode(extensions.digest(convert_to(v_verifier,'UTF8'),'sha256'),'base64'),'='),'+/','-_');

    delete from public.platform_auth_flows where user_id=p_user and provider='immomio' and consumed_at is null;
    insert into public.platform_auth_flows(user_id,provider,state,code_verifier,expires_at)
    values(p_user,'immomio',v_state,v_verifier,now()+interval '10 minutes');

    insert into public.platform_connections(user_id,provider,status,account_hint,credential_ciphertext,credential_iv,expires_at,last_error,updated_at)
    values(p_user,'immomio','pending',v_email,null,null,null,null,now())
    on conflict(user_id,provider) do update set
      status='pending',account_hint=excluded.account_hint,credential_ciphertext=null,credential_iv=null,expires_at=null,last_error=null,updated_at=now();

    v_login_url := 'https://sso.immomio.com/auth/realms/immomio/protocol/openid-connect/auth?client_id=immomio-oidc-web&redirect_uri=https%3A%2F%2Ftenant.immomio.com%2Fassets%2Fmanifest.webmanifest&response_type=code&scope=openid+profile+email&state=' || v_state || '&code_challenge=' || v_challenge || '&code_challenge_method=S256&prompt=login';
    v_markup := jsonb_build_object('inline_keyboard',jsonb_build_array(
      jsonb_build_array(jsonb_build_object('text','🌐 Immomio-Login öffnen','url',v_login_url)),
      jsonb_build_array(jsonb_build_object('text','← Automatische Bewerbung','callback_data','platforms'))
    ));
    perform app_private.telegram_api_call('editMessageText',jsonb_build_object(
      'chat_id',v_chat_id,'message_id',v_message_id,'parse_mode','HTML','disable_web_page_preview',true,
      'text','🔐 <b>Immomio verbinden</b>\n\n1. Öffne Immomio und melde dich mit deinem normalen Immomio-Konto an.\n2. Auf der Abschlussseite: <b>Teilen → Telegram → Traumwohnung – Hamburg → Senden</b>.\n\nDer Bot übernimmt den Rücksprung automatisch. Dein Passwort bleibt bei Immomio.',
      'reply_markup',v_markup
    ));
    return true;
  end if;

  if v_text like '%https://tenant.immomio.com/assets/manifest.webmanifest%' then
    v_callback_url := substring(v_text from '(https://tenant[.]immomio[.]com/assets/manifest[.]webmanifest[^[:space:]<>]*)');
    if v_callback_url is null or position('code=' in v_callback_url)=0 or position('state=' in v_callback_url)=0 then return false; end if;
    v_callback_url := regexp_replace(v_callback_url, '[\])},.;!?]+$', '');

    perform app_private.telegram_api_call('deleteMessage',jsonb_build_object('chat_id',v_chat_id,'message_id',v_message_id));
    perform net.http_post(
      url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/immomio-account',
      body := jsonb_build_object('action','complete_login','userId',p_user,'callbackUrl',v_callback_url),
      params := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
      timeout_milliseconds := 45000
    );
    perform app_private.telegram_api_call('sendMessage',jsonb_build_object(
      'chat_id',v_chat_id,'parse_mode','HTML','disable_web_page_preview',true,
      'text','⏳ Immomio-Anmeldung wird abgeschlossen …'
    ));
    return true;
  end if;
  return false;
end;
$$;

create or replace function app_private.notify_immomio_connection_status()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_chat bigint; v_markup jsonb;
begin
  if new.provider <> 'immomio' then return new; end if;
  if tg_op='UPDATE' and old.status is not distinct from new.status then return new; end if;
  select chat_id into v_chat from public.bot_users where id=new.user_id;
  if v_chat is null then return new; end if;
  if new.status='connected' then
    v_markup := jsonb_build_object('inline_keyboard',jsonb_build_array(
      jsonb_build_array(jsonb_build_object('text','🔐 Immomio','callback_data','platforms:immomio')),
      jsonb_build_array(jsonb_build_object('text','⚡ Automatische Bewerbung','callback_data','platforms'))
    ));
    perform app_private.telegram_api_call('sendMessage',jsonb_build_object(
      'chat_id',v_chat,'parse_mode','HTML','disable_web_page_preview',true,
      'text','✅ <b>Immomio verbunden</b>\n\nDie Anmeldung ist verschlüsselt gespeichert. Als Nächstes kann der kontrollierte Sendetest durchgeführt werden.',
      'reply_markup',v_markup
    ));
  elsif new.status='needs_login' then
    perform app_private.telegram_api_call('sendMessage',jsonb_build_object(
      'chat_id',v_chat,'parse_mode','HTML','disable_web_page_preview',true,
      'text','🔐 Immomio muss erneut verbunden werden.',
      'reply_markup',jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(jsonb_build_object('text','🔐 Immomio verbinden','callback_data','platforms:login:3'))))
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_immomio_connection_status on public.platform_connections;
create trigger trg_immomio_connection_status
after insert or update of status on public.platform_connections
for each row execute function app_private.notify_immomio_connection_status();

create or replace function public.prepare_telegram_update(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claim integer;
  v_update_id bigint := (p_payload->>'update_id')::bigint;
  v_user_id bigint := coalesce((p_payload #>> '{callback_query,from,id}')::bigint,(p_payload #>> '{message,from,id}')::bigint);
  v_chat_id bigint := coalesce((p_payload #>> '{callback_query,message,chat,id}')::bigint,(p_payload #>> '{message,chat,id}')::bigint);
  v_username text := coalesce(p_payload #>> '{callback_query,from,username}',p_payload #>> '{message,from,username}');
  v_first_name text := coalesce(p_payload #>> '{callback_query,from,first_name}',p_payload #>> '{message,from,first_name}');
  v_last_name text := coalesce(p_payload #>> '{callback_query,from,last_name}',p_payload #>> '{message,from,last_name}');
  v_language_code text := coalesce(p_payload #>> '{callback_query,from,language_code}',p_payload #>> '{message,from,language_code}');
  v_user public.bot_users%rowtype;
  v_subscription public.user_subscriptions%rowtype;
  v_is_new boolean := false;
begin
  if v_user_id is null or v_chat_id is null then raise exception 'missing telegram user or chat id'; end if;
  v_claim := public.claim_telegram_update(p_payload);
  if v_claim <= 0 then return jsonb_build_object('claim',v_claim); end if;

  select * into v_user from public.bot_users where telegram_user_id=v_user_id;
  if found then
    if v_user.chat_id is distinct from v_chat_id or v_user.username is distinct from v_username or v_user.first_name is distinct from v_first_name or v_user.last_name is distinct from v_last_name or v_user.language_code is distinct from v_language_code then
      update public.bot_users set chat_id=v_chat_id,username=v_username,first_name=v_first_name,last_name=v_last_name,language_code=v_language_code,updated_at=now() where id=v_user.id returning * into v_user;
    end if;
  else
    insert into public.bot_users(telegram_user_id,chat_id,username,first_name,last_name,language_code,last_start_at)
    values(v_user_id,v_chat_id,v_username,v_first_name,v_last_name,v_language_code,now()) returning * into v_user;
    v_is_new:=true;
  end if;

  select * into v_subscription from public.user_subscriptions where user_id=v_user.id;

  if app_private.handle_immomio_telegram_update(p_payload,v_user.id) then
    update public.bot_events set payload=jsonb_build_object('update_id',v_update_id,'redacted','immomio_auth_ui'),processing_status='done',processed_at=now(),processing_error=null where telegram_update_id=v_update_id and processing_attempt=v_claim;
    return jsonb_build_object('claim',0,'handled','immomio');
  end if;

  return jsonb_build_object('claim',v_claim,'is_new_user',v_is_new,'user',to_jsonb(v_user),'subscription',case when v_subscription.id is null then null else to_jsonb(v_subscription) end);
end;
$$;