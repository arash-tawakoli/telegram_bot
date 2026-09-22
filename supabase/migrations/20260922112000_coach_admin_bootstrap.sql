create table if not exists app_private.coach_bootstrap_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists coach_bootstrap_tokens_active_idx
  on app_private.coach_bootstrap_tokens(expires_at)
  where consumed_at is null;

create or replace function public.issue_coach_bootstrap_token(
  p_ttl_minutes integer default 120
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token text;
begin
  if p_ttl_minutes < 10 or p_ttl_minutes > 1440 then
    raise exception 'invalid_ttl';
  end if;

  if exists(
    select 1
    from public.coaching_members
    where role='admin' and is_active
  ) then
    raise exception 'admin_already_exists';
  end if;

  update app_private.coach_bootstrap_tokens
  set consumed_at=coalesce(consumed_at,now())
  where consumed_at is null;

  v_token := 'setup_'||encode(extensions.gen_random_bytes(32),'hex');

  insert into app_private.coach_bootstrap_tokens(token_hash,expires_at)
  values(
    encode(extensions.digest(v_token,'sha256'),'hex'),
    now()+make_interval(mins=>p_ttl_minutes)
  );

  return v_token;
end
$function$;

revoke all on function public.issue_coach_bootstrap_token(integer)
  from public,anon,authenticated;
grant execute on function public.issue_coach_bootstrap_token(integer)
  to service_role;

create or replace function public.coach_bootstrap_token_valid(
  p_token text
)
returns boolean
language sql
security definer
set search_path to ''
as $function$
  select
    not exists(
      select 1 from public.coaching_members
      where role='admin' and is_active
    )
    and exists(
      select 1
      from app_private.coach_bootstrap_tokens t
      where t.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
        and t.consumed_at is null
        and t.expires_at>now()
    )
$function$;

revoke all on function public.coach_bootstrap_token_valid(text)
  from public,anon,authenticated;
grant execute on function public.coach_bootstrap_token_valid(text)
  to service_role;

create or replace function public.complete_coach_bootstrap(
  p_token text,
  p_auth_user uuid,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token_id uuid;
  v_workspace uuid;
  v_member uuid;
begin
  if nullif(btrim(p_display_name),'') is null then
    raise exception 'display_name_required';
  end if;

  if exists(
    select 1 from public.coaching_members
    where role='admin' and is_active
  ) then
    raise exception 'admin_already_exists';
  end if;

  select t.id
    into v_token_id
  from app_private.coach_bootstrap_tokens t
  where t.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
    and t.consumed_at is null
    and t.expires_at>now()
  for update;

  if v_token_id is null then
    raise exception 'bootstrap_token_invalid';
  end if;

  select id into v_workspace
  from public.coaching_workspaces
  where name='NexaLabs' and is_active
  limit 1;

  if v_workspace is null then
    raise exception 'workspace_unavailable';
  end if;

  insert into public.coaching_members(
    auth_user_id,workspace_id,display_name,role,is_active
  )
  values(
    p_auth_user,v_workspace,btrim(p_display_name),'admin',true
  )
  returning id into v_member;

  update app_private.coach_bootstrap_tokens
  set consumed_at=now()
  where id=v_token_id;

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_workspace,v_member,null,'admin_bootstrapped','{}'::jsonb
  );

  return v_member;
end
$function$;

revoke all on function public.complete_coach_bootstrap(text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.complete_coach_bootstrap(text,uuid,text)
  to service_role;
