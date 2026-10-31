begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A participant connection remains user-scoped. A service connection is a
-- credential-free readiness marker; the actual token lives separately.
alter table public.platform_connections
  add column if not exists connection_scope text not null default 'participant';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.platform_connections'::regclass
      and conname='platform_connections_connection_scope_check'
  ) then
    alter table public.platform_connections
      add constraint platform_connections_connection_scope_check
      check (connection_scope in ('participant','service'));
  end if;
end $$;

create table if not exists public.platform_service_connections (
  provider text primary key check (provider='immoscout'),
  status text not null default 'needs_login'
    check (status in ('connected','needs_login','error')),
  credential_ciphertext text,
  credential_iv text,
  key_version smallint not null default 1 check (key_version > 0),
  account_hint text,
  expires_at timestamptz,
  last_verified_at timestamptz,
  last_refresh_at timestamptz,
  refresh_attempts integer not null default 0 check (refresh_attempts >= 0),
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((credential_ciphertext is null) = (credential_iv is null)),
  check (status <> 'connected' or credential_ciphertext is not null)
);
alter table public.platform_service_connections enable row level security;
revoke all on public.platform_service_connections from public,anon,authenticated;
grant select,insert,update,delete on public.platform_service_connections to service_role;

create or replace function app_private.sync_immoscout_service_placeholders()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    delete from public.platform_connections
    where provider='immoscout' and connection_scope='service';
    return old;
  end if;

  if new.status<>'connected' then
    delete from public.platform_connections
    where provider='immoscout' and connection_scope='service';
    return new;
  end if;

  insert into public.platform_connections(
    user_id,provider,status,connection_scope,account_hint,key_version,
    last_verified_at,last_error,created_at,updated_at
  )
  select b.id,'immoscout','connected','service',new.account_hint,1,
         new.last_verified_at,null,clock_timestamp(),clock_timestamp()
  from public.bot_users b
  where b.is_active
  on conflict(user_id,provider) do update set
    status=excluded.status,
    account_hint=excluded.account_hint,
    last_verified_at=excluded.last_verified_at,
    last_error=null,
    updated_at=clock_timestamp()
  where public.platform_connections.connection_scope='service';

  return new;
end
$$;
revoke all on function app_private.sync_immoscout_service_placeholders() from public,anon,authenticated;

drop trigger if exists platform_service_connections_sync_immoscout on public.platform_service_connections;
create trigger platform_service_connections_sync_immoscout
after insert or update of status,account_hint,last_verified_at or delete
on public.platform_service_connections
for each row execute function app_private.sync_immoscout_service_placeholders();

create or replace function app_private.ensure_immoscout_service_placeholder_for_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.is_active then
    insert into public.platform_connections(
      user_id,provider,status,connection_scope,account_hint,key_version,
      last_verified_at,last_error,created_at,updated_at
    )
    select new.id,'immoscout','connected','service',s.account_hint,1,
           s.last_verified_at,null,clock_timestamp(),clock_timestamp()
    from public.platform_service_connections s
    where s.provider='immoscout' and s.status='connected'
    on conflict(user_id,provider) do nothing;
  end if;
  return new;
end
$$;
revoke all on function app_private.ensure_immoscout_service_placeholder_for_user() from public,anon,authenticated;

drop trigger if exists bot_users_ensure_immoscout_service_placeholder on public.bot_users;
create trigger bot_users_ensure_immoscout_service_placeholder
after insert on public.bot_users
for each row execute function app_private.ensure_immoscout_service_placeholder_for_user();

create or replace function app_private.restore_immoscout_service_placeholder()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if old.provider='immoscout'
     and old.connection_scope='participant'
     and exists (
       select 1 from public.bot_users b where b.id=old.user_id and b.is_active
     )
     and exists (
       select 1 from public.platform_service_connections s
       where s.provider='immoscout' and s.status='connected'
     ) then
    insert into public.platform_connections(
      user_id,provider,status,connection_scope,account_hint,key_version,
      last_verified_at,last_error,created_at,updated_at
    )
    select old.user_id,'immoscout','connected','service',s.account_hint,1,
           s.last_verified_at,null,clock_timestamp(),clock_timestamp()
    from public.platform_service_connections s
    where s.provider='immoscout' and s.status='connected'
    on conflict(user_id,provider) do nothing;
  end if;
  return old;
end
$$;
revoke all on function app_private.restore_immoscout_service_placeholder() from public,anon,authenticated;

drop trigger if exists platform_connections_restore_immoscout_service on public.platform_connections;
create trigger platform_connections_restore_immoscout_service
after delete on public.platform_connections
for each row execute function app_private.restore_immoscout_service_placeholder();

-- Admin-issued central-account flows are restricted to active Super Admins.
-- They use the admin's own bot profile only as an OAuth-flow anchor.
alter table public.platform_auth_flows
  drop constraint if exists platform_auth_flows_origin_check;
