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
      and app_private.application_provider_for_listing(l.source_id,l.raw) is distinct from 'kleinanzeigen'
    order by x.next_attempt_at
    for update of x skip locked
    limit 1
  )
  returning a.*;
end
$$;

create or replace function public.claim_kleinanzeigen_application()
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
    and app_private.application_provider_for_listing(l.source_id,l.raw)='kleinanzeigen';

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
      and app_private.application_provider_for_listing(l.source_id,l.raw)='kleinanzeigen'
    order by x.next_attempt_at
    for update of x skip locked
    limit 1
  )
  returning a.*;
end
$$;

revoke all on function public.claim_kleinanzeigen_application() from public, anon, authenticated;
grant execute on function public.claim_kleinanzeigen_application() to service_role;

select cron.schedule(
  'kleinanzeigen-platform-applications',
  '* * * * *',
  $cron$
    select net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-application-worker',
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
      and app_private.application_provider_for_listing(l.source_id,l.raw)='kleinanzeigen'
    );
  $cron$
);
