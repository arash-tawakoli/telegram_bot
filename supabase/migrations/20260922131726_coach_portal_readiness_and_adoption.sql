create or replace function public.coach_readiness_core(p_users uuid[])
returns table(
  user_id uuid,
  is_premium boolean,
  profile_complete boolean,
  active_search_count integer,
  connected_providers text[],
  enabled_providers text[],
  ready_providers text[],
  document_count integer,
  document_auto_count integer,
  automation_enabled boolean
)
language sql
stable
security definer
set search_path to ''
as $function$
  with users as (
    select b.id
    from public.bot_users b
    where b.id=any(coalesce(p_users,array[]::uuid[]))
  ),
  searches as (
    select s.user_id,count(*) filter(where s.is_active)::integer as active_count
    from public.search_profiles s
    where s.user_id=any(coalesce(p_users,array[]::uuid[]))
    group by s.user_id
  ),
  connections as (
    select c.user_id,
           coalesce(array_agg(c.provider order by c.provider) filter(where c.status='connected'),array[]::text[]) as providers
    from public.platform_connections c
    where c.user_id=any(coalesce(p_users,array[]::uuid[]))
      and c.provider in ('immoscout','kleinanzeigen','immomio')
    group by c.user_id
  ),
  documents as (
    select d.user_id,count(*)::integer as total,
           count(*) filter(where d.send_with_auto_apply)::integer as auto_total
    from public.applicant_documents d
    where d.user_id=any(coalesce(p_users,array[]::uuid[]))
    group by d.user_id
  )
  select
    u.id,
    app_private.user_is_premium(u.id),
    app_private.applicant_profile_complete(u.id),
    coalesce(s.active_count,0),
    coalesce(c.providers,array[]::text[]),
    array_remove(array[
      case when coalesce(p.immoscout_enabled,false) then 'immoscout' end,
      case when coalesce(p.kleinanzeigen_enabled,false) then 'kleinanzeigen' end,
      case when coalesce(p.immomio_enabled,false) then 'immomio' end
    ],null),
    array_remove(array[
      case when coalesce(p.immoscout_enabled,false) and 'immoscout'=any(coalesce(c.providers,array[]::text[])) then 'immoscout' end,
      case when coalesce(p.kleinanzeigen_enabled,false) and 'kleinanzeigen'=any(coalesce(c.providers,array[]::text[])) then 'kleinanzeigen' end,
      case when coalesce(p.immomio_enabled,false) and 'immomio'=any(coalesce(c.providers,array[]::text[])) then 'immomio' end
    ],null),
    coalesce(d.total,0),
    coalesce(d.auto_total,0),
    coalesce(p.enabled,false)
  from users u
  left join searches s on s.user_id=u.id
  left join connections c on c.user_id=u.id
  left join documents d on d.user_id=u.id
  left join public.application_preferences p on p.user_id=u.id
$function$;

revoke all on function public.coach_readiness_core(uuid[]) from public,anon,authenticated;
grant execute on function public.coach_readiness_core(uuid[]) to service_role;

create or replace function public.coach_adopt_participant(
  p_actor uuid,
  p_user uuid,
  p_coach uuid
)
returns text
language plpgsql
set search_path to ''
as $function$
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

  if not exists(
    select 1 from public.coaching_members
    where id=p_coach and workspace_id=v_actor.workspace_id and is_active
  ) then
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

revoke all on function public.coach_adopt_participant(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.coach_adopt_participant(uuid,uuid,uuid) to service_role;
