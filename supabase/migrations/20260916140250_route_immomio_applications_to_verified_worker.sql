create or replace function public.claim_application()
returns setof public.applications
language plpgsql
set search_path to ''
as $$
begin
  -- Never retry a request after the remote-send boundary, even if its worker died.
  update public.applications
  set status='manual_required', last_error='submission_unconfirmed'
  where status='processing'
    and submission_started_at is not null
    and (lease_until is null or lease_until<now());

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

create or replace function public.claim_immomio_application()
returns setof public.applications
language plpgsql
set search_path to ''
as $$
begin
  update public.applications a
  set status='manual_required', last_error='submission_unconfirmed'
  where a.status='processing'
    and a.submission_started_at is not null
    and (a.lease_until is null or a.lease_until<now())
    and exists (
      select 1
      from public.listings l
      where l.id=a.listing_id
        and app_private.application_provider_for_listing(l.source_id,l.raw)='immomio'
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
      and app_private.application_provider_for_listing(l.source_id,l.raw)='immomio'
    order by x.next_attempt_at
    for update of x skip locked
    limit 1
  )
  returning a.*;
end
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname='immomio-platform-applications') then
    perform cron.unschedule('immomio-platform-applications');
  end if;
end
$$;

select cron.schedule(
  'immomio-platform-applications',
  '* * * * *',
  $cron$
    select net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/immomio-application-worker',
      headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
      body:='{"action":"process"}'::jsonb,
      timeout_milliseconds:=55000
    )
    where exists(
      select 1
      from public.applications a
      join public.listings l on l.id=a.listing_id
      where (
        (a.status='pending' and a.next_attempt_at<=now() and (a.lease_until is null or a.lease_until<now()))
        or (a.status='processing' and (a.lease_until is null or a.lease_until<now()))
      )
      and app_private.application_provider_for_listing(l.source_id,l.raw)='immomio'
    );
  $cron$
);
