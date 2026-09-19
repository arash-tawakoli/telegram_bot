
create or replace function app_private.enqueue_due_source_jobs(p_limit integer default 65)
returns integer
language plpgsql
set search_path to ''
as $function$
declare
  r record;
  v_msg_id bigint;
  v_job_id uuid;
  v_count integer := 0;
begin
  for r in
    select s.id
    from public.sources s
    where s.enabled = true
      and s.runtime_mode = 'live'
      and s.delivery_mode = 'live'
      and not exists (
        select 1
        from public.source_jobs j
        where j.source_id = s.id
          and j.status in ('enqueued','processing','retry')
          and j.queue_msg_id is not null
      )
      and (
        s.last_checked_at is null
        or s.last_checked_at <= now() - make_interval(
          mins => least(
            60,
            greatest(1, s.poll_interval_minutes) *
            case
              when coalesce(s.consecutive_failures,0) <= 1 then 1
              when s.consecutive_failures = 2 then 2
              when s.consecutive_failures = 3 then 4
              when s.consecutive_failures = 4 then 8
              else 12
            end
          )
        )
      )
    order by
      coalesce(s.crawl_priority,2147483647),
      coalesce(s.last_checked_at,'-infinity'::timestamptz),
      s.id
    limit greatest(1,least(coalesce(p_limit,65),65))
    for update skip locked
  loop
    v_job_id := gen_random_uuid();

    select x into v_msg_id
    from pgmq.send(
      'source_jobs',
      jsonb_build_object(
        'job_id',v_job_id,
        'source_id',r.id,
        'worker','source-worker'
      )
    ) as x
    limit 1;

    insert into public.source_jobs(
      id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at
    )
    values(
      v_job_id,v_msg_id,r.id,'enqueued','source-worker',now(),now()
    );

    update public.sources
    set last_checked_at=now(),updated_at=now()
    where id=r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

create or replace function app_private.dispatch_due_application_workers()
returns integer
language plpgsql
set search_path to ''
as $function$
declare
  v_immomio boolean := false;
  v_kleinanzeigen boolean := false;
  v_general boolean := false;
  v_secret text;
  v_count integer := 0;
begin
  with due as materialized (
    select app_private.application_provider_for_listing(l.source_id,l.raw) as provider
    from public.applications a
    join public.listings l on l.id=a.listing_id
    where (
      (a.status='pending'
       and a.next_attempt_at<=now()
       and (a.lease_until is null or a.lease_until<now()))
      or
      (a.status='processing'
       and (a.lease_until is null or a.lease_until<now()))
    )
  )
  select
    coalesce(bool_or(provider='immomio'),false),
    coalesce(bool_or(provider='kleinanzeigen'),false),
    coalesce(bool_or(
      provider is distinct from 'immomio'
      and provider is distinct from 'kleinanzeigen'
    ),false)
  into v_immomio,v_kleinanzeigen,v_general
  from due;

  if not (v_immomio or v_kleinanzeigen or v_general) then
    return 0;
  end if;

  v_secret := public.get_bot_secret('internal_worker_secret');

  if v_immomio then
    perform net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/immomio-application-worker',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-internal-secret',v_secret
      ),
      body:='{"action":"process"}'::jsonb,
      timeout_milliseconds:=55000
    );
    v_count := v_count + 1;
  end if;

  if v_general then
    perform net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/application-worker',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-internal-secret',v_secret
      ),
      body:='{"action":"process"}'::jsonb,
      timeout_milliseconds:=55000
    );
    v_count := v_count + 1;
  end if;

  if v_kleinanzeigen then
    perform net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-application-worker',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'x-internal-secret',v_secret
      ),
      body:='{"action":"process"}'::jsonb,
      timeout_milliseconds:=55000
    );
    v_count := v_count + 1;
  end if;

  return v_count;
end;
$function$;
