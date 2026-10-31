begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists app_private.immoscout_central_credentials (
  singleton smallint primary key default 1 check (singleton = 1),
  credential_ciphertext text not null,
  credential_iv text not null,
  key_version smallint not null default 1 check (key_version > 0),
  account_hint text not null check (lower(account_hint) = 'arash@nexalabs.de'),
  status text not null default 'connected' check (status in ('connected','needs_login','error')),
  expires_at timestamptz,
  last_verified_at timestamptz not null default now(),
  last_error text,
  connected_by uuid references public.bot_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(credential_ciphertext) between 1 and 20000),
  check (length(credential_iv) between 1 and 128)
);

alter table app_private.immoscout_central_credentials enable row level security;
alter table app_private.immoscout_central_credentials force row level security;
revoke all on app_private.immoscout_central_credentials from public, anon, authenticated;
grant select, insert, update, delete on app_private.immoscout_central_credentials to service_role;
drop policy if exists immoscout_central_credentials_deny_client_access on app_private.immoscout_central_credentials;
create policy immoscout_central_credentials_deny_client_access
  on app_private.immoscout_central_credentials
  as restrictive for all to anon, authenticated
  using (false) with check (false);

create or replace function public.claim_immoscout_central_auth_flow(
  p_flow uuid,
  p_user uuid,
  p_claim text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(p_claim,'') !~ '^[A-Za-z0-9_-]{20,100}$' then
    return false;
  end if;

  update public.platform_auth_flows f
  set context = coalesce(f.context,'{}'::jsonb) || jsonb_build_object('completion_claim',p_claim)
  where f.id = p_flow
    and f.user_id = p_user
    and f.provider = 'immoscout'
    and f.origin = 'telegram'
    and f.context->>'central_account' = 'true'
    and f.context->>'completion_claim' is null
    and f.consumed_at is null
    and f.expires_at > clock_timestamp()
    and exists (
      select 1
      from public.bot_users u
      where u.id = p_user
        and u.is_active
        and u.telegram_user_id in (8538226539,414638980)
    );

  return found;
end
$function$;

create or replace function public.complete_immoscout_central_auth_flow(
  p_flow uuid,
  p_user uuid,
  p_claim text,
  p_credential_ciphertext text,
  p_credential_iv text,
  p_key_version smallint,
  p_account_hint text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(p_claim,'') !~ '^[A-Za-z0-9_-]{20,100}$'
     or coalesce(p_credential_ciphertext,'') = ''
     or coalesce(p_credential_iv,'') = ''
     or coalesce(p_key_version,0) <= 0
     or lower(trim(coalesce(p_account_hint,''))) <> 'arash@nexalabs.de'
     or p_expires_at is null then
    raise exception 'central_credential_invalid';
  end if;

  update public.platform_auth_flows f
  set consumed_at = clock_timestamp(),
      context = coalesce(f.context,'{}'::jsonb) || jsonb_build_object('completed_at',clock_timestamp())
  where f.id = p_flow
    and f.user_id = p_user
    and f.provider = 'immoscout'
    and f.origin = 'telegram'
    and f.context->>'central_account' = 'true'
    and f.context->>'completion_claim' = p_claim
    and f.consumed_at is null
    and f.expires_at > clock_timestamp()
    and exists (
      select 1
      from public.bot_users u
      where u.id = p_user
        and u.is_active
        and u.telegram_user_id in (8538226539,414638980)
    );

  if not found then
    return false;
  end if;

  insert into app_private.immoscout_central_credentials (
    singleton, credential_ciphertext, credential_iv, key_version,
    account_hint, status, expires_at, last_verified_at, last_error,
    connected_by, updated_at
  ) values (
    1, p_credential_ciphertext, p_credential_iv, p_key_version,
    lower(trim(p_account_hint)), 'connected', p_expires_at, clock_timestamp(), null,
    p_user, clock_timestamp()
  )
  on conflict (singleton) do update set
    credential_ciphertext = excluded.credential_ciphertext,
    credential_iv = excluded.credential_iv,
    key_version = excluded.key_version,
    account_hint = excluded.account_hint,
    status = 'connected',
    expires_at = excluded.expires_at,
    last_verified_at = clock_timestamp(),
    last_error = null,
    connected_by = excluded.connected_by,
    updated_at = clock_timestamp();

  return true;
end
$function$;

create or replace function public.get_immoscout_central_credentials()
returns table (
  credential_ciphertext text,
  credential_iv text,
  key_version smallint,
  account_hint text,
  status text,
  expires_at timestamptz,
  last_verified_at timestamptz,
  last_error text
)
language sql
security definer
set search_path = ''
stable
as $function$
  select c.credential_ciphertext, c.credential_iv, c.key_version,
         c.account_hint, c.status, c.expires_at, c.last_verified_at, c.last_error
  from app_private.immoscout_central_credentials c
  where c.singleton = 1;
$function$;

create or replace function public.get_immoscout_central_credential_status()
returns table (
  configured boolean,
  account_hint text,
  status text,
  expires_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  updated_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $function$
  select true, c.account_hint, c.status, c.expires_at,
         c.last_verified_at, c.last_error, c.updated_at
  from app_private.immoscout_central_credentials c
  where c.singleton = 1
  union all
  select false, null::text, 'disconnected'::text, null::timestamptz,
         null::timestamptz, null::text, null::timestamptz
  where not exists (select 1 from app_private.immoscout_central_credentials);
$function$;

create or replace function public.update_immoscout_central_credentials(
  p_credential_ciphertext text,
  p_credential_iv text,
  p_key_version smallint,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(p_credential_ciphertext,'') = ''
     or coalesce(p_credential_iv,'') = ''
     or coalesce(p_key_version,0) <= 0
     or p_expires_at is null then
    raise exception 'central_credential_invalid';
  end if;

  update app_private.immoscout_central_credentials
  set credential_ciphertext = p_credential_ciphertext,
      credential_iv = p_credential_iv,
      key_version = p_key_version,
      expires_at = p_expires_at,
      status = 'connected',
      last_verified_at = clock_timestamp(),
      last_error = null,
      updated_at = clock_timestamp()
  where singleton = 1;

  return found;
end
$function$;

create or replace function public.mark_immoscout_central_credentials(
  p_status text,
  p_last_error text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_status not in ('connected','needs_login','error') then
    raise exception 'invalid_status';
  end if;

  update app_private.immoscout_central_credentials
  set status = p_status,
      last_error = left(coalesce(p_last_error,''),160),
      updated_at = clock_timestamp()
  where singleton = 1;

  return found;
end
$function$;

revoke all on function public.claim_immoscout_central_auth_flow(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.complete_immoscout_central_auth_flow(uuid,uuid,text,text,text,smallint,text,timestamptz) from public, anon, authenticated;
revoke all on function public.get_immoscout_central_credentials() from public, anon, authenticated;
revoke all on function public.get_immoscout_central_credential_status() from public, anon, authenticated;
revoke all on function public.update_immoscout_central_credentials(text,text,smallint,timestamptz) from public, anon, authenticated;
revoke all on function public.mark_immoscout_central_credentials(text,text) from public, anon, authenticated;
grant execute on function public.claim_immoscout_central_auth_flow(uuid,uuid,text) to service_role;
grant execute on function public.complete_immoscout_central_auth_flow(uuid,uuid,text,text,text,smallint,text,timestamptz) to service_role;
grant execute on function public.get_immoscout_central_credentials() to service_role;
grant execute on function public.get_immoscout_central_credential_status() to service_role;
grant execute on function public.update_immoscout_central_credentials(text,text,smallint,timestamptz) to service_role;
grant execute on function public.mark_immoscout_central_credentials(text,text) to service_role;

commit;
