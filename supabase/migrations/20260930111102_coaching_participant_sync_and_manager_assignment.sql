-- Shared identity stays in bot_users; new Telegram participants await admin assignment.
alter table public.coaching_participants alter column coach_member_id drop not null;
alter table public.coaching_participants
  drop constraint coaching_participants_workspace_id_created_by_member_id_fkey;
alter table public.coaching_participants
  add constraint coaching_participants_workspace_id_created_by_member_id_fkey
  foreign key (workspace_id,created_by_member_id)
  references public.coaching_members(workspace_id,id)
  on delete set null (created_by_member_id);

-- Preserve participants and history, remove only invalid administrator assignments.
with cleared as (
  update public.coaching_participants p
  set coach_member_id=null,assignment_version=p.assignment_version+1,updated_at=now()
  from public.coaching_members m
  where p.coach_member_id=m.id and m.role='admin'
  returning p.workspace_id,p.user_id,m.id as previous_member
)
insert into public.coaching_audit_events(workspace_id,participant_user_id,action,changes)
select workspace_id,user_id,'participant_assignment_cleared',
       jsonb_build_object('previous_member_id',previous_member,'reason','manager_role_required')
from cleared;

create or replace function app_private.coaching_manager_assignment_guard()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_member public.coaching_members%rowtype;
begin
  if new.coach_member_id is null then return new; end if;
  if tg_op='UPDATE' and new.coach_member_id is not distinct from old.coach_member_id
     and new.workspace_id is not distinct from old.workspace_id then return new; end if;
  select * into v_member from public.coaching_members
  where id=new.coach_member_id and workspace_id=new.workspace_id
    and role='coach' and is_active for share;
  if not found then raise exception 'coach_unavailable'; end if;
  return new;
end $$;
revoke all on function app_private.coaching_manager_assignment_guard() from public,anon,authenticated;
create trigger coaching_manager_assignment_guard
before insert or update of coach_member_id,workspace_id on public.coaching_participants
for each row execute function app_private.coaching_manager_assignment_guard();

