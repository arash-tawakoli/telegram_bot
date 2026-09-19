
create or replace function public.record_connector_lane_result(
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
  if p_source_id is null
     or p_started_at is null
     or p_finished_at is null
     or p_success is null
     or p_connector_priority is null
     or p_connector_label is null
     or p_fetched_count is null or p_fetched_count < 0
     or p_inserted_count is null or p_inserted_count < 0
     or p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
  then
    raise exception 'invalid connector lane result' using errcode='22023';
  end if;

  if p_success
     and p_inserted_count = 0
     and exists (
       select 1
       from public.crawl_runs cr
       where cr.source_id = p_source_id
         and cr.success = true
         and cr.connector_priority = p_connector_priority
         and cr.connector_label = p_connector_label
         and cr.finished_at >= p_finished_at - interval '1 hour'
       limit 1
     )
  then
    return;
  end if;

  insert into public.crawl_runs(
    source_id,started_at,finished_at,success,
    connector_priority,connector_label,fetched_count,inserted_count,
    error_message,metadata
  )
  values(
    p_source_id,p_started_at,p_finished_at,p_success,
    p_connector_priority,p_connector_label,p_fetched_count,p_inserted_count,
    left(p_error,1500),p_metadata
  );
end;
$function$;
