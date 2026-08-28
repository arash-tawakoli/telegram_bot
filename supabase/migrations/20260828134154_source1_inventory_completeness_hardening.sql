create or replace function public.start_immoscout_inventory(
  p_start_total integer default null,
  p_catchup_of uuid default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_run uuid;
begin
  select id into v_run
  from public.immoscout_inventory_runs
  where status='running'
  order by started_at desc
  limit 1;

  if v_run is not null then
    if p_start_total is not null then
      update public.immoscout_inventory_runs
      set start_reported_total=coalesce(start_reported_total,p_start_total),
          metadata=metadata||jsonb_build_object('latest_observed_total',p_start_total)
      where id=v_run;
    end if;
    return v_run;
  end if;

  insert into public.immoscout_inventory_runs(start_reported_total,catchup_of,metadata)
  values(
    p_start_total,
    p_catchup_of,
    jsonb_build_object(
      'strategy','adaptive_geography_price_v1',
      'result_cap',25,
      'latest_observed_total',p_start_total
    )
  )
  returning id into v_run;

  insert into public.immoscout_inventory_partitions(
    run_id,partition_key,location_kind,location_name,property_type,depth
  )
  select v_run,'wohnung:neighborhood:'||hn.id||':all','neighborhood',hn.name,'Wohnung',0
  from public.hamburg_neighborhoods hn
  order by hn.id;

  insert into public.immoscout_inventory_partitions(
    run_id,partition_key,location_kind,location_name,property_type,depth
  )
  select v_run,lower(pt.property_type)||':borough:'||hb.id||':all','borough',hb.name,pt.property_type,0
  from public.hamburg_boroughs hb
  cross join (values ('Haus'::text),('WG'::text),('Tauschwohnung'::text)) pt(property_type)
  order by hb.id,pt.property_type;

  return v_run;
exception
  when unique_violation then
    select id into v_run
    from public.immoscout_inventory_runs
    where status='running'
    order by started_at desc
    limit 1;
    if v_run is not null and p_start_total is not null then
      update public.immoscout_inventory_runs
      set start_reported_total=coalesce(start_reported_total,p_start_total),
          metadata=metadata||jsonb_build_object('latest_observed_total',p_start_total)
      where id=v_run;
    end if;
    return v_run;
end;
$$;

create or replace function public.finalize_immoscout_inventory(
  p_run_id uuid,
  p_end_total integer default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_run public.immoscout_inventory_runs%rowtype;
  v_queued integer;
  v_processing integer;
  v_saturated integer;
  v_failed integer;
  v_unique integer;
  v_apartments integer;
  v_expected integer;
  v_ratio numeric;
  v_complete boolean;
  v_stable boolean;
  v_status text;
  v_missed integer:=0;
  v_deactivated integer:=0;
  r record;
begin
  select * into v_run
  from public.immoscout_inventory_runs
  where id=p_run_id
  for update;
  if not found then raise exception 'inventory run not found'; end if;

  select
    count(*) filter(where status='queued'),
    count(*) filter(where status='processing'),
    count(*) filter(where status='saturated'),
    count(*) filter(where status='error')
  into v_queued,v_processing,v_saturated,v_failed
  from public.immoscout_inventory_partitions
  where run_id=p_run_id;

  if v_queued>0 or v_processing>0 then
    return jsonb_build_object(
      'finalized',false,
      'status','running',
      'queued',v_queued,
      'processing',v_processing
    );
  end if;

  select count(*),count(*) filter(where property_type='Wohnung')
  into v_unique,v_apartments
  from public.immoscout_inventory_members
  where run_id=p_run_id;

  v_expected:=greatest(coalesce(v_run.start_reported_total,0),coalesce(p_end_total,0));
  if v_expected>0 then
    v_ratio:=least(1::numeric,v_apartments::numeric/v_expected::numeric);
  else
    v_ratio:=null;
  end if;

  v_complete:=v_saturated=0
    and v_failed=0
    and v_unique>0
    and v_expected>0
    and v_apartments>=v_expected
    and v_run.start_reported_total is not null
    and p_end_total is not null;

  v_stable:=v_complete and v_run.start_reported_total=p_end_total;
  v_status:=case
    when not v_complete then 'incomplete'
    when not v_stable then 'unstable'
    else 'complete'
  end;

  update public.immoscout_inventory_runs
  set finished_at=now(),
      end_reported_total=p_end_total,
      enumerated_unique=v_unique,
      enumerated_apartments=v_apartments,
      saturated_slices=v_saturated,
      failed_slices=v_failed,
      coverage_ratio=v_ratio,
      crawl_complete=v_complete,
      snapshot_stable=v_stable,
      miss_processing_allowed=(v_complete and v_stable),
      status=v_status,
      metadata=metadata||jsonb_build_object(
        'queued_slices',v_queued,
        'processing_slices',v_processing,
        'expected_apartment_total',v_expected,
        'coverage_count_gate_passed',(v_expected>0 and v_apartments>=v_expected),
        'end_total_present',(p_end_total is not null)
      )
  where id=p_run_id;

  if v_complete and v_stable then
    update public.listing_occurrences o
    set miss_count=0,is_active=true,updated_at=now()
    where o.source_id=1
      and exists(
        select 1
        from public.immoscout_inventory_members m
        where m.run_id=p_run_id and m.external_id=o.source_listing_key
      );

    with changed as (
      update public.listing_occurrences o
      set miss_count=o.miss_count+1,
          is_active=case when o.miss_count+1>=3 then false else o.is_active end,
          updated_at=now()
      where o.source_id=1
        and o.is_active=true
        and not exists(
          select 1
          from public.immoscout_inventory_members m
          where m.run_id=p_run_id and m.external_id=o.source_listing_key
        )
      returning canonical_listing_id,(not is_active) as deactivated
    )
    select count(*),count(*) filter(where deactivated)
    into v_missed,v_deactivated
    from changed;

    update public.listings l
    set is_active=o.is_active,last_seen_at=greatest(l.last_seen_at,o.last_seen_at)
    from public.listing_occurrences o
    where o.source_id=1
      and o.legacy_listing_id=l.id
      and l.is_active is distinct from o.is_active;

    for r in
      select distinct canonical_listing_id
      from public.listing_occurrences
      where source_id=1
    loop
      perform app_private.refresh_canonical_listing(r.canonical_listing_id);
    end loop;
  end if;

  return jsonb_build_object(
    'finalized',true,
    'status',v_status,
    'crawl_complete',v_complete,
    'snapshot_stable',v_stable,
    'start_reported_total',v_run.start_reported_total,
    'end_reported_total',p_end_total,
    'expected_apartment_total',v_expected,
    'enumerated_unique',v_unique,
    'enumerated_apartments',v_apartments,
    'coverage_ratio',v_ratio,
    'saturated_slices',v_saturated,
    'failed_slices',v_failed,
    'missed_incremented',v_missed,
    'deactivated',v_deactivated
  );
end;
$$;

revoke all on function public.start_immoscout_inventory(integer,uuid) from public,anon,authenticated;
revoke all on function public.finalize_immoscout_inventory(uuid,integer) from public,anon,authenticated;
grant execute on function public.start_immoscout_inventory(integer,uuid) to service_role;
grant execute on function public.finalize_immoscout_inventory(uuid,integer) to service_role;
