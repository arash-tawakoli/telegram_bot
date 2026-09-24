create or replace function public.immomio_application_request_started(p_application uuid)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select exists(
    select 1
    from app_private.application_send_keys k
    where k.application_id = p_application
      and k.provider = 'immomio'
      and k.request_started_at is not null
  );
$function$;

revoke all on function public.immomio_application_request_started(uuid) from public, anon, authenticated;
grant execute on function public.immomio_application_request_started(uuid) to service_role;

create or replace function public.claim_immomio_application()
returns setof public.applications
language plpgsql
set search_path to ''
as $function$
begin
  update public.applications a
  set status = case
        when exists (
          select 1 from app_private.application_send_keys k
          where k.application_id=a.id and k.provider='immomio' and k.request_started_at is not null
        ) then 'manual_required' else 'pending' end,
      last_error = case
        when exists (
          select 1 from app_private.application_send_keys k
          where k.application_id=a.id and k.provider='immomio' and k.request_started_at is not null
        ) then 'submission_unconfirmed' else 'temporary_network_error' end,
      submission_started_at = case
        when exists (
          select 1 from app_private.application_send_keys k
          where k.application_id=a.id and k.provider='immomio' and k.request_started_at is not null
        ) then a.submission_started_at else null end,
      next_attempt_at = case
        when exists (
          select 1 from app_private.application_send_keys k
          where k.application_id=a.id and k.provider='immomio' and k.request_started_at is not null
        ) then a.next_attempt_at else now() end,
      lease_token = null,
      lease_until = null
  where a.status='processing'
    and a.submission_started_at is not null
    and (a.lease_until is null or a.lease_until<now())
    and exists (
      select 1 from public.listings l
      where l.id=a.listing_id
        and app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)='immomio'
    );

  return query
  update public.applications a
  set lease_token=gen_random_uuid(), lease_until=now()+interval '3 minutes'
  where a.id=(
    select x.id
    from public.applications x
    join public.listings l on l.id=x.listing_id
    where x.status='pending'
      and x.submission_started_at is null
      and x.next_attempt_at<=now()
      and (x.lease_until is null or x.lease_until<now())
      and app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)='immomio'
    order by x.next_attempt_at
    for update of x skip locked
    limit 1
  )
  returning a.*;
end;
$function$;
