-- Keep proven productive sources at the front of the bounded source queue.
update public.sources
set crawl_priority = crawl_priority + 1000
where crawl_priority is not null;

with hot(name, priority) as (
  values
    ('ImmobilienScout24 Hamburg'::text, 1),
    ('Kleinanzeigen Hamburg'::text, 2),
    ('Immowelt Hamburg'::text, 3),
    ('WG-Gesucht Hamburg'::text, 4),
    ('Ohne-Makler.net Hamburg'::text, 5),
    ('Wunderflats Hamburg'::text, 6),
    ('immobilien.de Hamburg'::text, 7),
    ('Nestpick Hamburg'::text, 8),
    ('City-Wohnen Hamburg'::text, 9),
    ('immobilie1 Hamburg'::text, 10),
    ('Finkenwärder-Hoffnung'::text, 11)
)
update public.sources s
set crawl_priority = h.priority
from hot h
where s.name = h.name;

with ranked as (
  select id, 11 + row_number() over (order by crawl_priority, id) as priority
  from public.sources
  where crawl_priority >= 1000
)
update public.sources s
set crawl_priority = r.priority
from ranked r
where s.id = r.id;

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='source-scheduler-every-minute'),
  command := $cmd$
select app_private.enqueue_due_source_jobs(12);
select net.http_post(
    url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/source-worker',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret',public.get_bot_secret('internal_worker_secret')
    ),
    body:='{}'::jsonb,
    timeout_milliseconds:=55000
  )
where exists (select 1 from pgmq.q_source_jobs where vt <= now());
$cmd$
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='notification-dispatcher-every-minute'),
  command := $cmd$
select app_private.prepare_current_delivery_queue()
where exists (
  select 1
  from public.delivery_events
  where status in ('pending','failed')
    and delivery_outcome_unknown=false
    and dispatch_attempts<5
    and (next_retry_at is null or next_retry_at<=now())
);
select net.http_post(
  url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/notification-dispatcher',
  headers:=jsonb_build_object(
    'Content-Type','application/json',
    'x-internal-secret',public.get_bot_secret('internal_worker_secret')
  ),
  body:='{}'::jsonb,
  timeout_milliseconds:=145000
)
where exists (
  select 1 from public.delivery_events
  where (
    status in ('pending','failed')
    and delivery_outcome_unknown=false
    and dispatch_attempts<5
    and (next_retry_at is null or next_retry_at<=now())
  ) or (
    status='processing'
    and last_attempt_at<now()-interval '10 minutes'
  )
);
$cmd$
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='coop-provider-index-process'),
  command := $cmd$
select app_private.process_partial_coop_provider_checks()
where exists (
  select 1
  from app_private.coop_provider_index_requests q
  join net._http_response h on h.id=q.request_id
  where q.processed_at is null
);
$cmd$
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='telegram-inbox-recovery'),
  command := $cmd$
select app_private.retry_telegram_updates()
where exists (
  select 1
  from public.bot_events
  where processing_attempt<5
    and (
      (processing_status in ('pending','failed')
       and coalesce(processing_at,created_at)<now()-interval '1 minute')
      or
      (processing_status='processing'
       and processing_at<now()-interval '10 minutes')
    )
)
or exists (
  select 1
  from app_private.ui_action_jobs
  where attempt<3
    and (
      (status='pending' and created_at<now()-interval '1 minute')
      or
      (status='processing' and lease_until<now())
    )
)
or exists (
  select 1
  from app_private.ui_action_jobs
  where status='processing' and attempt>=3 and lease_until<now()
)
or exists (
  select 1
  from app_private.ui_action_jobs
  where status in ('done','failed') and finished_at<now()-interval '7 days'
)
or exists (
  select 1
  from public.bot_users
  where application_ui_state<>'{}'::jsonb
    and coalesce(application_ui_state->>'updated_at','')<
        to_char(now()-interval '1 day','YYYY-MM-DD"T"HH24:MI:SS')
);
$cmd$
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='platform-applications'),
  command := $cmd$
select app_private.dispatch_due_application_workers()
where exists (
  select 1
  from public.applications a
  where (
    a.status='pending'
    and a.next_attempt_at<=now()
    and (a.lease_until is null or a.lease_until<now())
  ) or (
    a.status='processing'
    and (a.lease_until is null or a.lease_until<now())
  )
);
$cmd$
);

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname='expire-admin-premium-overrides'),
  schedule := '*/5 * * * *'
);

create or replace function app_private.maintenance_cleanup()
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  r record;
  removed integer;
  result jsonb := '{}';
begin
  delete from public.crawl_runs
  where ctid in (
    select ctid
    from public.crawl_runs
    where success=true and finished_at<now()-interval '3 days'
    union all
    select ctid
    from public.crawl_runs
    where success=false and finished_at<now()-interval '30 days'
    limit 5000
  );
  get diagnostics removed = row_count;
  result := jsonb_build_object('crawl_runs_deleted',removed);

  for r in
    select * from (values
      ('source_jobs_deleted','public.source_jobs',
       $$((status='done' and finished_at<now()-interval '1 day')
          or (status='dead' and finished_at<now()-interval '7 days'))$$),
      ('queue_archive_deleted','pgmq.a_source_jobs',
       $$archived_at<now()-interval '2 days'$$),
      ('delivery_events_deleted','public.delivery_events',
       $$status in ('sent','skipped') and created_at<now()-interval '90 days'$$),
      ('shadow_runs_deleted','app_private.source_shadow_runs',
       $$checked_at<now()-interval '14 days'$$),
      ('telegram_effects_deleted','app_private.telegram_effects',
       $$update_id in (
         select telegram_update_id
         from public.bot_events
         where created_at<now()-interval '30 days'
           and processing_status='done'
       )$$),
      ('cron_runs_deleted','cron.job_run_details',
       $$((status='succeeded' and end_time<now()-interval '1 day')
          or (status='failed' and end_time<now()-interval '30 days'))$$)
    ) as rules(key,relation,predicate)
  loop
    execute format(
      'delete from %s where ctid in (select ctid from %s where %s limit 5000)',
      r.relation,r.relation,r.predicate
    );
    get diagnostics removed = row_count;
    result := result || jsonb_build_object(r.key,removed);
  end loop;

  result := result || jsonb_build_object(
    'performance_snapshot_created',
    app_private.capture_performance_snapshot()
  );
  return result;
end;
$function$;

delete from app_private.source_shadow_runs
where checked_at < now()-interval '14 days';

analyze app_private.source_shadow_runs;
