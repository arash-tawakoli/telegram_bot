alter table public.source_field_capabilities
  add column if not exists last_source_checked_at timestamptz,
  add column if not exists last_source_success_at timestamptz,
  add column if not exists last_source_error_at timestamptz;

create or replace function app_private.refresh_source_field_capabilities_v2()
returns integer
language plpgsql
set search_path=''
as $$
declare v_count integer;
begin
  v_count := app_private.refresh_source_field_capabilities();

  update public.source_field_capabilities c
  set audit_status = case
        when not s.enabled then 'disabled'
        when c.sample_size > 0 then 'sampled'
        when s.last_success_at is not null then 'no_current_listing_sample'
        else 'no_successful_sample_yet'
      end,
      last_source_checked_at=s.last_checked_at,
      last_source_success_at=s.last_success_at,
      last_source_error_at=s.last_error_at,
      last_audited_at=now()
  from public.sources s
  where s.id=c.source_id;

  return v_count;
end;
$$;

select cron.unschedule('source-field-capability-refresh-every-15-minutes');
select cron.schedule(
  'source-field-capability-refresh-every-15-minutes',
  '*/15 * * * *',
  $$select app_private.refresh_source_field_capabilities_v2();$$
);

select app_private.refresh_source_field_capabilities_v2();
