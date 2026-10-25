begin;

alter table public.platform_connections drop constraint if exists platform_connections_provider_check;
alter table public.platform_connections add constraint platform_connections_provider_check
  check (provider = any (array['immoscout'::text,'kleinanzeigen'::text,'immomio'::text,'immowelt'::text,'wg_gesucht'::text,'indeed'::text]));

alter table public.platform_auth_flows drop constraint if exists platform_auth_flows_provider_check;
alter table public.platform_auth_flows add constraint platform_auth_flows_provider_check
  check (provider = any (array['immoscout'::text,'kleinanzeigen'::text,'immomio'::text,'immowelt'::text,'wg_gesucht'::text,'indeed'::text]));

create or replace function public.coach_issue_platform_connect_flow(
  p_actor uuid,
  p_user uuid,
  p_provider text,
  p_state text,
  p_verifier text
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_actor public.coaching_members%rowtype;
  v_assignment public.coaching_participants%rowtype;
  v_flow public.platform_auth_flows%rowtype;
begin
  select * into v_actor
  from public.coaching_members
  where id=p_actor and is_active
  for share;

  if not found then raise exception 'coach_forbidden'; end if;

  if p_provider not in ('immoscout','kleinanzeigen','immomio','immowelt','wg_gesucht','indeed')
     or p_state !~ '^[A-Za-z0-9_-]{30,100}$'
     or p_verifier !~ '^[A-Za-z0-9_-]{43,128}$'
  then raise exception 'provider_unsupported'; end if;

  select * into v_assignment
  from public.coaching_participants
  where user_id=p_user
    and workspace_id=v_actor.workspace_id
    and status='active'
    and (v_actor.role='admin' or coach_member_id=p_actor)
  for update;

  if not found then raise exception 'participant_forbidden'; end if;

  if not exists(
    select 1
    from public.coaching_workspaces
    where id=v_actor.workspace_id
      and is_active
      and not operations_paused
  )
  then raise exception 'workspace_unavailable'; end if;

  if p_provider='indeed' and not coalesce(v_actor.is_super_admin,false)
  then raise exception 'premium_required'; end if;

  if p_provider not in ('wg_gesucht','indeed')
     and not exists(
       select 1
       from public.coach_effective_premium_status(array[p_user])
       where is_premium
     )
  then raise exception 'premium_required'; end if;

  update public.platform_auth_flows
  set consumed_at=clock_timestamp()
  where user_id=p_user
    and provider=p_provider
    and consumed_at is null;

  insert into public.platform_auth_flows(
    user_id,provider,state,code_verifier,origin,issued_by,return_target,context,expires_at
  )
  values(
    p_user,p_provider,p_state,p_verifier,'coach',v_actor.auth_user_id,'coach',
    jsonb_build_object('assignment_version',v_assignment.assignment_version),
    clock_timestamp()+interval '30 minutes'
  )
  returning * into v_flow;

  return jsonb_build_object('expiresAt',v_flow.expires_at);
end
$function$;

commit;