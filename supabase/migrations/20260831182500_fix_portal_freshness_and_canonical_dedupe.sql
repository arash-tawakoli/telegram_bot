create or replace function app_private.prepare_listing_fast_delivery()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_existing_eligible boolean;
  v_baseline_completed_at timestamptz;
begin
  new.enrichment_status := 'done';
  new.enrichment_delivery_eligible := true;
  new.enrichment_error := null;

  if new.source_id in (15, 16) then
    select l.fresh_delivery_eligible
      into v_existing_eligible
    from public.listings l
    where l.source_id = new.source_id
      and l.source_listing_key = new.source_listing_key
    limit 1;

    if found then
      new.fresh_delivery_eligible := coalesce(v_existing_eligible, false);
    else
      select s.baseline_completed_at
        into v_baseline_completed_at
      from public.sources s
      where s.id = new.source_id;

      if v_baseline_completed_at is not null then
        new.fresh_delivery_eligible := true;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

create or replace function app_private.assign_listing_dedupe(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c public.listings%rowtype;
  v_group uuid;
  v_winner uuid;
begin
  select * into c from public.listings where id=p_listing_id for update;
  if not found or c.quality_status='rejected' then return null; end if;

  select l.dedupe_group_id into v_group
  from public.listings l
  where l.id<>c.id
    and l.is_active=true
    and l.quality_status<>'rejected'
    and l.dedupe_group_id is not null
    and (
      (c.canonical_url is not null and l.canonical_url=c.canonical_url)
      or (c.cross_source_hash is not null and l.cross_source_hash=c.cross_source_hash)
      or (length(app_private.normalized_listing_address(c.address))>=6
          and app_private.normalized_listing_address(c.address)=app_private.normalized_listing_address(l.address)
          and (c.rooms is null or l.rooms is null or abs(c.rooms-l.rooms)<=0.5)
          and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm-l.area_sqm)<=3))
    )
  order by l.first_seen_at limit 1;

  if v_group is null then
    insert into public.listing_dedupe_groups default values returning id into v_group;
  end if;

  update public.listings set dedupe_group_id=v_group where id=c.id;

  select l.id into v_winner
  from public.listings l
  join public.sources s on s.id=l.source_id
  where l.dedupe_group_id=v_group
    and l.is_active=true
    and l.quality_status<>'rejected'
  order by s.listing_priority asc,l.last_seen_at desc,l.first_seen_at asc,l.id
  limit 1;

  update public.listings
  set is_primary_listing=(id=v_winner),
      duplicate_of_listing_id=case when id=v_winner then null else v_winner end,
      dedupe_match_reason=case when id=v_winner then 'primary' else 'duplicate' end
  where dedupe_group_id=v_group;

  update public.listing_dedupe_groups
  set preferred_listing_id=v_winner,updated_at=now()
  where id=v_group;

  return v_group;
end;
$function$;
