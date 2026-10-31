-- Central ImmoScout credentials are encrypted in Cloudflare D1 and accessed only through private Supabase RPCs.
-- Requires the Supabase Cloudflare D1 wrapper server "immoscout_central_staging" to be created in the dashboard first.

create schema if not exists app_private;

create foreign table if not exists app_private.immoscout_central_credentials (
  singleton text not null,
  account_hint text not null,
  ciphertext text not null,
  iv text not null,
  key_version bigint not null,
  status text not null,
  enabled bigint not null,
  expires_at text,
  last_verified_at text,
  last_error text,
  updated_at text,
  _attrs jsonb
)
server immoscout_central_staging
options (
  table 'central_credentials',
  rowid_column 'singleton'
);

create foreign table if not exists app_private.immoscout_central_audit_events (
  id bigint,
  event_type text not null,
  account_hint text,
  admin_telegram_id text,
  created_at text,
  _attrs jsonb
)
server immoscout_central_staging
options (
  table 'audit_events',
  rowid_column 'id'
);

revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;
revoke all on app_private.immoscout_central_credentials from public, anon, authenticated;
revoke all on app_private.immoscout_central_audit_events from public, anon, authenticated;
grant select, insert, update on app_private.immoscout_central_credentials to service_role;
grant select, insert on app_private.immoscout_central_audit_events to service_role;

create or replace function public.get_immoscout_central_credentials()
returns table (
  account_hint text,
  ciphertext text,
  iv text,
  key_version bigint,
  status text,
  enabled boolean,
  expires_at text,
  last_verified_at text,
  last_error text,
  updated_at text
)
language sql
security definer
set search_path = ''
stable
as $function$
  select c.account_hint, c.ciphertext, c.iv, c.key_version, c.status,
         (c.enabled = 1), c.expires_at, c.last_verified_at, c.last_error, c.updated_at
  from app_private.immoscout_central_credentials c
  where c.singleton = 'central'
  limit 1;
$function$;

create or replace function public.get_immoscout_central_credential_status()
returns table (
  configured boolean,
  account_hint text,
  status text,
  enabled boolean,
  expires_at text,
  last_verified_at text,
  last_error text,
  updated_at text
)
language sql
security definer
set search_path = ''
stable
as $function$
  select true, c.account_hint, c.status, (c.enabled = 1), c.expires_at,
         c.last_verified_at, c.last_error, c.updated_at
  from app_private.immoscout_central_credentials c
  where c.singleton = 'central'
  union all
  select false, null::text, 'disconnected'::text, false, null::text,
         null::text, null::text, null::text
  where not exists (
    select 1 from app_private.immoscout_central_credentials c where c.singleton = 'central'
  );
$function$;

create or replace function public.store_immoscout_central_credentials(
  p_account_hint text,
  p_ciphertext text,
  p_iv text,
  p_key_version bigint,
  p_expires_at text,
  p_preserve_enabled boolean default false,
  p_admin_telegram_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if lower(trim(coalesce(p_account_hint,''))) <> 'arash@nexalabs.de'
     or length(coalesce(p_ciphertext,'')) < 20
     or length(coalesce(p_iv,'')) < 8
     or coalesce(p_key_version,0) < 1
     or p_expires_at is null then
    raise exception 'central_credential_invalid';
  end if;

  update app_private.immoscout_central_credentials
  set account_hint = lower(trim(p_account_hint)),
      ciphertext = p_ciphertext,
      iv = p_iv,
      key_version = p_key_version,
      status = 'connected',
      enabled = case when p_preserve_enabled then enabled else 0 end,
      expires_at = p_expires_at,
      last_verified_at = v_now,
      last_error = null,
      updated_at = v_now
  where singleton = 'central';

  if not found then
    insert into app_private.immoscout_central_credentials (
      singleton, account_hint, ciphertext, iv, key_version, status, enabled,
      expires_at, last_verified_at, last_error, updated_at
    ) values (
      'central', lower(trim(p_account_hint)), p_ciphertext, p_iv, p_key_version,
      'connected', 0, p_expires_at, v_now, null, v_now
    );
  end if;

  insert into app_private.immoscout_central_audit_events (
    event_type, account_hint, admin_telegram_id, created_at
  ) values ('credential_stored', lower(trim(p_account_hint)), left(p_admin_telegram_id,64), v_now);

  return true;
end
$function$;

create or replace function public.mark_immoscout_central_credentials(
  p_status text,
  p_last_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_status not in ('connected','needs_login','error') then
    raise exception 'invalid_status';
  end if;

  update app_private.immoscout_central_credentials
  set status = p_status,
      last_error = left(coalesce(p_last_error,''),160),
      updated_at = v_now
  where singleton = 'central';

  return found;
end
$function$;

create or replace function public.set_immoscout_central_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  update app_private.immoscout_central_credentials
  set enabled = case when p_enabled then 1 else 0 end,
      updated_at = v_now
  where singleton = 'central' and status = 'connected';

  if found then
    insert into app_private.immoscout_central_audit_events (
      event_type, account_hint, created_at
    )
    select case when p_enabled then 'auto_apply_enabled' else 'auto_apply_disabled' end,
           account_hint, v_now
    from app_private.immoscout_central_credentials
    where singleton = 'central';
    return true;
  end if;
  return false;
end
$function$;

revoke all on function public.get_immoscout_central_credentials() from public, anon, authenticated;
revoke all on function public.get_immoscout_central_credential_status() from public, anon, authenticated;
revoke all on function public.store_immoscout_central_credentials(text,text,text,bigint,text,boolean,text) from public, anon, authenticated;
revoke all on function public.mark_immoscout_central_credentials(text,text) from public, anon, authenticated;
revoke all on function public.set_immoscout_central_enabled(boolean) from public, anon, authenticated;

grant execute on function public.get_immoscout_central_credentials() to service_role;
grant execute on function public.get_immoscout_central_credential_status() to service_role;
grant execute on function public.store_immoscout_central_credentials(text,text,text,bigint,text,boolean,text) to service_role;
grant execute on function public.mark_immoscout_central_credentials(text,text) to service_role;
grant execute on function public.set_immoscout_central_enabled(boolean) to service_role;