alter table public.platform_auth_flows
  add constraint platform_auth_flows_origin_check
  check (origin = any (array['telegram'::text,'coach'::text,'shared'::text,'admin'::text]));

create or replace function app_private.assert_platform_connect_context(p_flow public.platform_auth_flows)
returns void
language plpgsql
set search_path=''
as $
declare v_issuer public.coaching_members%rowtype;
begin
  if p_flow.origin='admin' then
    if p_flow.provider<>'immoscout' or p_flow.context->>'scope'<>'central' then
      raise exception 'auth_flow_expired';
    end if;
    select * into v_issuer
    from public.coaching_members
    where auth_user_id=p_flow.issued_by and is_active and is_super_admin
    for share;
    if not found then raise exception 'auth_flow_expired'; end if;
    perform 1 from public.bot_users
    where id=p_flow.user_id and is_active
    for share;
    if not found then raise exception 'auth_flow_expired'; end if;
    return;
  end if;

  perform 1 from public.bot_users where id=p_flow.user_id and is_active for share;
  if not found then raise exception 'auth_flow_expired'; end if;
  if p_flow.provider<>'wg_gesucht' and not exists(
    select 1 from public.coach_effective_premium_status(array[p_flow.user_id])
    where is_premium
  ) then raise exception 'premium_required'; end if;

  if p_flow.origin='coach' then
    select * into v_issuer from public.coaching_members
    where auth_user_id=p_flow.issued_by and is_active for share;
    if not found then raise exception 'auth_flow_expired'; end if;
    perform 1 from public.coaching_workspaces
    where id=v_issuer.workspace_id and is_active and not operations_paused for share;
    if not found then raise exception 'auth_flow_expired'; end if;
    perform 1 from public.coaching_participants
    where user_id=p_flow.user_id and workspace_id=v_issuer.workspace_id and status='active'
      and assignment_version::text=p_flow.context->>'assignment_version'
      and (v_issuer.role='admin' or coach_member_id=v_issuer.id) for share;
    if not found then raise exception 'auth_flow_expired'; end if;
  elsif p_flow.origin='telegram' then
    if not exists(
      select 1 from public.bot_users
      where id=p_flow.user_id and telegram_user_id is not null and chat_id is not null
    ) then raise exception 'auth_flow_expired'; end if;
  elsif p_flow.origin='shared' then
    if p_flow.provider<>'wg_gesucht' then raise exception 'auth_flow_expired'; end if;
  else
    raise exception 'auth_flow_expired';
  end if;
end
$;
revoke all on function app_private.assert_platform_connect_context(public.platform_auth_flows) from public,anon,authenticated;
grant execute on function app_private.assert_platform_connect_context(public.platform_auth_flows) to service_role;

-- Participant OAuth completion must never turn a service placeholder into a
-- participant credential row without explicitly changing its scope.
create or replace function public.complete_platform_connect_flow(
  p_flow uuid,p_user uuid,p_provider text,p_claim text,p_connection jsonb
)
returns boolean
language plpgsql
set search_path=''
as $$
declare v_flow public.platform_auth_flows%rowtype;
begin
  select * into v_flow from public.platform_auth_flows
  where id=p_flow and user_id=p_user and provider=p_provider;
  if not found then raise exception 'auth_flow_expired'; end if;
  perform app_private.assert_platform_connect_context(v_flow);
  if v_flow.origin='admin' then raise exception 'auth_flow_expired'; end if;
  select * into v_flow from public.platform_auth_flows
  where id=p_flow and user_id=p_user and provider=p_provider for update;
  if not found or v_flow.consumed_at is not null or v_flow.expires_at<=clock_timestamp()
     or nullif(p_claim,'') is null
     or v_flow.context->>'completion_claim' is distinct from p_claim
  then raise exception 'auth_flow_expired'; end if;
  if nullif(p_connection->>'credential_ciphertext','') is null
     or nullif(p_connection->>'credential_iv','') is null
  then raise exception 'connection_save_failed'; end if;

  insert into public.platform_connections(
    user_id,provider,status,connection_scope,credential_ciphertext,credential_iv,key_version,
    account_hint,expires_at,last_verified_at,last_error,updated_at
  ) values(
    p_user,p_provider,'connected','participant',p_connection->>'credential_ciphertext',
    p_connection->>'credential_iv',coalesce((p_connection->>'key_version')::smallint,1),
    nullif(p_connection->>'account_hint',''),
    nullif(p_connection->>'expires_at','')::timestamptz,clock_timestamp(),null,clock_timestamp()
  )
  on conflict(user_id,provider) do update set
    status='connected',connection_scope='participant',
    credential_ciphertext=excluded.credential_ciphertext,
    credential_iv=excluded.credential_iv,key_version=excluded.key_version,
    account_hint=excluded.account_hint,expires_at=excluded.expires_at,
    last_verified_at=excluded.last_verified_at,last_error=null,updated_at=excluded.updated_at;

  update public.platform_auth_flows
  set consumed_at=clock_timestamp(),context=context||jsonb_build_object('completed_at',clock_timestamp())
  where id=p_flow;
  return true;
