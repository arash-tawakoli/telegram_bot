-- Production migration mirror: listing source priority, cross-source dedupe and cost semantics.

alter table public.sources
  add column if not exists listing_priority integer not null default 100;

update public.sources
set listing_priority = case
  when id = 1 then 1
  when id = 2 then 2
  when id = 3 then 3
  when id = 16 then 4
  when source_type = 'Baugenossenschaft' then 5
  else 100
end;

alter table public.listings
  add column if not exists operating_costs numeric,
  add column if not exists warm_rent_is_calculated boolean not null default false,
  add column if not exists is_primary_listing boolean not null default true,
  add column if not exists duplicate_of_listing_id uuid references public.listings(id) on delete set null,
  add column if not exists dedupe_match_reason text;

create table if not exists public.listing_dedupe_groups (
  id uuid primary key default gen_random_uuid(),
  preferred_listing_id uuid references public.listings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.listing_dedupe_groups enable row level security;
revoke all on public.listing_dedupe_groups from anon, authenticated;
grant select, insert, update, delete on public.listing_dedupe_groups to service_role;

alter table public.listings
  add column if not exists dedupe_group_id uuid references public.listing_dedupe_groups(id) on delete set null;

create index if not exists listings_dedupe_group_idx on public.listings(dedupe_group_id);
create index if not exists listings_primary_active_idx on public.listings(is_primary_listing, is_active, last_seen_at desc);
create index if not exists listings_duplicate_of_idx on public.listings(duplicate_of_listing_id);
create index if not exists sources_listing_priority_idx on public.sources(listing_priority, id);

alter table public.source_field_capabilities
  add column if not exists operating_costs_count integer not null default 0,
  add column if not exists operating_costs_coverage numeric(7,4) not null default 0,
  add column if not exists operating_costs_hint_count integer not null default 0,
  add column if not exists operating_costs_conflict_count integer not null default 0;

create or replace function app_private.normalized_listing_address(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(coalesce(p, '')), '[^[:alnum:]äöüß]', '', 'g')
$$;

create or replace function app_private.listing_source_priority(p_source_id smallint)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce((select listing_priority from public.sources where id = p_source_id), 100)
$$;

create or replace function app_private.refresh_listing_dedupe_group(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner uuid;
begin
  if p_group_id is null then return null; end if;

  select l.id into v_winner
  from public.listings l
  join public.sources s on s.id = l.source_id
  where l.dedupe_group_id = p_group_id
    and l.is_active = true
    and l.quality_status <> 'rejected'
    and l.enrichment_delivery_eligible = true
  order by s.listing_priority asc,
    ((l.resolved_image_url is not null)::int
      + (l.address is not null)::int
      + (l.warm_rent is not null)::int
      + (l.cold_rent is not null)::int
      + (l.rooms is not null)::int
      + (l.area_sqm is not null)::int
      + (l.deposit is not null or l.deposit_text is not null)::int) desc,
    l.first_seen_at asc,
    l.id
  limit 1;

  if v_winner is null then
    update public.listings
    set is_primary_listing = false, duplicate_of_listing_id = null
    where dedupe_group_id = p_group_id;
  else
    update public.listings
    set is_primary_listing = (id = v_winner),
        duplicate_of_listing_id = case when id = v_winner then null else v_winner end
    where dedupe_group_id = p_group_id;
  end if;

  update public.listing_dedupe_groups
  set preferred_listing_id = v_winner, updated_at = now()
  where id = p_group_id;

  return v_winner;
end;
$$;

create or replace function app_private.reconcile_listing_duplicates(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.listings%rowtype;
  v_group uuid;
  v_winner uuid;
  v_reason text := 'singleton';
  v_merge record;
begin
  select * into c from public.listings where id = p_listing_id for update;
  if not found or c.quality_status = 'rejected' or not c.enrichment_delivery_eligible then return null; end if;

  select z.group_id, z.reason into v_group, v_reason
  from (
    select l.dedupe_group_id as group_id,
      case
        when c.cross_source_hash is not null and l.cross_source_hash = c.cross_source_hash then 'cross_source_hash'
        when length(app_private.normalized_listing_address(c.address)) >= 6
          and app_private.normalized_listing_address(c.address) = app_private.normalized_listing_address(l.address) then 'exact_address'
        else 'property_signature'
      end as reason,
      coalesce(dg.created_at, now()) as group_created
    from public.listings l
    left join public.listing_dedupe_groups dg on dg.id = l.dedupe_group_id
    where l.id <> c.id
      and l.is_active = true
      and l.quality_status <> 'rejected'
      and l.enrichment_delivery_eligible = true
      and (
        (c.cross_source_hash is not null and l.cross_source_hash = c.cross_source_hash)
        or (
          length(app_private.normalized_listing_address(c.address)) >= 6
          and app_private.normalized_listing_address(c.address) = app_private.normalized_listing_address(l.address)
          and (c.rooms is null or l.rooms is null or abs(c.rooms - l.rooms) <= 0.5)
          and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm - l.area_sqm) <= 3)
        )
        or (
          c.postal_code is not null and c.postal_code = l.postal_code
          and c.rooms is not null and l.rooms is not null and abs(c.rooms - l.rooms) <= 0.25
          and c.area_sqm is not null and l.area_sqm is not null and abs(c.area_sqm - l.area_sqm) <= 2
          and (
            coalesce(c.warm_rent, c.cold_rent) is null
            or coalesce(l.warm_rent, l.cold_rent) is null
            or abs(coalesce(c.warm_rent, c.cold_rent) - coalesce(l.warm_rent, l.cold_rent))
              <= greatest(25, least(coalesce(c.warm_rent, c.cold_rent), coalesce(l.warm_rent, l.cold_rent)) * 0.05)
          )
          and extensions.similarity(
            lower(regexp_replace(coalesce(c.title, ''), '[^[:alnum:]äöüß ]', '', 'g')),
            lower(regexp_replace(coalesce(l.title, ''), '[^[:alnum:]äöüß ]', '', 'g'))
          ) >= case when c.source_id in (1,2,3,16) or l.source_id in (1,2,3,16) then 0.48 else 0.58 end
        )
      )
  ) z
  where z.group_id is not null
  order by z.group_created
  limit 1;

  if v_group is null and c.dedupe_group_id is not null then v_group := c.dedupe_group_id; end if;
  if v_group is null then insert into public.listing_dedupe_groups default values returning id into v_group; end if;

  for v_merge in
    select distinct l.dedupe_group_id as id
    from public.listings l
    where l.id <> c.id
      and l.dedupe_group_id is not null
      and l.dedupe_group_id <> v_group
      and l.is_active = true
      and l.quality_status <> 'rejected'
      and (
        (c.cross_source_hash is not null and l.cross_source_hash = c.cross_source_hash)
        or (
          length(app_private.normalized_listing_address(c.address)) >= 6
          and app_private.normalized_listing_address(c.address) = app_private.normalized_listing_address(l.address)
          and (c.rooms is null or l.rooms is null or abs(c.rooms - l.rooms) <= 0.5)
          and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm - l.area_sqm) <= 3)
        )
        or (
          c.postal_code is not null and c.postal_code = l.postal_code
          and c.rooms is not null and l.rooms is not null and abs(c.rooms - l.rooms) <= 0.25
          and c.area_sqm is not null and l.area_sqm is not null and abs(c.area_sqm - l.area_sqm) <= 2
          and extensions.similarity(
            lower(regexp_replace(coalesce(c.title, ''), '[^[:alnum:]äöüß ]', '', 'g')),
            lower(regexp_replace(coalesce(l.title, ''), '[^[:alnum:]äöüß ]', '', 'g'))
          ) >= case when c.source_id in (1,2,3,16) or l.source_id in (1,2,3,16) then 0.48 else 0.58 end
        )
      )
  loop
    update public.listings set dedupe_group_id = v_group where dedupe_group_id = v_merge.id;
    delete from public.listing_dedupe_groups where id = v_merge.id;
  end loop;

  update public.listings
  set dedupe_group_id = v_group, dedupe_match_reason = v_reason
  where id = c.id;

  update public.listings l
  set dedupe_group_id = v_group,
      dedupe_match_reason = case
        when c.cross_source_hash is not null and l.cross_source_hash = c.cross_source_hash then 'cross_source_hash'
        when length(app_private.normalized_listing_address(c.address)) >= 6
          and app_private.normalized_listing_address(c.address) = app_private.normalized_listing_address(l.address) then 'exact_address'
        else 'property_signature'
      end
  where l.id <> c.id
    and l.dedupe_group_id is null
    and l.is_active = true
    and l.quality_status <> 'rejected'
    and l.enrichment_delivery_eligible = true
    and (
      (c.cross_source_hash is not null and l.cross_source_hash = c.cross_source_hash)
      or (
        length(app_private.normalized_listing_address(c.address)) >= 6
        and app_private.normalized_listing_address(c.address) = app_private.normalized_listing_address(l.address)
        and (c.rooms is null or l.rooms is null or abs(c.rooms - l.rooms) <= 0.5)
        and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm - l.area_sqm) <= 3)
      )
      or (
        c.postal_code is not null and c.postal_code = l.postal_code
        and c.rooms is not null and l.rooms is not null and abs(c.rooms - l.rooms) <= 0.25
        and c.area_sqm is not null and l.area_sqm is not null and abs(c.area_sqm - l.area_sqm) <= 2
        and (
          coalesce(c.warm_rent, c.cold_rent) is null
          or coalesce(l.warm_rent, l.cold_rent) is null
          or abs(coalesce(c.warm_rent, c.cold_rent) - coalesce(l.warm_rent, l.cold_rent))
            <= greatest(25, least(coalesce(c.warm_rent, c.cold_rent), coalesce(l.warm_rent, l.cold_rent)) * 0.05)
        )
        and extensions.similarity(
          lower(regexp_replace(coalesce(c.title, ''), '[^[:alnum:]äöüß ]', '', 'g')),
          lower(regexp_replace(coalesce(l.title, ''), '[^[:alnum:]äöüß ]', '', 'g'))
        ) >= case when c.source_id in (1,2,3,16) or l.source_id in (1,2,3,16) then 0.48 else 0.58 end
      )
    );

  v_winner := app_private.refresh_listing_dedupe_group(v_group);
  if v_winner is not null then
    update public.matches
    set status = 'suppressed', updated_at = now()
    where listing_id in (select id from public.listings where dedupe_group_id = v_group and id <> v_winner)
      and status = 'matched';

    update public.delivery_events
    set status = 'skipped', next_retry_at = null, error_message = 'Suppressed by higher-priority duplicate'
    where listing_id in (select id from public.listings where dedupe_group_id = v_group and id <> v_winner)
      and status in ('pending','failed');
  end if;

  return v_group;
