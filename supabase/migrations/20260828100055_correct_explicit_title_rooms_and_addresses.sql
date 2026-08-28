-- Production migration mirror: prefer explicit title room counts and reject UI/navigation text as addresses.

create or replace function app_private.normalize_explicit_listing_facts()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m text[];
  v_rooms numeric;
  v_addr_plz text;
begin
  m := regexp_match(coalesce(new.title, ''), '(?i)([0-9]+(?:[.,][0-9]+)?)\s*[-– ]\s*Zimmer');
  if m is not null then
    begin v_rooms := replace(m[1], ',', '.')::numeric; exception when others then v_rooms := null; end;
    if v_rooms between 0.5 and 20 and (new.rooms is null or abs(new.rooms - v_rooms) > 0.25) then
      new.rooms := v_rooms;
      new.enrichment_evidence := jsonb_set(
        coalesce(new.enrichment_evidence, '{}'::jsonb),
        '{rooms}',
        jsonb_build_object('value', v_rooms, 'source', 'title:explicit_rooms', 'confidence', 0.995),
        true
      );
      new.field_conflicts := coalesce(new.field_conflicts, '{}'::jsonb) - 'rooms';
    end if;
  end if;

  if new.address is not null then
    new.address := regexp_replace(new.address, '(?i)^\s*(?:Kaltmiete|Warmmiete|Gesamtmiete|Miete)\s+', '', '');
    new.address := regexp_replace(new.address, '\s+', ' ', 'g');
    v_addr_plz := substring(new.address from '(2[0-9]{4})');
    if new.address ~* '(Andere Anzeigen des Anbieters|Alle Anzeigen dieses Anbieters|Weitere Anzeigen|Ähnliche Anzeigen|Anbieter kontaktieren|Immobilienangebote)'
       or (new.postal_code is not null and v_addr_plz is not null and v_addr_plz <> new.postal_code) then
      new.address := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists listings_normalize_explicit_facts on public.listings;
create trigger listings_normalize_explicit_facts
before insert or update of title, rooms, address, enrichment_evidence
on public.listings
for each row execute function app_private.normalize_explicit_listing_facts();

-- Repair existing rows through the same trigger path without changing business data otherwise.
update public.listings set title = title where is_active = true;
