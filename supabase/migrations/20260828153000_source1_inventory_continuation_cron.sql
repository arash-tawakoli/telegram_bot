create or replace function public.enqueue_immoscout_inventory_continuation()
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job_id uuid;
  v_msg_id bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('immoscout_inventory_continuation'));

  if not exists (
    select 1 from public.immoscout_inventory_runs r where r.status='running'
  ) then
    return null;
  end if;

  if exists (
    select 1 from public.source_jobs j
    where j.source_id=1 and j.status in ('enqueued','processing','retry')
  ) then
    return null;
  end if;

  v_job_id := gen_random_uuid();
  select x into v_msg_id
  from pgmq.send(
    'source_jobs',
    jsonb_build_object('job_id',v_job_id,'source_id',1,'worker','source-immoscout')
  ) as x
  limit 1;

  insert into public.source_jobs(
    id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at
  ) values (
    v_job_id,v_msg_id,1,'enqueued','source-immoscout',now(),now()
  );

  return v_job_id;
end;
$$;

revoke all on function public.enqueue_immoscout_inventory_continuation() from public,anon,authenticated;
grant execute on function public.enqueue_immoscout_inventory_continuation() to service_role;

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='immoscout-inventory-continuation' loop
    perform cron.unschedule(r.jobid);
  end loop;
  perform cron.schedule(
    'immoscout-inventory-continuation',
    '* * * * *',
    'select public.enqueue_immoscout_inventory_continuation();'
  );
end;
$$;