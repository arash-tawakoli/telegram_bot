create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create or replace function app_private.parse_eur(raw_value text)
returns numeric
language plpgsql
immutable
strict
as $$
declare s text := trim(raw_value);
begin
  s := regexp_replace(s, '[^0-9,.-]', '', 'g');
  if s = '' then return null; end if;
  if position(',' in s) > 0 then
    s := replace(replace(s, '.', ''), ',', '.');
  elsif s ~ '^[0-9]{1,3}\.[0-9]{3}$' then
    s := replace(s, '.', '');
  end if;
  return s::numeric;
exception when others then return null;
end;
$$;

create or replace function app_private.enrich_listing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  txt text := coalesce(new.raw::text, '');
  m text[];
  v numeric;
begin
  if new.warm_rent is null then
    m := regexp_match(txt, '(?i)(?:Warmmiete|Gesamtmiete|Miete warm)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.warm_rent := app_private.parse_eur(m[1]); end if;
  end if;

  if new.heating_costs is null then
    m := regexp_match(txt, '(?i)(?:Heizkosten|Heizungskosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.heating_costs := app_private.parse_eur(m[1]); end if;
  end if;

  if new.additional_costs is null then
    m := regexp_match(txt, '(?i)(?:Nebenkosten|Betriebskosten|sonstige Kosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.additional_costs := app_private.parse_eur(m[1]); end if;
  end if;

  if new.deposit is null then
    m := regexp_match(txt, '(?i)(?:Kaution|Mietkaution|Mietsicherheit)[^0-9]{0,50}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.deposit := app_private.parse_eur(m[1]); end if;
  end if;

  if new.deposit_text is null and new.deposit is null then
    m := regexp_match(txt, '(?i)((?:Kaution|Mietkaution|Mietsicherheit)[^,;}]{0,100})');
    if m is not null then new.deposit_text := left(regexp_replace(m[1], '\\s+', ' ', 'g'), 120); end if;
  end if;

  if new.warm_rent is null and new.cold_rent is not null and (new.heating_costs is not null or new.additional_costs is not null) then
    new.warm_rent := new.cold_rent + coalesce(new.heating_costs,0) + coalesce(new.additional_costs,0);
  end if;
  return new;
end;
$$;

revoke all on function app_private.parse_eur(text) from public, anon, authenticated;
revoke all on function app_private.enrich_listing_fields() from public, anon, authenticated;

drop trigger if exists listings_enrich_fields on public.listings;
create trigger listings_enrich_fields
before insert or update of raw, warm_rent, cold_rent, heating_costs, additional_costs, deposit, deposit_text
on public.listings
for each row execute function app_private.enrich_listing_fields();

update public.listings set raw = raw;

create or replace function public.get_bot_secret(secret_name text)
returns text
language sql
security definer
set search_path = ''
as $$
  select case
    when secret_name = 'telegram_bot_token' then 'LEGACY_DELIVERY_DISABLED'
    else (select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1)
  end;
$$;
revoke all on function public.get_bot_secret(text) from public, anon, authenticated;
grant execute on function public.get_bot_secret(text) to service_role;

select cron.schedule(
  'notification-dispatcher-every-30-seconds',
  '30 seconds',
  $$
  select net.http_post(
    url := 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/notification-dispatcher',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-internal-secret', public.get_bot_secret('internal_worker_secret')
    ),
    body := jsonb_build_object('time', now()),
    timeout_milliseconds := 15000
  );
  $$
);
