create table if not exists public.immoscout_inventory_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running','complete','unstable','incomplete','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  start_reported_total integer check (start_reported_total is null or start_reported_total >= 0),
  end_reported_total integer check (end_reported_total is null or end_reported_total >= 0),
  enumerated_unique integer not null default 0 check (enumerated_unique >= 0),
  enumerated_apartments integer not null default 0 check (enumerated_apartments >= 0),
  saturated_slices integer not null default 0 check (saturated_slices >= 0),
  failed_slices integer not null default 0 check (failed_slices >= 0),
  coverage_ratio numeric,
  crawl_complete boolean not null default false,
  snapshot_stable boolean not null default false,
  miss_processing_allowed boolean not null default false,
  catchup_of uuid references public.immoscout_inventory_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists immoscout_inventory_one_running_idx
  on public.immoscout_inventory_runs ((1)) where status='running';
create index if not exists immoscout_inventory_runs_started_idx
  on public.immoscout_inventory_runs (started_at desc);

create table if not exists public.immoscout_inventory_partitions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.immoscout_inventory_runs(id) on delete cascade,
  parent_id uuid references public.immoscout_inventory_partitions(id) on delete cascade,
  partition_key text not null,
  location_kind text not null check (location_kind in ('city','borough','neighborhood')),
  location_name text not null,
  property_type text not null check (property_type in ('Wohnung','Haus','WG','Tauschwohnung')),
  min_price numeric,
  max_price numeric,
  depth integer not null default 0 check (depth >= 0),
  status text not null default 'queued' check (status in ('queued','processing','done','split','saturated','error')),
  attempts integer not null default 0 check (attempts >= 0),
  result_count integer not null default 0 check (result_count >= 0),
  reported_total integer check (reported_total is null or reported_total >= 0),
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, partition_key),
  check (min_price is null or max_price is null or min_price <= max_price)
);

create index if not exists immoscout_inventory_partitions_claim_idx
  on public.immoscout_inventory_partitions (run_id,status,created_at);
create index if not exists immoscout_inventory_partitions_parent_idx
  on public.immoscout_inventory_partitions (parent_id) where parent_id is not null;

create table if not exists public.immoscout_inventory_members (
  run_id uuid not null references public.immoscout_inventory_runs(id) on delete cascade,
  external_id text not null,
  property_type text,
  first_seen_at timestamptz not null default now(),
  primary key (run_id,external_id)
);

create index if not exists immoscout_inventory_members_external_idx
  on public.immoscout_inventory_members (external_id);

alter table public.immoscout_inventory_runs enable row level security;
alter table public.immoscout_inventory_partitions enable row level security;
alter table public.immoscout_inventory_members enable row level security;

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
  if v_run is not null then return v_run; end if;

  insert into public.immoscout_inventory_runs(start_reported_total,catchup_of,metadata)
  values(p_start_total,p_catchup_of,jsonb_build_object('strategy','adaptive_geography_price_v1','result_cap',25))
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
    select id into v_run from public.immoscout_inventory_runs where status='running' order by started_at desc limit 1;
    return v_run;
end;
$$;

create or replace function public.claim_immoscout_inventory_partitions(
  p_run_id uuid,
  p_qty integer default 24
) returns table(
  id uuid,
  run_id uuid,
  parent_id uuid,
  partition_key text,
  location_kind text,
  location_name text,
  property_type text,
  min_price numeric,
  max_price numeric,
  depth integer,
  attempts integer
)
language plpgsql
security definer
set search_path=''
as $$
begin
  return query
  with picked as (
    select p.id
    from public.immoscout_inventory_partitions p
    where p.run_id=p_run_id and p.status='queued'
    order by p.depth,p.created_at,p.id
    limit greatest(1,least(coalesce(p_qty,24),48))
    for update skip locked
  ), updated as (
    update public.immoscout_inventory_partitions p
    set status='processing',attempts=p.attempts+1,started_at=now(),updated_at=now(),last_error=null
    from picked x
    where p.id=x.id
    returning p.*
  )
  select u.id,u.run_id,u.parent_id,u.partition_key,u.location_kind,u.location_name,u.property_type,u.min_price,u.max_price,u.depth,u.attempts
  from updated u
  order by u.depth,u.created_at,u.id;
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
  v_ratio numeric;
  v_complete boolean;
  v_stable boolean;
  v_missed integer:=0;
  v_deactivated integer:=0;
  r record;
