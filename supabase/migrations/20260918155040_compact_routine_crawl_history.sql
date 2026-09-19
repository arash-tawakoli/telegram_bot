
create or replace function public.record_crawl_result(
  p_source_id smallint,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_success boolean,
  p_connector_priority smallint,
  p_connector_label text,
  p_fetched_count integer,
  p_inserted_count integer,
  p_metadata jsonb,
  p_error text
)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  if p_success is null
     or p_started_at is null
     or p_finished_at is null
     or p_fetched_count is null or p_fetched_count < 0
     or p_inserted_count is null or p_inserted_count < 0
     or p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
  then
    raise exception 'invalid crawl result' using errcode='22023';
  end if;

  if p_success then
    update public.sources
    set
      last_success_at = p_finished_at,
      last_error_at = null,
      consecutive_failures = 0,
      baseline_completed_at = coalesce(
        baseline_completed_at,
        case
          when p_metadata->'complete' is distinct from 'false'::jsonb
          then p_finished_at
        end
      ),
      coverage_status = case
        when p_source_id = 1 or p_metadata->'complete' = 'false'::jsonb
        then 'partial'
        else 'complete'
      end,
      updated_at = p_finished_at
    where id = p_source_id;
  else
    update public.sources
    set
      last_error_at = p_finished_at,
      consecutive_failures = coalesce(consecutive_failures,0) + 1,
      updated_at = p_finished_at
    where id = p_source_id;
  end if;

  if not found then
    raise exception 'source unavailable' using errcode='23503';
  end if;

  -- Full failure history and every discovery are durable. Routine successful
  -- no-change checks are represented by one heartbeat per source/connector/hour.
  if p_success
     and p_source_id <> 2
     and p_inserted_count = 0
     and exists (
       select 1
       from public.crawl_runs cr
       where cr.source_id = p_source_id
         and cr.success = true
         and cr.connector_priority is not distinct from p_connector_priority
         and cr.connector_label is not distinct from p_connector_label
         and cr.finished_at >= p_finished_at - interval '1 hour'
       limit 1
     )
  then
    return;
  end if;

  insert into public.crawl_runs(
    source_id,started_at,finished_at,success,
    connector_priority,connector_label,fetched_count,inserted_count,
    metadata,error_message
  )
  values(
    p_source_id,p_started_at,p_finished_at,p_success,
    p_connector_priority,p_connector_label,p_fetched_count,p_inserted_count,
    p_metadata,left(p_error,1500)
  );
end;
$function$;