-- The named workspace is unique; no environment-specific generated ID or first-row inference.
create or replace function app_private.enrol_telegram_coaching_participant(p_user uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
  v_workspace uuid;
  v_inserted uuid;
begin
  select id into v_workspace from public.coaching_workspaces where name='NexaLabs';
  if v_workspace is null then return false; end if;
  insert into public.coaching_participants(user_id,workspace_id,coach_member_id,public_id)
  select u.id,v_workspace,null,'cp_'||encode(extensions.gen_random_bytes(12),'hex')
  from public.bot_users u
  where u.id=p_user and u.telegram_user_id is not null and u.is_active
  on conflict(user_id) do nothing returning user_id into v_inserted;
  if v_inserted is null then return false; end if;
  insert into public.coaching_audit_events(workspace_id,participant_user_id,action,changes)
  values(v_workspace,v_inserted,'telegram_participant_enrolled',
         jsonb_build_object('assignment','unassigned'));
  return true;
end $$;
revoke all on function app_private.enrol_telegram_coaching_participant(uuid) from public,anon,authenticated;
grant execute on function app_private.enrol_telegram_coaching_participant(uuid) to service_role;

create or replace function app_private.enrol_telegram_coaching_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_table_name='bot_users' then
    perform app_private.enrol_telegram_coaching_participant(new.id);
  else
    perform app_private.enrol_telegram_coaching_participant(new.user_id);
  end if;
  return new;
end $$;
revoke all on function app_private.enrol_telegram_coaching_trigger() from public,anon,authenticated;
create trigger coaching_enrol_telegram_user
after insert or update of telegram_user_id on public.bot_users
for each row when (new.telegram_user_id is not null)
execute function app_private.enrol_telegram_coaching_trigger();
create trigger coaching_enrol_telegram_search
after insert on public.search_profiles
for each row execute function app_private.enrol_telegram_coaching_trigger();

select app_private.enrol_telegram_coaching_participant(u.id)
from public.bot_users u
where u.telegram_user_id is not null and u.is_active
  and not exists(select 1 from public.coaching_participants p where p.user_id=u.id);

CREATE OR REPLACE FUNCTION public.coach_adopt_participant(p_actor uuid, p_user uuid, p_coach uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor public.coaching_members%rowtype;
  v_public_id text;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active
  for share;

  if not found or v_actor.role<>'admin' then
    raise exception 'admin_required';
  end if;

  if not exists(
    select 1 from public.coaching_workspaces
    where id=v_actor.workspace_id and is_active and not operations_paused
  ) then
    raise exception 'workspace_unavailable';
  end if;

  if (p_coach is null and v_actor.role<>'admin') or (p_coach is not null and not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id and is_active and role='coach' for share
  )) then
    raise exception 'coach_unavailable';
  end if;

  if not exists(select 1 from public.bot_users where id=p_user) then
    raise exception 'participant_unavailable';
  end if;

  if exists(select 1 from public.coaching_participants where user_id=p_user) then
    raise exception 'participant_already_assigned';
  end if;

  v_public_id := 'cp_'||encode(extensions.gen_random_bytes(12),'hex');

  insert into public.coaching_participants(
    user_id,workspace_id,coach_member_id,created_by_member_id,status,public_id
  )
  values(
    p_user,v_actor.workspace_id,p_coach,v_actor.id,'active',v_public_id
  );

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,p_user,'participant_adopted',
    jsonb_build_object('coach_member_id',p_coach,'preserved_existing_identity',true)
  );

  return v_public_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.coach_create_participant(p_actor uuid, p_coach uuid, p_first_name text, p_last_name text, p_email text, p_phone text, p_city text DEFAULT 'Hamburg'::text, p_household_size smallint DEFAULT NULL::smallint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor public.coaching_members%rowtype;
  v_user uuid;
  v_public_id text;
  v_email text;
  v_phone text;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active
  for share;

  if not found then raise exception 'actor_forbidden'; end if;

  if not exists(
    select 1 from public.coaching_workspaces
    where id=v_actor.workspace_id and is_active and not operations_paused
  ) then raise exception 'workspace_unavailable'; end if;

  if p_coach is distinct from v_actor.id and v_actor.role<>'admin' then
    raise exception 'admin_required';
  end if;

  if (p_coach is null and v_actor.role<>'admin') or (p_coach is not null and not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id and is_active and role='coach' for share
  )) then raise exception 'coach_unavailable'; end if;

  if nullif(btrim(p_first_name),'') is null
     or nullif(btrim(p_last_name),'') is null
  then raise exception 'participant_fields_required'; end if;

  v_email:=nullif(lower(btrim(coalesce(p_email,''))),'');
  if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'invalid_email';
  end if;
  v_phone:=nullif(btrim(coalesce(p_phone,'')),'');

  insert into public.bot_users(
    telegram_user_id,chat_id,first_name,last_name,is_active,origin,plan_override
  )
  values(null,null,btrim(p_first_name),btrim(p_last_name),true,'coaching','free')
  returning id into v_user;

  insert into public.applicant_profiles(
    user_id,first_name,last_name,email,phone,city,household_size
  )
  values(
    v_user,btrim(p_first_name),btrim(p_last_name),v_email,
    v_phone,coalesce(nullif(btrim(p_city),''),'Hamburg'),p_household_size
  );

  v_public_id := 'cp_'||encode(extensions.gen_random_bytes(12),'hex');

  insert into public.coaching_participants(
    user_id,workspace_id,coach_member_id,created_by_member_id,status,public_id
  )
  values(v_user,v_actor.workspace_id,p_coach,v_actor.id,'active',v_public_id);

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,v_user,'participant_created',
    jsonb_build_object('coach_member_id',p_coach)
  );

  return v_user;
end
$function$;

CREATE OR REPLACE FUNCTION public.coach_create_participant_idempotent(p_actor uuid, p_coach uuid, p_request_id uuid, p_first_name text, p_last_name text, p_email text, p_phone text, p_city text DEFAULT 'Hamburg'::text, p_household_size smallint DEFAULT NULL::smallint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor public.coaching_members%rowtype;
  v_user uuid;
  v_existing_user uuid;
  v_existing_actor uuid;
  v_existing_workspace uuid;
  v_public_id text;
  v_claimed boolean := false;
  v_email text;
  v_phone text;
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

  if p_coach is distinct from v_actor.id and v_actor.role<>'admin' then
    raise exception 'admin_required';
  end if;

  if (p_coach is null and v_actor.role<>'admin') or (p_coach is not null and not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id and is_active and role='coach' for share
  )) then raise exception 'coach_unavailable'; end if;

  if nullif(btrim(p_first_name),'') is null
     or nullif(btrim(p_last_name),'') is null
  then raise exception 'participant_fields_required'; end if;

  v_email:=nullif(lower(btrim(coalesce(p_email,''))),'');
  if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'invalid_email';
  end if;
  v_phone:=nullif(btrim(coalesce(p_phone,'')),'');

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
    v_user,btrim(p_first_name),btrim(p_last_name),v_email,
    v_phone,coalesce(nullif(btrim(p_city),''),'Hamburg'),p_household_size
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

