-- Restore five-minute polling for every live source, retaining failure backoff.
drop index if exists public.listings_quiet_source_last_new_idx;
CREATE OR REPLACE FUNCTION app_private.enqueue_due_source_jobs(p_limit integer DEFAULT 65)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r record;
  v_msg_id bigint;
  v_job_id uuid;
  v_count integer := 0;
begin
  for r in
    select s.id
    from public.sources s
    where s.enabled = true
      and s.runtime_mode = 'live'
      and s.delivery_mode = 'live'
      and not exists (
        select 1
        from public.source_jobs j
        where j.source_id = s.id
          and j.status in ('enqueued','processing','retry')
          and j.queue_msg_id is not null
      )
      and (
        s.last_checked_at is null
        or s.last_checked_at <= now() - make_interval(
          mins => least(
            60,
            greatest(1, s.poll_interval_minutes) *
            case
              when coalesce(s.consecutive_failures,0) <= 1 then 1
              when s.consecutive_failures = 2 then 2
              when s.consecutive_failures = 3 then 4
              when s.consecutive_failures = 4 then 8
              else 12
            end
          )
        )
      )
    order by
      coalesce(s.crawl_priority,2147483647),
      coalesce(s.last_checked_at,'-infinity'::timestamptz),
      s.id
    limit greatest(1,least(coalesce(p_limit,65),65))
    for update of s skip locked
  loop
    v_job_id := gen_random_uuid();

    select x into v_msg_id
    from pgmq.send(
      'source_jobs',
      jsonb_build_object(
        'job_id',v_job_id,
        'source_id',r.id,
        'worker','source-worker'
      )
    ) as x
    limit 1;

    insert into public.source_jobs(
      id,queue_msg_id,source_id,status,worker,enqueued_at,updated_at
    )
    values(
      v_job_id,v_msg_id,r.id,'enqueued','source-worker',now(),now()
    );

    update public.sources
    set last_checked_at=now(),updated_at=now()
    where id=r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- A proved publication timestamp can promote an ImmoScout coverage candidate.
CREATE OR REPLACE FUNCTION app_private.delivery_newness_qualified_legacy(p_listing_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v record;
  v_label text;
  v_local timestamp;
  v_match text[];
  v_day date;
  v_pub timestamptz;
begin
  select
    l.source_id,
    l.first_seen_at,
    l.fresh_delivery_eligible,
    l.raw,
    l.enrichment_evidence,
    s.baseline_completed_at
  into v
  from public.listings l
  join public.sources s on s.id=l.source_id
  where l.id=p_listing_id;

  if not found then return false; end if;

  if v.baseline_completed_at is null
     or v.first_seen_at is null
     or v.first_seen_at < p_as_of - interval '24 hours'
     or v.first_seen_at > p_as_of + interval '5 minutes'
  then
    return false;
  end if;

  if v.source_id=2 then
    if coalesce(v.raw->>'lane','') <> 'fast'
       or not coalesce(v.fresh_delivery_eligible,false)
    then
      return false;
    end if;

    v_label := btrim(coalesce(v.raw->>'sorting_date',''));
    v_local := p_as_of at time zone 'Europe/Berlin';

    v_match := regexp_match(v_label,'^Heute,[[:space:]]*([0-9]{1,2}):([0-9]{2})$','i');
    if v_match is not null then
      v_day := v_local::date;
    else
      v_match := regexp_match(v_label,'^Gestern,[[:space:]]*([0-9]{1,2}):([0-9]{2})$','i');
      if v_match is null then return false; end if;
      v_day := v_local::date - 1;
    end if;

    begin
      v_pub := make_timestamptz(
        extract(year from v_day)::int,
        extract(month from v_day)::int,
        extract(day from v_day)::int,
        v_match[1]::int,
        v_match[2]::int,
        0,
        'Europe/Berlin'
      );
    exception when others then
      return false;
    end;

    return v_pub >= p_as_of - interval '24 hours'
       and v_pub <= p_as_of + interval '5 minutes';
  end if;

  if v.source_id=1 then
    if not coalesce(v.fresh_delivery_eligible,false) then return false; end if;
    if coalesce(v.raw->>'delivery_lane','') in ('fresh_global','fresh_borough') then
      return true;
    end if;
    if v.raw->>'delivery_lane' <> 'coverage_proven'
       or v.raw#>>'{_newness,method}' <> 'source_timestamp'
       or coalesce(v.raw#>>'{_newness,source_published_at}','')
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}' then
      return false;
    end if;
    begin
      v_pub := (v.raw#>>'{_newness,source_published_at}')::timestamptz;
    exception when others then
      return false;
    end;
    return v_pub >= p_as_of - interval '24 hours'
       and v_pub <= p_as_of + interval '5 minutes';
  end if;

  if not coalesce(v.fresh_delivery_eligible,false) then
    return false;
  end if;

  v_label := nullif(btrim(coalesce(v.enrichment_evidence#>>'{preview,facts,published_text}','')),'');
  if v_label is not null then
    if v_label ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        return to_date(v_label,'YYYY-MM-DD') = (p_as_of at time zone 'Europe/Berlin')::date;
      exception when others then
        return false;
      end;
    elsif v_label ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$' then
      begin
        return to_date(v_label,'DD.MM.YYYY') = (p_as_of at time zone 'Europe/Berlin')::date;
      exception when others then
        return false;
      end;
    elsif v_label ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      begin
        v_pub := v_label::timestamptz;
        return v_pub >= p_as_of - interval '24 hours'
           and v_pub <= p_as_of + interval '5 minutes';
      exception when others then
        return false;
      end;
    end if;
  end if;

  return true;
end;
$function$;

-- Keep recent observations for fresh portal listings available to the dispatcher.
CREATE OR REPLACE FUNCTION public.ingest_listing_batch_v3(p_source_id smallint, p_rows jsonb, p_presence_epoch timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  -- Unchanged observations do not take a write-producing row lock.

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
      and l.is_active = true
      and l.ingest_fingerprint = c.fingerprint
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
            or l.last_seen_at < (c.r).last_seen_at -
              case when p_source_id in (1,3)
                         and (c.r).fresh_delivery_eligible
                         and l.first_seen_at >= statement_timestamp() - interval '24 hours'
                   then interval '9 minutes'
                   else interval '30 minutes' end
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

-- Re-run the existing matching/dedupe logic after a meaningful listing change.
create trigger listings_rematch_on_material_change
after update of warm_rent, cold_rent, deposit, rooms, area_sqm, property_type,
                property_kind, offer_mode, district, address, postal_code,
                wbs_required, furnished, fresh_delivery_eligible, raw
on public.listings
for each row
when (
  old.warm_rent is distinct from new.warm_rent
  or old.cold_rent is distinct from new.cold_rent
  or old.deposit is distinct from new.deposit
  or old.rooms is distinct from new.rooms
  or old.area_sqm is distinct from new.area_sqm
  or old.property_type is distinct from new.property_type
  or old.property_kind is distinct from new.property_kind
  or old.offer_mode is distinct from new.offer_mode
  or old.district is distinct from new.district
  or old.address is distinct from new.address
  or old.postal_code is distinct from new.postal_code
  or old.wbs_required is distinct from new.wbs_required
  or old.furnished is distinct from new.furnished
  or (old.fresh_delivery_eligible is distinct from true and new.fresh_delivery_eligible is true)
  or old.raw->'_classification' is distinct from new.raw->'_classification'
  or old.raw->>'delivery_lane' is distinct from new.raw->>'delivery_lane'
  or old.raw->'_newness' is distinct from new.raw->'_newness'
)
execute function app_private.queue_listing_delivery_v3();