begin
  select * into v_run from public.immoscout_inventory_runs where id=p_run_id for update;
  if not found then raise exception 'inventory run not found'; end if;

  select
    count(*) filter(where status='queued'),
    count(*) filter(where status='processing'),
    count(*) filter(where status='saturated'),
    count(*) filter(where status='error')
  into v_queued,v_processing,v_saturated,v_failed
  from public.immoscout_inventory_partitions where run_id=p_run_id;

  if v_queued>0 or v_processing>0 then
    return jsonb_build_object('finalized',false,'status','running','queued',v_queued,'processing',v_processing);
  end if;

  select count(*),count(*) filter(where property_type='Wohnung')
  into v_unique,v_apartments
  from public.immoscout_inventory_members where run_id=p_run_id;

  if greatest(coalesce(v_run.start_reported_total,0),coalesce(p_end_total,0))>0 then
    v_ratio:=least(1::numeric,v_apartments::numeric/greatest(coalesce(v_run.start_reported_total,0),coalesce(p_end_total,0))::numeric);
  else
    v_ratio:=null;
  end if;

  v_complete:=v_saturated=0 and v_failed=0 and v_unique>0;
  v_stable:=v_complete and v_run.start_reported_total is not null and p_end_total is not null and v_run.start_reported_total=p_end_total;

  update public.immoscout_inventory_runs
  set finished_at=now(),end_reported_total=p_end_total,enumerated_unique=v_unique,
      enumerated_apartments=v_apartments,saturated_slices=v_saturated,failed_slices=v_failed,
      coverage_ratio=v_ratio,crawl_complete=v_complete,snapshot_stable=v_stable,
      miss_processing_allowed=(v_complete and v_stable),
      status=case when not v_complete then 'incomplete' when not v_stable then 'unstable' else 'complete' end,
      metadata=metadata||jsonb_build_object('queued_slices',v_queued,'processing_slices',v_processing)
  where id=p_run_id;

  if v_complete and v_stable then
    update public.listing_occurrences o
    set miss_count=0,is_active=true,updated_at=now()
    where o.source_id=1
      and exists(select 1 from public.immoscout_inventory_members m where m.run_id=p_run_id and m.external_id=o.source_listing_key);

    with changed as (
      update public.listing_occurrences o
      set miss_count=o.miss_count+1,
          is_active=case when o.miss_count+1>=3 then false else o.is_active end,
          updated_at=now()
      where o.source_id=1 and o.is_active=true
        and not exists(select 1 from public.immoscout_inventory_members m where m.run_id=p_run_id and m.external_id=o.source_listing_key)
      returning canonical_listing_id,(not is_active) as deactivated
    )
    select count(*),count(*) filter(where deactivated) into v_missed,v_deactivated from changed;

    update public.listings l
    set is_active=o.is_active,last_seen_at=greatest(l.last_seen_at,o.last_seen_at)
    from public.listing_occurrences o
    where o.source_id=1 and o.legacy_listing_id=l.id and l.is_active is distinct from o.is_active;

    for r in select distinct canonical_listing_id from public.listing_occurrences where source_id=1 loop
      perform app_private.refresh_canonical_listing(r.canonical_listing_id);
    end loop;
  end if;

  return jsonb_build_object(
    'finalized',true,
    'status',case when not v_complete then 'incomplete' when not v_stable then 'unstable' else 'complete' end,
    'crawl_complete',v_complete,'snapshot_stable',v_stable,
    'start_reported_total',v_run.start_reported_total,'end_reported_total',p_end_total,
    'enumerated_unique',v_unique,'enumerated_apartments',v_apartments,
    'coverage_ratio',v_ratio,'saturated_slices',v_saturated,'failed_slices',v_failed,
    'missed_incremented',v_missed,'deactivated',v_deactivated
  );
end;
$$;

create or replace function public.prune_immoscout_inventory(p_keep_days integer default 7)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer;
begin
  with deleted as (
    delete from public.immoscout_inventory_runs
    where status<>'running' and finished_at < now()-make_interval(days=>greatest(1,least(coalesce(p_keep_days,7),30)))
    returning 1
  ) select count(*) into v_count from deleted;
  return v_count;
end;
$$;

revoke all on function public.start_immoscout_inventory(integer,uuid) from public,anon,authenticated;
revoke all on function public.claim_immoscout_inventory_partitions(uuid,integer) from public,anon,authenticated;
revoke all on function public.finalize_immoscout_inventory(uuid,integer) from public,anon,authenticated;
revoke all on function public.prune_immoscout_inventory(integer) from public,anon,authenticated;
grant execute on function public.start_immoscout_inventory(integer,uuid) to service_role;
grant execute on function public.claim_immoscout_inventory_partitions(uuid,integer) to service_role;
grant execute on function public.finalize_immoscout_inventory(uuid,integer) to service_role;
grant execute on function public.prune_immoscout_inventory(integer) to service_role;

create or replace function app_private.process_availability_runs(p_limit integer default 50)
returns integer
language plpgsql
set search_path=''
as $$
declare r record; c record; v_count integer:=0;
begin
  for r in
    select cr.id,cr.source_id,cr.started_at,cr.connector_priority
    from public.crawl_runs cr
    where cr.success=true and cr.availability_processed_at is null
      and cr.source_id<>1
      and cr.connector_priority is not null
      and exists (
        select 1 from public.source_connectors sc
        where sc.source_id=cr.source_id
          and sc.priority=cr.connector_priority
          and sc.enabled=true
          and sc.enumerable=true
          and sc.shadow_only=false
      )
    order by cr.started_at
    limit greatest(1,least(coalesce(p_limit,50),250))
    for update skip locked
  loop
    update public.listing_occurrences o
    set miss_count=o.miss_count+1,
        is_active=case when o.miss_count+1>=3 then false else o.is_active end,
        updated_at=now()
    where o.source_id=r.source_id
      and o.is_active=true
      and o.last_seen_at < r.started_at;

    for c in select distinct canonical_listing_id from public.listing_occurrences where source_id=r.source_id loop
      perform app_private.refresh_canonical_listing(c.canonical_listing_id);
    end loop;

    update public.crawl_runs set availability_processed_at=now() where id=r.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
