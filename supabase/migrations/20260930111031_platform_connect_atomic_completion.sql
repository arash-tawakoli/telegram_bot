-- One claim per connection process, one atomic credential write per ticket.
create or replace function app_private.assert_platform_connect_context(p_flow public.platform_auth_flows)
returns void language plpgsql set search_path=''
as $$
declare v_issuer public.coaching_members%rowtype;
begin
  perform 1 from public.bot_users where id=p_flow.user_id and is_active for share;
  if not found then raise exception 'auth_flow_expired'; end if;
  if not exists(select 1 from public.coach_effective_premium_status(array[p_flow.user_id]) where is_premium)
  then raise exception 'premium_required'; end if;
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
    if not exists(select 1 from public.bot_users where id=p_flow.user_id and telegram_user_id is not null and chat_id is not null)
    then raise exception 'auth_flow_expired'; end if;
  end if;
end $$;
revoke all on function app_private.assert_platform_connect_context(public.platform_auth_flows) from public,anon,authenticated;
grant execute on function app_private.assert_platform_connect_context(public.platform_auth_flows) to service_role;

create or replace function public.claim_platform_connect_flow(p_flow uuid,p_user uuid,p_provider text)
returns text language plpgsql set search_path=''
as $$
declare v_flow public.platform_auth_flows%rowtype; v_claim text;
begin
  select * into v_flow from public.platform_auth_flows
  where id=p_flow and user_id=p_user and provider=p_provider;
  if not found then raise exception 'auth_flow_expired'; end if;
  -- Lock membership/assignment before the flow: assignment invalidation uses that order.
  perform app_private.assert_platform_connect_context(v_flow);
  select * into v_flow from public.platform_auth_flows
  where id=p_flow and user_id=p_user and provider=p_provider for update;
  if not found or v_flow.consumed_at is not null or v_flow.expires_at<=clock_timestamp()
     or v_flow.context ? 'completion_claim' then raise exception 'auth_flow_expired'; end if;
  v_claim:=encode(extensions.gen_random_bytes(24),'hex');
  update public.platform_auth_flows
  set context=coalesce(context,'{}'::jsonb)||jsonb_build_object('completion_claim',v_claim)
  where id=p_flow;
  return v_claim;
end $$;
revoke all on function public.claim_platform_connect_flow(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_platform_connect_flow(uuid,uuid,text) to service_role;

create or replace function public.complete_platform_connect_flow(p_flow uuid,p_user uuid,p_provider text,p_claim text,p_connection jsonb)
returns boolean language plpgsql set search_path=''
as $$
declare v_flow public.platform_auth_flows%rowtype;
begin
  select * into v_flow from public.platform_auth_flows
  where id=p_flow and user_id=p_user and provider=p_provider;
  if not found then raise exception 'auth_flow_expired'; end if;
  perform app_private.assert_platform_connect_context(v_flow);
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
    user_id,provider,status,credential_ciphertext,credential_iv,key_version,
    account_hint,expires_at,last_verified_at,last_error,updated_at
  ) values(
    p_user,p_provider,'connected',p_connection->>'credential_ciphertext',
    p_connection->>'credential_iv',coalesce((p_connection->>'key_version')::smallint,1),
    nullif(p_connection->>'account_hint',''),
    nullif(p_connection->>'expires_at','')::timestamptz,clock_timestamp(),null,clock_timestamp()
  )
  on conflict(user_id,provider) do update set
    status='connected',credential_ciphertext=excluded.credential_ciphertext,
    credential_iv=excluded.credential_iv,key_version=excluded.key_version,
    account_hint=excluded.account_hint,expires_at=excluded.expires_at,
    last_verified_at=excluded.last_verified_at,last_error=null,updated_at=excluded.updated_at;
  update public.platform_auth_flows
  set consumed_at=clock_timestamp(),context=context||jsonb_build_object('completed_at',clock_timestamp())
  where id=p_flow;
  return true;
end $$;
revoke all on function public.complete_platform_connect_flow(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_platform_connect_flow(uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.coach_issue_platform_connect_flow(p_actor uuid,p_user uuid,p_provider text,p_state text,p_verifier text)
returns jsonb language plpgsql set search_path=''
as $$
declare v_actor public.coaching_members%rowtype; v_assignment public.coaching_participants%rowtype; v_flow public.platform_auth_flows%rowtype;
begin
  select * into v_actor from public.coaching_members where id=p_actor and is_active for share;
  if not found then raise exception 'coach_forbidden'; end if;
  if p_provider not in ('immoscout','kleinanzeigen','immomio','immowelt')
     or p_state !~ '^[A-Za-z0-9_-]{30,100}$' or p_verifier !~ '^[A-Za-z0-9_-]{43,128}$'
  then raise exception 'provider_unsupported'; end if;
  select * into v_assignment from public.coaching_participants
  where user_id=p_user and workspace_id=v_actor.workspace_id and status='active'
    and (v_actor.role='admin' or coach_member_id=p_actor) for update;
  if not found then raise exception 'participant_forbidden'; end if;
  if not exists(select 1 from public.coaching_workspaces where id=v_actor.workspace_id and is_active and not operations_paused)
  then raise exception 'workspace_unavailable'; end if;
  if not exists(select 1 from public.coach_effective_premium_status(array[p_user]) where is_premium)
  then raise exception 'premium_required'; end if;
  update public.platform_auth_flows set consumed_at=clock_timestamp()
  where user_id=p_user and provider=p_provider and consumed_at is null;
  insert into public.platform_auth_flows(user_id,provider,state,code_verifier,origin,issued_by,return_target,context,expires_at)
  values(p_user,p_provider,p_state,p_verifier,'coach',v_actor.auth_user_id,'coach',
    jsonb_build_object('assignment_version',v_assignment.assignment_version),clock_timestamp()+interval '30 minutes')
  returning * into v_flow;
  return jsonb_build_object('expiresAt',v_flow.expires_at);
end $$;
revoke all on function public.coach_issue_platform_connect_flow(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.coach_issue_platform_connect_flow(uuid,uuid,text,text,text) to service_role;
