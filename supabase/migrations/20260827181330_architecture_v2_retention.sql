create or replace function app_private.maintenance_cleanup()
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_jobs integer:=0;
  v_archive integer:=0;
  v_runs integer:=0;
begin
  delete from public.source_jobs
  where (status='done' and finished_at < now()-interval '14 days')
     or (status='dead' and finished_at < now()-interval '90 days');
  get diagnostics v_jobs = row_count;

  delete from pgmq.a_source_jobs
  where archived_at < now()-interval '30 days';
  get diagnostics v_archive = row_count;

  delete from public.crawl_runs
  where (success=true and finished_at < now()-interval '90 days')
     or (success=false and finished_at < now()-interval '180 days');
  get diagnostics v_runs = row_count;

  return jsonb_build_object('source_jobs_deleted',v_jobs,'queue_archive_deleted',v_archive,'crawl_runs_deleted',v_runs);
end;
$$;

select cron.unschedule('architecture-maintenance-daily') where exists (select 1 from cron.job where jobname='architecture-maintenance-daily');
select cron.schedule('architecture-maintenance-daily','17 4 * * *',$$select app_private.maintenance_cleanup();$$);
