create table if not exists public.coaching_request_keys (
  request_id uuid primary key,
  workspace_id uuid not null references public.coaching_workspaces(id) on delete cascade,
  actor_member_id uuid not null references public.coaching_members(id) on delete cascade,
  action text not null check (action in ('create_participant')),
  participant_user_id uuid references public.bot_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.coaching_request_keys enable row level security;
revoke all on table public.coaching_request_keys from anon, authenticated;
grant select, insert, update on table public.coaching_request_keys to service_role;

create index if not exists coaching_request_keys_created_at_idx
  on public.coaching_request_keys(created_at);

create or replace function public.coach_create_participant_idempotent(
  p_actor uuid,
  p_coach uuid,
  p_request_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_city text default 'Hamburg',
  p_household_size smallint default null
)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_user uuid;
  v_existing_user uuid;
  v_existing_actor uuid;
  v_existing_workspace uuid;
  v_public_id text;
  v_claimed boolean := false;
begin
  if p_request_id is null then
    raise exception 'request_id_required';
  end if;

  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active
  for share;

  if not found then raise exception 'actor_forbidden'; end if;

  if not exists(
    select 1 from public.coaching_workspaces
    where id=v_actor.workspace_id and is_active and not operations_paused
  ) then raise exception 'workspace_unavailable'; end if;

  if p_coach<>v_actor.id and v_actor.role<>'admin' then
    raise exception 'admin_required';
  end if;

  if not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id and is_active
  ) then raise exception 'coach_unavailable'; end if;

  if nullif(btrim(p_first_name),'') is null
     or nullif(btrim(p_last_name),'') is null
     or nullif(btrim(p_email),'') is null
     or nullif(btrim(p_phone),'') is null
  then raise exception 'participant_fields_required'; end if;

  insert into public.coaching_request_keys(
    request_id,workspace_id,actor_member_id,action
  )
  values(p_request_id,v_actor.workspace_id,v_actor.id,'create_participant')
  on conflict(request_id) do nothing;

  get diagnostics v_claimed = row_count;

  if not v_claimed then
    select participant_user_id,actor_member_id,workspace_id
      into v_existing_user,v_existing_actor,v_existing_workspace
    from public.coaching_request_keys
    where request_id=p_request_id;

    if v_existing_actor is distinct from v_actor.id
       or v_existing_workspace is distinct from v_actor.workspace_id then
      raise exception 'request_id_conflict';
    end if;

    if v_existing_user is not null then
      return v_existing_user;
    end if;

    raise exception 'request_in_progress';
  end if;

  insert into public.bot_users(
    telegram_user_id,chat_id,first_name,last_name,is_active,origin,plan_override
  )
  values(null,null,btrim(p_first_name),btrim(p_last_name),true,'coaching','free')
  returning id into v_user;

  insert into public.applicant_profiles(
    user_id,first_name,last_name,email,phone,city,household_size
  )
  values(
    v_user,btrim(p_first_name),btrim(p_last_name),lower(btrim(p_email)),
    btrim(p_phone),coalesce(nullif(btrim(p_city),''),'Hamburg'),p_household_size
  );

  v_public_id := 'cp_'||encode(extensions.gen_random_bytes(12),'hex');

  insert into public.coaching_participants(
    user_id,workspace_id,coach_member_id,created_by_member_id,status,public_id
  )
  values(v_user,v_actor.workspace_id,p_coach,v_actor.id,'active',v_public_id);

  update public.coaching_request_keys
  set participant_user_id=v_user
  where request_id=p_request_id;

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,v_user,'participant_created',
    jsonb_build_object('coach_member_id',p_coach,'request_id',p_request_id)
  );

  return v_user;
end
$function$;

revoke all on function public.coach_create_participant_idempotent(uuid,uuid,uuid,text,text,text,text,text,smallint)
  from public,anon,authenticated;
grant execute on function public.coach_create_participant_idempotent(uuid,uuid,uuid,text,text,text,text,text,smallint)
  to service_role;