end
$$;
revoke all on function public.complete_platform_connect_flow(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_platform_connect_flow(uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.coach_issue_immoscout_central_connect_flow(
  p_actor uuid,p_state text,p_verifier text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor public.coaching_members%rowtype;
  v_email text;
  v_user uuid;
  v_count integer;
  v_flow public.platform_auth_flows%rowtype;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active and is_super_admin
  for share;
  if not found then raise exception 'super_admin_required'; end if;

  if p_state !~ '^[A-Za-z0-9_-]{30,100}$'
     or p_verifier !~ '^[A-Za-z0-9_-]{43,128}$'
  then raise exception 'auth_flow_create_failed'; end if;

  select lower(trim(u.email)) into v_email
  from auth.users u where u.id=v_actor.auth_user_id;
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'central_account_profile_required';
  end if;

  select count(*), (array_agg(p.user_id order by p.user_id))[1]
  into v_count,v_user
  from public.applicant_profiles p
  join public.bot_users b on b.id=p.user_id and b.is_active
  where lower(trim(p.email))=v_email;
  if v_count<>1 or v_user is null then raise exception 'central_account_profile_required'; end if;

  update public.platform_auth_flows
  set consumed_at=clock_timestamp()
  where provider='immoscout' and origin='admin' and consumed_at is null;

  insert into public.platform_auth_flows(
    user_id,provider,state,code_verifier,origin,issued_by,return_target,context,expires_at
  ) values(
    v_user,'immoscout',p_state,p_verifier,'admin',v_actor.auth_user_id,'coach',
    jsonb_build_object('scope','central','account_email',v_email,'admin_member_id',v_actor.id),
    clock_timestamp()+interval '30 minutes'
  )
  returning * into v_flow;

  return jsonb_build_object('expiresAt',v_flow.expires_at);
end
$$;
revoke all on function public.coach_issue_immoscout_central_connect_flow(uuid,text,text) from public,anon,authenticated;
grant execute on function public.coach_issue_immoscout_central_connect_flow(uuid,text,text) to service_role;

create or replace function public.complete_platform_service_connect_flow(
  p_flow uuid,p_user uuid,p_provider text,p_claim text,p_connection jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare v_flow public.platform_auth_flows%rowtype;
begin
  if p_provider<>'immoscout' then raise exception 'provider_unsupported'; end if;
  select * into v_flow from public.platform_auth_flows
  where id=p_flow and user_id=p_user and provider=p_provider;
  if not found then raise exception 'auth_flow_expired'; end if;
  perform app_private.assert_platform_connect_context(v_flow);
  select * into v_flow from public.platform_auth_flows
  where id=p_flow and user_id=p_user and provider=p_provider for update;
  if not found or v_flow.origin<>'admin' or v_flow.context->>'scope'<>'central'
     or v_flow.consumed_at is not null or v_flow.expires_at<=clock_timestamp()
     or nullif(p_claim,'') is null
     or v_flow.context->>'completion_claim' is distinct from p_claim
  then raise exception 'auth_flow_expired'; end if;
  if nullif(p_connection->>'credential_ciphertext','') is null
     or nullif(p_connection->>'credential_iv','') is null
     or lower(trim(coalesce(p_connection->>'account_hint',''))) is distinct from v_flow.context->>'account_email'
  then raise exception 'central_account_mismatch'; end if;

  insert into public.platform_service_connections(
    provider,status,credential_ciphertext,credential_iv,key_version,account_hint,
    expires_at,last_verified_at,last_refresh_at,refresh_attempts,last_error,updated_at
  ) values(
    'immoscout','connected',p_connection->>'credential_ciphertext',
    p_connection->>'credential_iv',coalesce((p_connection->>'key_version')::smallint,1),
    lower(trim(p_connection->>'account_hint')),
    nullif(p_connection->>'expires_at','')::timestamptz,
    clock_timestamp(),null,0,null,clock_timestamp()
  )
  on conflict(provider) do update set
    status='connected',
    credential_ciphertext=excluded.credential_ciphertext,
    credential_iv=excluded.credential_iv,
    key_version=excluded.key_version,
    account_hint=excluded.account_hint,
    expires_at=excluded.expires_at,
    last_verified_at=excluded.last_verified_at,
    last_error=null,
    updated_at=clock_timestamp();

  update public.platform_auth_flows
  set consumed_at=clock_timestamp(),context=context||jsonb_build_object('completed_at',clock_timestamp())
  where id=p_flow;
  return true;
end
$$;
revoke all on function public.complete_platform_service_connect_flow(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_platform_service_connect_flow(uuid,uuid,text,text,jsonb) to service_role;

commit;