end;
$$;

revoke all on function app_private.reconcile_listing_duplicates(uuid) from public, anon, authenticated;
grant execute on function app_private.reconcile_listing_duplicates(uuid) to service_role;

create or replace function app_private.preserve_enriched_listing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cold_rent is null and old.cold_rent is not null then new.cold_rent := old.cold_rent; end if;
  if new.warm_rent is null and old.warm_rent is not null and not (new.source_id = 16 and (old.enrichment_evidence->'additional_costs'->>'source' = 'detail:text' or old.enrichment_evidence->'heating_costs'->>'source' = 'detail:text')) then new.warm_rent := old.warm_rent; new.warm_rent_is_calculated := old.warm_rent_is_calculated; end if;
  if new.heating_costs is null and old.heating_costs is not null and not (new.source_id = 16 and old.enrichment_evidence->'heating_costs'->>'source' = 'detail:text') then new.heating_costs := old.heating_costs; end if;
  if new.additional_costs is null and old.additional_costs is not null and not (new.source_id = 16 and old.enrichment_evidence->'additional_costs'->>'source' = 'detail:text') then new.additional_costs := old.additional_costs; end if;
  if new.operating_costs is null and old.operating_costs is not null then new.operating_costs := old.operating_costs; end if;
  if new.deposit is null and old.deposit is not null then new.deposit := old.deposit; end if;
  if nullif(new.deposit_text, '') is null and nullif(old.deposit_text, '') is not null then new.deposit_text := old.deposit_text; end if;
  if new.area_sqm is null and old.area_sqm is not null then new.area_sqm := old.area_sqm; end if;
  if new.rooms is null and old.rooms is not null then new.rooms := old.rooms; end if;
  if nullif(new.image_url, '') is null and nullif(old.image_url, '') is not null then new.image_url := old.image_url; end if;
  if nullif(new.resolved_image_url, '') is null and nullif(old.resolved_image_url, '') is not null then new.resolved_image_url := old.resolved_image_url; end if;
  return new;
