
create or replace function public.ingest_listing_batch_v3(
  p_source_id smallint,
  p_rows jsonb,
  p_presence_epoch timestamptz
)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  result jsonb;
  allowed_keys constant text[] := array[
    'source_id','source_listing_key','external_id','canonical_url','title','address',
    'district','postal_code','city','warm_rent','cold_rent','additional_costs',
    'operating_costs','heating_costs','deposit','deposit_text','rooms','area_sqm',
    'available_from','property_type','furnished','wbs_required','image_url',
    'cross_source_hash','raw','fresh_delivery_eligible','last_seen_at','is_active'
  ];
begin
  if p_source_id is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'source and listing array are required' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows) > 100 then
    raise exception 'listing batch exceeds 100 rows' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('seen',0,'fresh',0,'changed',0,'touched',0);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) x
    where jsonb_typeof(x) <> 'object'
       or (x->>'source_id')::smallint is distinct from p_source_id
       or coalesce(length(btrim(x->>'source_listing_key')),0) not between 1 and 500
       or coalesce(jsonb_typeof(x->'raw'),'null') <> 'object'
       or (x->>'last_seen_at')::timestamptz is null
       or (x->>'is_active')::boolean is distinct from true
       or exists (
         select 1 from jsonb_object_keys(x) k
         where not k = any(allowed_keys)
       )
  ) or (
    select count(*) <> count(distinct x->>'source_listing_key')
    from jsonb_array_elements(p_rows) x
  ) then
    raise exception 'invalid listing batch, source mismatch or duplicate key' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(913247, p_source_id::integer);

  perform 1
  from public.listings l
  where l.source_id = p_source_id
    and l.source_listing_key in (
      select x->>'source_listing_key' from jsonb_array_elements(p_rows) x
    )
  order by l.id
  for update;

  with input as materialized (
    select
      jsonb_populate_record(null::public.listings, x) as r,
      pg_catalog.sha256(
        pg_catalog.convert_to((x - 'last_seen_at')::text,'UTF8')
      ) as fingerprint
    from jsonb_array_elements(p_rows) x
  ),
  classified as materialized (
    select
      i.r,
      i.fingerprint,
      l.id,
      coalesce(l.ingest_fingerprint = i.fingerprint and l.is_active,false) as unchanged
    from input i
    left join public.listings l
      on l.source_id = p_source_id
     and l.source_listing_key = (i.r).source_listing_key
  ),
  touched as (
    update public.listings l
    set last_seen_at = greatest(l.last_seen_at,(c.r).last_seen_at)
    from classified c
    where c.unchanged
      and l.id = c.id
      and (
        (
          p_presence_epoch is not null
          and (l.last_seen_at is null or l.last_seen_at < p_presence_epoch)
        )
        or
        (
          p_presence_epoch is null
          and (
            l.last_seen_at is null
            or l.last_seen_at < (c.r).last_seen_at - interval '30 minutes'
          )
        )
      )
    returning l.id
  ),
  written as (
    insert into public.listings as l (
      source_id,source_listing_key,external_id,canonical_url,title,address,district,
      postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,
      heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,
      furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,
      last_seen_at,is_active,ingest_fingerprint
    )
    select
      (c.r).source_id,(c.r).source_listing_key,(c.r).external_id,(c.r).canonical_url,
      (c.r).title,(c.r).address,(c.r).district,(c.r).postal_code,(c.r).city,
      (c.r).warm_rent,(c.r).cold_rent,(c.r).additional_costs,(c.r).operating_costs,
      (c.r).heating_costs,(c.r).deposit,(c.r).deposit_text,(c.r).rooms,(c.r).area_sqm,
      (c.r).available_from,(c.r).property_type,(c.r).furnished,(c.r).wbs_required,
      (c.r).image_url,(c.r).cross_source_hash,(c.r).raw,(c.r).fresh_delivery_eligible,
      (c.r).last_seen_at,(c.r).is_active,c.fingerprint
    from classified c
    where not c.unchanged
    on conflict (source_id,source_listing_key) do update set
      external_id = excluded.external_id,
      canonical_url = excluded.canonical_url,
      title = excluded.title,
      address = excluded.address,
      district = excluded.district,
      postal_code = excluded.postal_code,
      city = excluded.city,
      warm_rent = excluded.warm_rent,
      cold_rent = excluded.cold_rent,
      additional_costs = excluded.additional_costs,
      operating_costs = excluded.operating_costs,
      heating_costs = excluded.heating_costs,
      deposit = excluded.deposit,
      deposit_text = excluded.deposit_text,
      rooms = excluded.rooms,
      area_sqm = excluded.area_sqm,
      available_from = excluded.available_from,
      property_type = excluded.property_type,
      furnished = excluded.furnished,
      wbs_required = excluded.wbs_required,
      image_url = excluded.image_url,
      cross_source_hash = excluded.cross_source_hash,
      raw = excluded.raw,
      fresh_delivery_eligible = excluded.fresh_delivery_eligible,
      last_seen_at = greatest(l.last_seen_at,excluded.last_seen_at),
      is_active = excluded.is_active,
      ingest_fingerprint = excluded.ingest_fingerprint
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'seen',(select count(*) from input),
    'fresh',(select count(*) from written where inserted),
    'changed',(select count(*) from written),
    'touched',(select count(*) from touched)
  )
  into result;

  return result;
end;
$function$;
