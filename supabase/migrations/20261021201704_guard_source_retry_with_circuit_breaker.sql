CREATE OR REPLACE FUNCTION app_private.retry_transient_dead_source_jobs(p_limit integer DEFAULT 1, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_msg_id bigint;
  v_limit integer := greatest(1,least(coalesce(p_limit,1),3));
  v_seen integer := 0;
  v_requeued integer := 0;
  v_jobs jsonb := '[]'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('source-dead-letter-retry',0)) then
    return jsonb_build_object('ok',false,'reason','retry_run_already_active','dryRun',coalesce(p_dry_run,true),'eligibleCount',0,'requeuedCount',0,'jobs','[]'::jsonb);
  end if;

  for r in
    select j.id,j.source_id,s.name as source_name,j.attempts,j.updated_at,j.error_message,
      'transient'::text as error_class
    from public.source_jobs j
    join public.sources s on s.id=j.source_id
    where j.status='dead'
      and j.attempts < 3
      and j.updated_at >= now()-interval '24 hours'
      and j.updated_at <= now()-make_interval(mins => 5 * power(2,greatest(j.attempts-1,0))::integer)
      and coalesce(j.error_message,'') ~* '(signal timed out|timed out|timeout|http 429|http 5[0-9]{2}|connection error|connect error|no route to host|service unavailable|bad gateway|connection reset|fetch failed|network error|econn)'
      and coalesce(j.error_message,'') !~* '(lock timeout|deadlock|canceling statement|query canceled|syntax error|permission denied)'
      and s.enabled=true
      and s.runtime_mode='live'
      and s.delivery_mode='live'
      and coalesce(s.consecutive_failures,0)<3
      and (s.last_success_at is null or s.last_success_at<=j.updated_at)
      and not exists (
        select 1 from public.source_jobs active_job
        where active_job.source_id=j.source_id
          and active_job.id<>j.id
          and (active_job.status in ('enqueued','processing','retry')
            or (active_job.status='done' and active_job.updated_at>j.updated_at))
      )
      and not exists (
        select 1 from public.source_jobs newer
        where newer.source_id=j.source_id and newer.id<>j.id
          and newer.status='dead' and newer.updated_at>j.updated_at
      )
    order by j.updated_at asc,j.attempts asc
    limit v_limit
    for update of j skip locked
  loop
    v_seen := v_seen+1;
    if coalesce(p_dry_run,true) then
      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
        'jobId',r.id,'sourceId',r.source_id,'source',r.source_name,
        'attempts',r.attempts,'errorClass',r.error_class,'updatedAt',r.updated_at,
        'action','would_requeue'
      ));
      continue;
    end if;

    select x into v_msg_id
    from pgmq.send('source_jobs',jsonb_build_object(
      'job_id',r.id,'source_id',r.source_id,'worker','source-worker'
    )) as x
    limit 1;

    update public.source_jobs
    set queue_msg_id=v_msg_id,status='enqueued',worker='source-worker',
        enqueued_at=now(),started_at=null,finished_at=null,updated_at=now()
    where id=r.id and status='dead' and attempts=r.attempts;

    if found then
      v_requeued := v_requeued+1;
      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
        'jobId',r.id,'sourceId',r.source_id,'source',r.source_name,
        'attempts',r.attempts,'errorClass',r.error_class,'updatedAt',r.updated_at,
        'queueMessageId',v_msg_id,'action','requeued'
      ));
    else
      perform pgmq.archive('source_jobs',v_msg_id);
      v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
        'jobId',r.id,'sourceId',r.source_id,'source',r.source_name,
        'attempts',r.attempts,'action','skipped_concurrent_state_change'
      ));
    end if;
  end loop;

  return jsonb_build_object('ok',true,'dryRun',coalesce(p_dry_run,true),
    'eligibleCount',v_seen,'requeuedCount',v_requeued,'limit',v_limit,'jobs',v_jobs);
end;
$function$
;
revoke all on function app_private.retry_transient_dead_source_jobs(integer,boolean) from public, anon, authenticated;
grant execute on function app_private.retry_transient_dead_source_jobs(integer,boolean) to service_role;