end;
$$;

drop trigger if exists listings_preserve_enriched_fields on public.listings;
create trigger listings_preserve_enriched_fields
before update of cold_rent, warm_rent, heating_costs, additional_costs, operating_costs, deposit, deposit_text, area_sqm, rooms, image_url, resolved_image_url
on public.listings for each row execute function app_private.preserve_enriched_listing_fields();

create or replace function app_private.enrich_listing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  txt text := coalesce(new.raw::text, '');
  m text[];
  room_candidate numeric;
begin
  if new.source_id = 1 and new.cold_rent is null and new.warm_rent is null and new.raw->>'parser' = 'immoscout24_official_chatgpt_mcp' then
    begin new.cold_rent := nullif(new.raw#>>'{entry,price,value}', '')::numeric; exception when others then null; end;
  end if;

  if new.source_id in (6,10) and new.warm_rent is null and new.cold_rent is not null then
    new.warm_rent := new.cold_rent;
    new.cold_rent := null;
    new.warm_rent_is_calculated := false;
  end if;

  if new.warm_rent is null then m := regexp_match(txt, '(?i)(?:Warmmiete|Gesamtmiete|Miete warm)[^0-9]{0,40}([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.warm_rent := app_private.parse_eur(m[1]); new.warm_rent_is_calculated := false; end if; end if;
  if new.cold_rent is null then m := regexp_match(txt, '(?i)(?:Nettokaltmiete|Kaltmiete|Grundmiete|Nettomiete|(?:^|Kosten[^A-Za-z]{0,20})Miete\s*:)[^0-9]{0,40}([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.cold_rent := app_private.parse_eur(m[1]); end if; end if;
  if new.heating_costs is null then m := regexp_match(txt, '(?i)(?:Heizkosten|Heizungskosten)[^0-9]{0,40}([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.heating_costs := app_private.parse_eur(m[1]); end if; end if;
  if new.additional_costs is null then m := regexp_match(txt, '(?i)(?:Nebenkosten|sonstige Kosten)[^0-9]{0,40}([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.additional_costs := app_private.parse_eur(m[1]); end if; end if;
  if new.operating_costs is null then m := regexp_match(txt, '(?i)(?:Betriebskosten|Betriebskostenvorauszahlung)[^0-9]{0,40}([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.operating_costs := app_private.parse_eur(m[1]); end if; end if;
  if new.deposit is null then m := regexp_match(txt, '(?i)(?:Kaution|Mietkaution|Mietsicherheit)[^0-9]{0,50}([0-9]{1,3}(?:\\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.deposit := app_private.parse_eur(m[1]); end if; end if;

  if new.rooms is null and new.source_id = 6 then
    m := regexp_match(coalesce(new.raw->>'text', ''), '(?i)([0-9]+(?:[.,][0-9]+)?)\s*[-– ]?\s*Zimmer(?:-Wohnung)?');
    if m is not null then room_candidate := replace(m[1], ',', '.')::numeric; if room_candidate between 0.5 and 20 then new.rooms := room_candidate; end if; end if;
  end if;

  if new.warm_rent is null and new.cold_rent is not null and (new.additional_costs is not null or new.operating_costs is not null or new.heating_costs is not null) then
    new.warm_rent := new.cold_rent + coalesce(new.additional_costs, new.operating_costs, 0) + coalesce(new.heating_costs, 0);
    new.warm_rent_is_calculated := true;
  elsif new.warm_rent is not null and not coalesce(new.warm_rent_is_calculated, false) then
    new.warm_rent_is_calculated := false;
  end if;

  if new.warm_rent is not null and new.cold_rent is not null and new.warm_rent < new.cold_rent then
    new.warm_rent := null;
    new.warm_rent_is_calculated := false;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_enrich_fields on public.listings;
create trigger listings_enrich_fields
before insert or update of raw, warm_rent, cold_rent, heating_costs, additional_costs, operating_costs, deposit, deposit_text
on public.listings for each row execute function app_private.enrich_listing_fields();

create or replace function app_private.queue_new_listing_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_canonical uuid;
  v_group uuid;
  v_primary boolean;
begin
  if not coalesce(new.enrichment_delivery_eligible, false) or coalesce(new.enrichment_status, 'pending') <> 'done' then return new; end if;
  if not exists(select 1 from public.sources s where s.id = new.source_id and s.enabled = true and s.last_success_at is not null and s.delivery_mode = 'live') then return new; end if;

  v_group := app_private.reconcile_listing_duplicates(new.id);
  select is_primary_listing into v_primary from public.listings where id = new.id;
  if not coalesce(v_primary, false) then return new; end if;

  v_canonical := app_private.upsert_listing_architecture(new.id);

  insert into public.matches(profile_id, recipient_user_id, canonical_listing_id, listing_id, dedupe_key, status, match_snapshot)
  select p.id, p.user_id, v_canonical, new.id, 'group:' || v_group::text, 'matched',
    jsonb_build_object('max_warm_rent', p.max_warm_rent, 'min_rooms', p.min_rooms, 'min_area_sqm', p.min_area_sqm, 'location_mode', p.location_mode)
  from public.search_profiles p
  join public.bot_users u on u.id = p.user_id
  where p.is_active = true and u.is_active = true
    and (coalesce(cardinality(p.property_types), 0) = 0 or coalesce(new.property_type, 'Wohnung') = any(p.property_types))
    and (p.max_warm_rent is null or coalesce(new.warm_rent, new.cold_rent) is null or coalesce(new.warm_rent, new.cold_rent) <= p.max_warm_rent)
    and (coalesce(p.min_rooms, 0) <= 0 or new.rooms is null or new.rooms >= p.min_rooms)
    and (coalesce(p.min_area_sqm, 0) <= 0 or new.area_sqm is null or new.area_sqm >= p.min_area_sqm)
    and (not p.wbs_only or coalesce(new.wbs_required, false))
    and (coalesce(p.furnished_preference, 'any') = 'any' or new.furnished is null or (p.furnished_preference in ('yes','furnished') and new.furnished = true) or (p.furnished_preference in ('no','unfurnished') and new.furnished = false))
    and (
      p.location_mode = 'all_hamburg'
      or (p.location_mode = 'neighborhoods' and exists(select 1 from unnest(p.neighborhoods) n where lower(concat_ws(' ', new.district, new.address, new.title)) like '%' || lower(n) || '%'))
      or (p.location_mode = 'boroughs' and exists(select 1 from public.hamburg_neighborhoods hn join public.hamburg_boroughs hb on hb.id = hn.borough_id where hb.name = any(p.boroughs) and lower(concat_ws(' ', new.district, new.address, new.title)) like '%' || lower(hn.name) || '%'))
      or (coalesce(cardinality(p.districts), 0) > 0 and ('Ganz Hamburg' = any(p.districts) or exists(select 1 from unnest(p.districts) d where lower(concat_ws(' ', new.district, new.address, new.title)) like '%' || lower(d) || '%')))
    )
  on conflict(profile_id, canonical_listing_id) do update
    set listing_id = excluded.listing_id,
        dedupe_key = excluded.dedupe_key,
        status = 'matched',
        match_snapshot = excluded.match_snapshot,
        updated_at = now();

  insert into public.notification_outbox(match_id, recipient_user_id, profile_id, canonical_listing_id, listing_id, dedupe_key, status)
  select distinct on(m.recipient_user_id)
    m.id, m.recipient_user_id, m.profile_id, m.canonical_listing_id, m.listing_id, 'group:' || v_group::text, 'pending'
  from public.matches m
  join public.search_profiles p on p.id = m.profile_id
  where m.listing_id = new.id and m.status = 'matched' and p.is_active = true
    and not exists(
      select 1
      from public.delivery_events de
      join public.listings dl on dl.id = de.listing_id
      where de.recipient_user_id = m.recipient_user_id
        and dl.dedupe_group_id = v_group
        and de.status <> 'skipped'
    )
  order by m.recipient_user_id, p.updated_at desc, p.created_at desc
  on conflict(recipient_user_id, dedupe_key) do nothing;

  return new;
end;
$$;

-- Discard known-unreliable whole-page cost evidence from the legacy immobilie1 parser.
update public.listings
set warm_rent = null,
    additional_costs = null,
    heating_costs = null,
    operating_costs = null,
    warm_rent_is_calculated = false,
    enrichment_status = 'pending',
    enrichment_checked_at = null,
    enrichment_error = null,
    enrichment_evidence = coalesce(enrichment_evidence, '{}'::jsonb) - 'warm_rent' - 'additional_costs' - 'heating_costs' - 'operating_costs'
where source_id = 16
  and (enrichment_evidence->'additional_costs'->>'source' = 'detail:text' or enrichment_evidence->'heating_costs'->>'source' = 'detail:text');
