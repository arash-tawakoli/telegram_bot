alter table public.source_field_capabilities
  add column if not exists audit_note text,
  add column if not exists last_source_check_at timestamptz;

create or replace function app_private.normalize_listing_fallback_logo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.image_status = 'fallback' then
    new.resolved_image_url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/telegram-fallback-logo';
    new.image_source := 'telegram_fallback_logo';
    new.image_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_normalize_fallback_logo on public.listings;
create trigger listings_normalize_fallback_logo
before insert or update of image_status,resolved_image_url,image_source
on public.listings
for each row execute function app_private.normalize_listing_fallback_logo();

update public.listings
set resolved_image_url='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/telegram-fallback-logo',
    image_source='telegram_fallback_logo',
    image_error=null
where image_status='fallback';

create or replace function app_private.refresh_source_field_audit_status()
returns integer
language plpgsql
set search_path = ''
as $$
declare v_count integer;
begin
  update public.source_field_capabilities c
  set audit_status = case
        when not s.enabled and exists (
          select 1 from public.source_connectors sc
          where sc.source_id=s.id and sc.connector_kind='unsupported'
        ) then 'offline_only'
        when c.sample_size > 0 then 'sampled'
        when s.enabled and s.last_success_at is not null then 'checked_no_listing'
        when s.enabled and s.last_success_at is null and s.last_error_at is not null then 'crawl_error'
        when not s.enabled then 'disabled'
        else 'no_sample'
      end,
      audit_note = case
        when not s.enabled and exists (
          select 1 from public.source_connectors sc
          where sc.source_id=s.id and sc.connector_kind='unsupported'
        ) then 'Kein bestätigter digitaler Listing-Feed; Angebote werden nicht online enumeriert.'
        when c.sample_size > 0 then 'Feldmatrix aus realen, angereicherten Listings berechnet.'
        when s.enabled and s.last_success_at is not null then 'Quelle erfolgreich geprüft; aktuell bzw. historisch kein Listing-Sample in der Datenbank.'
        when s.enabled and s.last_success_at is null and s.last_error_at is not null then 'Quelle geprüft, Crawl derzeit fehlerhaft; Feldverfügbarkeit bleibt bis zu einem erfolgreichen Sample unbestätigt.'
        when not s.enabled then 'Quelle deaktiviert.'
        else 'Noch kein Listing-Sample verfügbar.'
      end,
      last_source_check_at = greatest(s.last_checked_at,s.last_success_at,s.last_error_at),
      last_audited_at = now()
  from public.sources s
  where s.id=c.source_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

select app_private.refresh_source_field_audit_status();

select cron.schedule(
  'source-field-capability-refresh-every-15-minutes',
  '*/15 * * * *',
  $$select app_private.refresh_source_field_capabilities(); select app_private.refresh_source_field_audit_status();$$
);
