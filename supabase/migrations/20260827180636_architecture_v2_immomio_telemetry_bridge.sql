create or replace function app_private.log_immomio_source_success()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  j record;
  sc record;
  v_started timestamptz;
  v_count integer;
begin
  if new.worker_slug <> 'source-immomio'
     or new.last_success_at is null
     or new.last_success_at is not distinct from old.last_success_at then
    return new;
  end if;

  select id,started_at into j
  from public.source_jobs
  where source_id=new.id
    and status in ('processing','done')
    and started_at is not null
    and started_at <= new.last_success_at + interval '5 seconds'
  order by started_at desc
  limit 1;

  v_started := coalesce(j.started_at,new.last_success_at-interval '2 minutes');

  if exists (
    select 1 from public.crawl_runs cr
    where cr.source_id=new.id
      and cr.started_at=v_started
      and cr.metadata->>'mode'='immomio-tenant-telemetry-bridge'
  ) then return new; end if;

  select priority,label into sc
  from public.source_connectors
  where source_id=new.id and enabled=true and connector_kind='immomio_tenant'
  order by priority limit 1;

  select count(*) into v_count
  from public.listings l
  where l.source_id=new.id
    and l.is_active=true
    and l.last_seen_at >= v_started-interval '5 seconds';

  insert into public.crawl_runs(
    source_id,started_at,finished_at,success,connector_priority,connector_label,
    fetched_count,inserted_count,metadata
  ) values (
    new.id,v_started,new.last_success_at,true,coalesce(sc.priority,1),coalesce(sc.label,'Immomio Tenant GraphQL'),
    v_count,0,jsonb_build_object('mode','immomio-tenant-telemetry-bridge','source_job_id',j.id)
  );
  return new;
end;
$$;

drop trigger if exists sources_log_immomio_success on public.sources;
create trigger sources_log_immomio_success
after update of last_success_at on public.sources
for each row execute function app_private.log_immomio_source_success();
