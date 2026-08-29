create table if not exists public.source_scan_state (
  source_id smallint primary key references public.sources(id) on delete cascade,
  cycle_id uuid not null default gen_random_uuid(),
  status text not null default 'idle' check (status in ('idle','running','backoff','complete','incomplete','error')),
  cycle_started_at timestamptz, cycle_finished_at timestamptz, frontier_checked_at timestamptz,
  cursor jsonb not null default '{}'::jsonb, expected_count integer, seen_count integer not null default 0,
  new_count integer not null default 0, changed_count integer not null default 0, requests_count integer not null default 0,
  error_count integer not null default 0, consecutive_errors integer not null default 0, backoff_until timestamptz,
  last_error text, metadata jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
alter table public.source_scan_state enable row level security;
revoke all on public.source_scan_state from anon, authenticated; grant all on public.source_scan_state to service_role;
create table if not exists public.source_scan_members (
 cycle_id uuid not null, source_id smallint not null references public.sources(id) on delete cascade,
 source_listing_key text not null, first_seen_at timestamptz not null default now(), primary key(cycle_id,source_id,source_listing_key)
);
create index if not exists source_scan_members_source_cycle_idx on public.source_scan_members(source_id,cycle_id);
alter table public.source_scan_members enable row level security;
revoke all on public.source_scan_members from anon,authenticated; grant all on public.source_scan_members to service_role;
update public.immoscout_inventory_runs set status='incomplete',finished_at=coalesce(finished_at,now()),metadata=metadata||jsonb_build_object('aborted_reason','superseded_by_rolling_inventory_scanner') where status='running' and started_at<now()-interval '30 minutes';
update public.immoscout_inventory_partitions p set status='error',last_error=coalesce(last_error,'superseded by rolling inventory scanner'),finished_at=coalesce(finished_at,now()),updated_at=now() where p.status in('queued','processing') and exists(select 1 from public.immoscout_inventory_runs r where r.id=p.run_id and r.status='incomplete' and r.metadata->>'aborted_reason'='superseded_by_rolling_inventory_scanner');
create or replace function public.claim_immoscout_inventory_partitions(p_run_id uuid,p_qty integer default 8)
returns table(id uuid,run_id uuid,parent_id uuid,partition_key text,location_kind text,location_name text,property_type text,min_price numeric,max_price numeric,min_rooms numeric,max_rooms numeric,depth integer,attempts integer)
language plpgsql security definer set search_path='' as $$begin return query with picked as(select p.id from public.immoscout_inventory_partitions p where p.run_id=p_run_id and p.status='queued' order by p.depth,p.created_at,p.id limit greatest(1,least(coalesce(p_qty,8),12)) for update skip locked),updated as(update public.immoscout_inventory_partitions p set status='processing',attempts=p.attempts+1,started_at=now(),updated_at=now(),last_error=null from picked x where p.id=x.id returning p.*) select u.id,u.run_id,u.parent_id,u.partition_key,u.location_kind,u.location_name,u.property_type,u.min_price,u.max_price,u.min_rooms,u.max_rooms,u.depth,u.attempts from updated u order by u.depth,u.created_at,u.id;end$$;
revoke all on function public.claim_immoscout_inventory_partitions(uuid,integer) from public,anon,authenticated; grant execute on function public.claim_immoscout_inventory_partitions(uuid,integer) to service_role;
create or replace function public.finalize_source_scan_cycle(p_source_id smallint,p_cycle_id uuid,p_expected integer default null) returns jsonb language plpgsql security definer set search_path='' as $$declare v_seen integer;v_prev integer;v_valid boolean;begin select count(*) into v_seen from public.source_scan_members where source_id=p_source_id and cycle_id=p_cycle_id;select seen_count into v_prev from public.source_scan_state where source_id=p_source_id;v_valid:=v_seen>0 and(p_expected is null or v_seen>=greatest(1,floor(p_expected*0.80)::integer));update public.source_scan_state set status=case when v_valid then 'complete' else 'incomplete' end,cycle_finished_at=now(),expected_count=p_expected,seen_count=v_seen,metadata=metadata||jsonb_build_object('snapshot_valid',v_valid,'previous_seen_count',v_prev),updated_at=now() where source_id=p_source_id and cycle_id=p_cycle_id;return jsonb_build_object('cycle_id',p_cycle_id,'seen',v_seen,'expected',p_expected,'snapshot_valid',v_valid);end$$;
revoke all on function public.finalize_source_scan_cycle(smallint,uuid,integer) from public,anon,authenticated; grant execute on function public.finalize_source_scan_cycle(smallint,uuid,integer) to service_role;
-- Keep the proven fast workers live until rolling full-cycle acceptance tests pass.
update public.sources set poll_interval_minutes=2,updated_at=now() where id=1;
update public.sources set poll_interval_minutes=5,updated_at=now() where id=2;
select cron.alter_job(job_id:=jobid,schedule:='* * * * *') from cron.job where jobid=10;
select cron.alter_job(job_id:=jobid,active:=false) from cron.job where jobid in(14,15,21);