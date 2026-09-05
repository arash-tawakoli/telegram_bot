create or replace function app_private.require_enriched_delivery_event()
returns trigger language plpgsql set search_path='' as $$
declare l record;
begin
  select enrichment_delivery_eligible,enrichment_status,is_primary_listing,quality_status into l from public.listings where id=new.listing_id;
  if found and (
    coalesce(l.enrichment_delivery_eligible,false)=false
    or coalesce(l.enrichment_status,'pending')<>'done'
    or coalesce(l.is_primary_listing,false)=false
    or coalesce(l.quality_status,'unchecked')='rejected'
  ) then return null; end if;
  return new;
end;
$$;

create or replace function app_private.resolve_saved_listing_primary()
returns trigger language plpgsql set search_path='' as $$
declare v_primary uuid;
begin
  select coalesce(duplicate_of_listing_id,id) into v_primary from public.listings where id=new.listing_id;
  if v_primary is not null then new.listing_id:=v_primary; end if;
  return new;
end;
$$;
drop trigger if exists saved_listings_resolve_primary on public.saved_listings;
create trigger saved_listings_resolve_primary before insert or update of listing_id on public.saved_listings for each row execute function app_private.resolve_saved_listing_primary();

create or replace function app_private.refresh_operating_cost_capabilities()
returns integer language plpgsql set search_path='' as $$
declare v_count integer;
begin
  update public.source_field_capabilities c set
    operating_costs_count=x.cnt,
    operating_costs_coverage=x.coverage,
    operating_costs_hint_count=x.hints,
    operating_costs_conflict_count=x.conflicts,
    last_audited_at=now()
  from (
    select s.id source_id,
      count(l.id) filter(where l.operating_costs is not null)::int cnt,
      coalesce(round((count(l.id) filter(where l.operating_costs is not null))::numeric/nullif(count(l.id),0),4),0) coverage,
      count(l.id) filter(where l.operating_costs is null and l.raw::text ~* '(betriebskosten|operating.?cost)')::int hints,
      count(l.id) filter(where l.field_conflicts->'operating_costs' is not null)::int conflicts
    from public.sources s left join public.listings l on l.source_id=s.id and l.quality_status<>'rejected'
    group by s.id
  ) x where x.source_id=c.source_id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
revoke all on function app_private.refresh_operating_cost_capabilities() from public,anon,authenticated;
grant execute on function app_private.refresh_operating_cost_capabilities() to service_role;

select cron.unschedule(jobid) from cron.job where jobname='source-field-capability-refresh-every-15-minutes';
select cron.schedule('source-field-capability-refresh-every-15-minutes','*/15 * * * *',
  'select app_private.refresh_source_field_capabilities(); select app_private.refresh_operating_cost_capabilities(); select app_private.refresh_source_field_audit_status();');
