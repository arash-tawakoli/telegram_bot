drop trigger if exists listings_apply_source_repairs on public.listings;

create or replace function app_private.apply_source_specific_field_repairs()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_rooms numeric;
  v_warm numeric;
  v_cold numeric;
begin
  if new.enrichment_status <> 'done' then return new; end if;

  if new.source_id=2 then
    if new.cold_rent is null and new.enrichment_evidence->'cold_rent'->>'source'='detail:text' then
      v_cold:=(new.enrichment_evidence->'cold_rent'->>'value')::numeric;
    end if;
    if new.warm_rent is null and new.enrichment_evidence->'warm_rent'->>'source'='detail:text' then
      v_warm:=(new.enrichment_evidence->'warm_rent'->>'value')::numeric;
    end if;
  end if;

  if new.source_id=9 then
    if new.enrichment_evidence->'rooms'->>'source' like 'raw:jsonld.%'
       and coalesce((new.enrichment_evidence->'rooms'->>'confidence')::numeric,0)>=0.95 then
      v_rooms:=(new.enrichment_evidence->'rooms'->>'value')::numeric;
    end if;
    if new.warm_rent is null then
      v_warm:=nullif(replace(substring(coalesce(new.title,'') from '€[[:space:]]*([0-9]+[,.]?[0-9]*)[[:space:]]*/month,[[:space:]]*incl'),',','.'),'')::numeric;
    end if;
    if new.deposit is null and lower(coalesce(new.title,'')) like '%no deposit%' then
      new.deposit:=0;
      new.enrichment_evidence:=jsonb_set(coalesce(new.enrichment_evidence,'{}'::jsonb),'{deposit}',jsonb_build_object('value',0,'source','pre_delivery:title_no_deposit','confidence',0.99),true);
    end if;
  end if;

  if new.source_id=12 then
    v_rooms:=nullif(replace(substring(coalesce(new.title,'') from ' ([0-9]+[,.]?[0-9]*) [0-9]+[,.]?[0-9]*m² Monatsrate'),',','.'),'')::numeric;
  end if;

  if new.source_id=15 then
    v_rooms:=nullif(replace(substring(coalesce(new.title,'') from 'Zimmer ([0-9]+[,.]?[0-9]*) Etage'),',','.'),'')::numeric;
    if new.warm_rent is null and new.enrichment_evidence->'warm_rent'->>'source'='detail:text' then
      v_warm:=(new.enrichment_evidence->'warm_rent'->>'value')::numeric;
    end if;
  end if;

  if new.source_id=6 then
    v_rooms:=nullif(replace(coalesce(
      substring(coalesce(new.title,'') from '([0-9]+[,.]?[0-9]*)[ -]+Zimmer'),
      substring(coalesce(new.title,'') from '^([0-9]+[,.]?[0-9]*)[^0-9]{0,15}Zi')
    ),',','.'),'')::numeric;
  end if;

  if v_rooms is not null and v_rooms between 0.5 and 50 then
    new.rooms:=v_rooms;
    new.enrichment_evidence:=jsonb_set(coalesce(new.enrichment_evidence,'{}'::jsonb),'{rooms}',jsonb_build_object('value',v_rooms,'source','pre_delivery:source_specific','confidence',0.99),true);
    new.field_conflicts:=coalesce(new.field_conflicts,'{}'::jsonb)-'rooms';
  end if;
  if v_cold is not null and v_cold between 1 and 100000 and new.cold_rent is null then new.cold_rent:=v_cold; end if;
  if v_warm is not null and v_warm between 1 and 100000 and new.warm_rent is null then new.warm_rent:=v_warm; end if;

  return new;
end;
$$;

create trigger listings_source_specific_repair
before update of enrichment_status,enrichment_evidence
on public.listings
for each row
when (new.enrichment_status='done')
execute function app_private.apply_source_specific_field_repairs();
