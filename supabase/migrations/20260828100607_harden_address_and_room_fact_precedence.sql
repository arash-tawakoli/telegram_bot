-- Production migration mirror: final fact precedence for title-room counts and safe addresses.

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
      new.enrichment_evidence := jsonb_set(coalesce(new.enrichment_evidence, '{}'::jsonb), '{rooms}', jsonb_build_object('value', v_rooms, 'source', 'title:explicit_rooms', 'confidence', 0.995), true);
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

create or replace function app_private.apply_source_specific_field_repairs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rooms numeric;
  v_warm numeric;
  v_cold numeric;
  m text[];
begin
  if new.enrichment_status <> 'done' then return new; end if;

  m := regexp_match(coalesce(new.title, ''), '(?i)([0-9]+(?:[.,][0-9]+)?)\s*[-– ]\s*Zimmer');
  if m is not null then
    begin v_rooms := replace(m[1], ',', '.')::numeric; exception when others then v_rooms := null; end;
  end if;

  if new.source_id = 2 then
    if new.cold_rent is null and new.enrichment_evidence->'cold_rent'->>'source' = 'detail:text' then
      v_cold := (new.enrichment_evidence->'cold_rent'->>'value')::numeric;
    end if;
    if new.warm_rent is null and new.enrichment_evidence->'warm_rent'->>'source' = 'detail:text' then
      v_warm := (new.enrichment_evidence->'warm_rent'->>'value')::numeric;
    end if;
  elsif new.source_id = 9 then
    if v_rooms is null
       and new.enrichment_evidence->'rooms'->>'source' like 'raw:jsonld.%'
       and coalesce((new.enrichment_evidence->'rooms'->>'confidence')::numeric, 0) >= 0.95 then
      v_rooms := (new.enrichment_evidence->'rooms'->>'value')::numeric;
    end if;
    if new.warm_rent is null then
      v_warm := nullif(replace(substring(coalesce(new.title, '') from '€[[:space:]]*([0-9]+[,.]?[0-9]*)[[:space:]]*/month,[[:space:]]*incl'), ',', '.'), '')::numeric;
    end if;
    if new.deposit is null and lower(coalesce(new.title, '')) like '%no deposit%' then
      new.deposit := 0;
      new.enrichment_evidence := jsonb_set(coalesce(new.enrichment_evidence, '{}'::jsonb), '{deposit}', jsonb_build_object('value', 0, 'source', 'pre_delivery:title_no_deposit', 'confidence', 0.99), true);
    end if;
  elsif new.source_id = 12 and v_rooms is null then
    v_rooms := nullif(replace(substring(coalesce(new.title, '') from ' ([0-9]+[,.]?[0-9]*) [0-9]+[,.]?[0-9]*m² Monatsrate'), ',', '.'), '')::numeric;
  elsif new.source_id = 15 and v_rooms is null then
    v_rooms := nullif(replace(substring(coalesce(new.title, '') from 'Zimmer ([0-9]+[,.]?[0-9]*) Etage'), ',', '.'), '')::numeric;
  elsif new.source_id = 6 and v_rooms is null then
    v_rooms := nullif(replace(coalesce(
      substring(coalesce(new.title, '') from '([0-9]+[,.]?[0-9]*)[ -]+Zimmer'),
      substring(coalesce(new.title, '') from '^([0-9]+[,.]?[0-9]*)[^0-9]{0,15}Zi')
    ), ',', '.'), '')::numeric;
  end if;

  if v_rooms is not null and v_rooms between 0.5 and 50 then
    new.rooms := v_rooms;
    new.enrichment_evidence := jsonb_set(coalesce(new.enrichment_evidence, '{}'::jsonb), '{rooms}', jsonb_build_object('value', v_rooms, 'source', 'pre_delivery:source_specific', 'confidence', 0.99), true);
    new.field_conflicts := coalesce(new.field_conflicts, '{}'::jsonb) - 'rooms';
  end if;

  if v_cold is not null and v_cold between 1 and 100000 and new.cold_rent is null then new.cold_rent := v_cold; end if;
  if v_warm is not null and v_warm between 1 and 100000 and new.warm_rent is null then new.warm_rent := v_warm; end if;

  return new;
end;
$$;

drop trigger if exists listings_normalize_explicit_facts on public.listings;
create trigger listings_normalize_explicit_facts
before insert or update of title, rooms, address, enrichment_evidence
on public.listings
for each row execute function app_private.normalize_explicit_listing_facts();

drop trigger if exists listings_source_specific_repair on public.listings;
create trigger listings_source_specific_repair
before update of enrichment_status, enrichment_evidence
on public.listings
for each row
when (new.enrichment_status = 'done')
execute function app_private.apply_source_specific_field_repairs();

-- Re-run the final normalization on current rows and rebuild active dedupe grouping.
update public.listings set title = title where is_active = true;

update public.listings
set dedupe_group_id = null,
    duplicate_of_listing_id = null,
    is_primary_listing = true,
    dedupe_match_reason = null
where is_active = true;

delete from public.listing_dedupe_groups g
where not exists (select 1 from public.listings l where l.dedupe_group_id = g.id);

do $$
declare r record;
begin
  for r in
    select id
    from public.listings
    where is_active = true
      and quality_status <> 'rejected'
      and enrichment_delivery_eligible = true
    order by first_seen_at, id
  loop
    perform app_private.reconcile_listing_duplicates(r.id);
  end loop;
end;
$$;