CREATE OR REPLACE FUNCTION public.coach_reassign_participant(p_actor uuid, p_user uuid, p_coach uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor public.coaching_members%rowtype;
  v_old uuid;
begin
  select * into v_actor from public.coaching_members where id=p_actor and is_active;
  if not found or v_actor.role<>'admin' then raise exception 'admin_required'; end if;
  if not app_private.coaching_actor_can_access(v_actor.id,p_user,true) then
    raise exception 'participant_forbidden';
  end if;
  if (p_coach is null and v_actor.role<>'admin') or (p_coach is not null and not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id and is_active and role='coach' for share
  )) then raise exception 'coach_unavailable'; end if;

  select coach_member_id into v_old
  from public.coaching_participants
  where user_id=p_user
  for update;

  update public.coaching_participants
  set coach_member_id=p_coach,
      assignment_version=assignment_version+1,
      updated_at=now()
  where user_id=p_user;

  insert into public.coaching_audit_events(
    workspace_id,actor_member_id,participant_user_id,action,changes
  )
  values(
    v_actor.workspace_id,v_actor.id,p_user,'participant_reassigned',
    jsonb_build_object('from',v_old,'to',p_coach)
  );
  return true;
end
$function$;

-- One transaction freezes the membership before moving participants.
create or replace function public.coach_prepare_member_deletion(p_actor uuid,p_member uuid,p_target uuid default null)
returns jsonb language plpgsql set search_path=''
as $$
declare
  v_actor public.coaching_members%rowtype;
  v_member public.coaching_members%rowtype;
  v_count integer;
begin
  select * into v_actor from public.coaching_members where id=p_actor and is_active for share;
  if not found or v_actor.role<>'admin' then raise exception 'admin_required'; end if;
  if not exists(select 1 from public.coaching_workspaces where id=v_actor.workspace_id and is_active and not operations_paused)
  then raise exception 'workspace_unavailable'; end if;
  if p_actor=p_member or p_target=p_member then raise exception 'coach_unavailable'; end if;
  select * into v_member from public.coaching_members
  where id=p_member and workspace_id=v_actor.workspace_id and role='coach' for update;
  if not found then raise exception 'coach_unavailable'; end if;
  if p_target is not null then
    perform 1 from public.coaching_members
    where id=p_target and workspace_id=v_actor.workspace_id and role='coach' and is_active for share;
    if not found then raise exception 'coach_unavailable'; end if;
  end if;
  update public.coaching_members set is_active=false,updated_at=now() where id=p_member;
  update public.coaching_participants
  set coach_member_id=p_target,assignment_version=assignment_version+1,updated_at=now()
  where workspace_id=v_actor.workspace_id and coach_member_id=p_member;
  get diagnostics v_count=row_count;
  update public.platform_auth_flows set consumed_at=coalesce(consumed_at,now())
  where issued_by=v_member.auth_user_id and consumed_at is null;
  update app_private.telegram_link_tokens set invalidated_at=coalesce(invalidated_at,now())
  where created_by=v_member.auth_user_id and consumed_at is null;
  -- Change ownership only; file bytes, paths and participant documents stay intact.
  update storage.objects set owner=v_actor.auth_user_id,owner_id=v_actor.auth_user_id::text
  where owner=v_member.auth_user_id or owner_id=v_member.auth_user_id::text;
  insert into public.coaching_audit_events(workspace_id,actor_member_id,action,changes)
  values(v_actor.workspace_id,p_actor,'coach_deletion_prepared',
    jsonb_build_object('member_id',p_member,'target_member_id',p_target,'participants_preserved',v_count));
  return jsonb_build_object('auth_user_id',v_member.auth_user_id,'participants_preserved',v_count);
end $$;
revoke all on function public.coach_prepare_member_deletion(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.coach_prepare_member_deletion(uuid,uuid,uuid) to service_role;

-- Deactivation must permanently invalidate outstanding links, including after reactivation.
create or replace function app_private.coaching_invalidate_member_tickets()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  update public.platform_auth_flows set consumed_at=coalesce(consumed_at,clock_timestamp())
  where issued_by=new.auth_user_id and consumed_at is null;
  update app_private.telegram_link_tokens set invalidated_at=coalesce(invalidated_at,clock_timestamp())
  where created_by=new.auth_user_id and consumed_at is null and invalidated_at is null;
  return new;
end $$;
revoke all on function app_private.coaching_invalidate_member_tickets() from public,anon,authenticated;
create trigger coaching_invalidate_member_tickets
 after update of is_active on public.coaching_members
 for each row when (old.is_active and not new.is_active)
 execute function app_private.coaching_invalidate_member_tickets();

revoke all on function public.coach_adopt_participant(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.coach_create_participant(uuid,uuid,text,text,text,text,text,smallint) from public,anon,authenticated;
revoke all on function public.coach_create_participant_idempotent(uuid,uuid,uuid,text,text,text,text,text,smallint) from public,anon,authenticated;
revoke all on function public.coach_reassign_participant(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.coach_adopt_participant(uuid,uuid,uuid) to service_role;
grant execute on function public.coach_create_participant(uuid,uuid,text,text,text,text,text,smallint) to service_role;
grant execute on function public.coach_create_participant_idempotent(uuid,uuid,uuid,text,text,text,text,text,smallint) to service_role;
grant execute on function public.coach_reassign_participant(uuid,uuid,uuid) to service_role;
