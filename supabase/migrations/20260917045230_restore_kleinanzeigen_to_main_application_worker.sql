do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='kleinanzeigen-platform-applications' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

create or replace function public.claim_application()
returns setof public.applications
language plpgsql
set search_path to ''
as $$
begin
  update public.applications a
  set status='manual_required', last_error='submission_unconfirmed'
  from public.listings l
  where l.id=a.listing_id
    and a.status='processing'
    and a.submission_started_at is not null
    and (a.lease_until is null or a.lease_until<now())
    and app_private.application_provider_for_listing(l.source_id,l.raw) is distinct from 'immomio';

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
      and app_private.application_provider_for_listing(l.source_id,l.raw) is distinct from 'immomio'
    order by x.next_attempt_at
    for update of x skip locked
    limit 1
  )
  returning a.*;
end
$$;

drop function if exists public.claim_kleinanzeigen_application();
