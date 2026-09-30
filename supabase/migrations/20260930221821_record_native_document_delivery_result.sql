-- Keep document upload confirmation distinct from application submission status.
create or replace function app_private.log_application_event()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_provider text;
  v_event text;
  v_document_result text;
begin
  select app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)
    into v_provider
  from public.listings l
  where l.id=new.listing_id;

  if tg_op='INSERT' then
    v_event := 'queued';
  elsif new.status is distinct from old.status then
    v_event := 'status_changed';
  elsif new.wait_reason is distinct from old.wait_reason then
    v_event := 'wait_changed';
  else
    return new;
  end if;

  v_document_result := case
    when new.provider_state->>'document_result' in (
      'native_uploaded','link_included','not_provided','not_supported','transfer_failed'
    ) then new.provider_state->>'document_result'
    else null
  end;

  insert into public.application_events(
    application_id,user_id,provider,event_type,status,attempt,reason,document_result,metadata
  )
  values(
    new.id,new.user_id,v_provider,v_event,new.status,new.attempts,
    coalesce(new.wait_reason,new.last_error),v_document_result,
    jsonb_build_object('source_id',new.source_id)
  );
  return new;
end
$function$;
