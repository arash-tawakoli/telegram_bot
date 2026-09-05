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

    for c in select distinct canonical_listing_id from public.listing_occurrences where source_id=r.source_id
    loop
      perform app_private.refresh_canonical_listing(c.canonical_listing_id);
    end loop;

    update public.crawl_runs set availability_processed_at=now() where id=r.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- Attach the evidence/connector actually used by a completed crawl to occurrences first seen in that crawl.
create or replace function app_private.reconcile_occurrence_evidence(p_limit integer default 100)
returns integer
language plpgsql
set search_path=''
as $$
declare r record; v_count integer:=0;
begin
  for r in
    select cr.id,cr.source_id,cr.started_at,cr.finished_at,cr.connector_priority,sc.id connector_id,sc.evidence_tier
    from public.crawl_runs cr
    join public.source_connectors sc on sc.source_id=cr.source_id and sc.priority=cr.connector_priority
    where cr.finished_at is not null
      and cr.connector_priority is not null
      and coalesce(cr.metadata->>'architecture_evidence_reconciled','false')<>'true'
    order by cr.started_at
    limit greatest(1,least(coalesce(p_limit,100),500))
    for update skip locked
  loop
    update public.listing_occurrences o
    set connector_id=r.connector_id,
        evidence_tier=r.evidence_tier,
        quality_rank=case
          when exists(select 1 from public.source_connectors x where x.id=r.connector_id and x.connector_kind='immomio_tenant') then 10
          when o.source_id in (1,2,3) then 20
          when r.evidence_tier='K1' then 30
          when r.evidence_tier='K2' then 50
          else 90 end,
        updated_at=now()
    where o.source_id=r.source_id
      and o.first_seen_at>=r.started_at
      and o.first_seen_at<=r.finished_at+interval '5 seconds';

    update public.crawl_runs
    set metadata=metadata||jsonb_build_object('architecture_evidence_reconciled',true)
    where id=r.id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

select cron.unschedule('occurrence-evidence-every-5-minutes') where exists (select 1 from cron.job where jobname='occurrence-evidence-every-5-minutes');
select cron.schedule('occurrence-evidence-every-5-minutes','*/5 * * * *',$$select app_private.reconcile_occurrence_evidence(250);$$);
