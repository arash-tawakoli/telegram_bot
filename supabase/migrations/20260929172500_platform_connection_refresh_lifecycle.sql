alter table public.platform_connections
  add column if not exists last_refresh_at timestamptz,
  add column if not exists last_refresh_error text,
  add column if not exists refresh_attempts integer not null default 0;

alter table public.platform_connections
  drop constraint if exists platform_connections_refresh_attempts_check;

alter table public.platform_connections
  add constraint platform_connections_refresh_attempts_check
  check (refresh_attempts >= 0);

create or replace function public.record_platform_connection_refresh(
  p_user uuid,
  p_provider text,
  p_success boolean,
  p_error text default null,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.platform_connections
  set
    refresh_attempts = refresh_attempts + 1,
    last_refresh_at = case when p_success then now() else last_refresh_at end,
    last_refresh_error = case
      when p_success then null
      else left(coalesce(nullif(btrim(p_error),''),'refresh_failed'),120)
    end,
    last_verified_at = case when p_success then now() else last_verified_at end,
    expires_at = case when p_success and p_expires_at is not null then p_expires_at else expires_at end,
    updated_at = now()
  where user_id=p_user and provider=p_provider;
end
$function$;

revoke all on function public.record_platform_connection_refresh(uuid,text,boolean,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.record_platform_connection_refresh(uuid,text,boolean,text,timestamptz)
  to service_role;
