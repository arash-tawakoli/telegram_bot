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

  -- Kleinanzeigen: detail-page labeled rents.
  if new.source_id=2 then
    if new.cold_rent is null and new.enrichment_evidence->'cold_rent'->>'source'='detail:text' then
      v_cold:=(new.enrichment_evidence->'cold_rent'->>'value')::numeric;
    end if;
    if new.warm_rent is null and new.enrichment_evidence->'warm_rent'->>'source'='detail:text' then
      v_warm:=(new.enrichment_evidence->'warm_rent'->>'value')::numeric;
    end if;
  end if;

  -- HousingAnywhere: structured room count + explicit all-inclusive monthly rent from title.
  if new.source_id=9 then
    if new.enrichment_evidence->'rooms'->>'source' like 'raw:jsonld.%'
       and coalesce((new.enrichment_evidence->'rooms'->>'confidence')::numeric,0)>=0.95 then
      v_rooms:=(new.enrichment_evidence->'rooms'->>'value')::numeric;
    end if;
    if new.warm_rent is null then
      v_warm:=nullif(replace(substring(coalesce(new.title,'') from '€[[:space:]]*([0-9]+[,.]?[0-9]*)[[:space:]]*/month,[[:space:]]*incl'),',','.'),'')::numeric;
    end if;
  end if;

  -- Ohne-Makler: normalized card suffix is <rooms> <area>m² Monatsrate.
  if new.source_id=12 then
    v_rooms:=nullif(replace(substring(coalesce(new.title,'') from ' ([0-9]+[,.]?[0-9]*) [0-9]+[,.]?[0-9]*m² Monatsrate'),',','.'),'')::numeric;
  end if;

  -- immobilien.de: normalized card contains Zimmer <rooms> Etage.
  if new.source_id=15 then
    v_rooms:=nullif(replace(substring(coalesce(new.title,'') from 'Zimmer ([0-9]+[,.]?[0-9]*) Etage'),',','.'),'')::numeric;
    if new.warm_rent is null and new.enrichment_evidence->'warm_rent'->>'source'='detail:text' then
      v_warm:=(new.enrichment_evidence->'warm_rent'->>'value')::numeric;
    end if;
  end if;

  -- WG-Gesucht: only trust a room count explicitly stated by the listing title itself.
  if new.source_id=6 then
    v_rooms:=nullif(replace(coalesce(
      substring(coalesce(new.title,'') from '([0-9]+[,.]?[0-9]*)[ -]+Zimmer'),
      substring(coalesce(new.title,'') from '^([0-9]+[,.]?[0-9]*)[^0-9]{0,15}Zi')
    ),',','.'),'')::numeric;
  end if;

  if v_rooms is not null and v_rooms between 0.5 and 50 and new.rooms is distinct from v_rooms then
    update public.listings set
      rooms=v_rooms,
      enrichment_evidence=jsonb_set(coalesce(enrichment_evidence,'{}'::jsonb),'{rooms}',jsonb_build_object('value',v_rooms,'source','post_enrichment:source_specific','confidence',0.99),true),
      field_conflicts=coalesce(field_conflicts,'{}'::jsonb)-'rooms'
    where id=new.id;
  end if;

  if v_cold is not null and v_cold between 1 and 100000 and new.cold_rent is null then
    update public.listings set cold_rent=v_cold where id=new.id;
  end if;
  if v_warm is not null and v_warm between 1 and 100000 and new.warm_rent is null then
    update public.listings set warm_rent=v_warm where id=new.id;
  end if;

  if new.source_id=9 and new.deposit is null and lower(coalesce(new.title,'')) like '%no deposit%' then
    update public.listings set deposit=0,
      enrichment_evidence=jsonb_set(coalesce(enrichment_evidence,'{}'::jsonb),'{deposit}',jsonb_build_object('value',0,'source','post_enrichment:title_no_deposit','confidence',0.99),true)
    where id=new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists listings_apply_source_repairs on public.listings;
create trigger listings_apply_source_repairs
after update of enrichment_status on public.listings
for each row
when (new.enrichment_status='done' and old.enrichment_status is distinct from new.enrichment_status)
execute function app_private.apply_source_specific_field_repairs();

-- Existing HousingAnywhere rows: restore explicit all-inclusive price and "No deposit" semantics.
update public.listings
set warm_rent=nullif(replace(substring(coalesce(title,'') from '€[[:space:]]*([0-9]+[,.]?[0-9]*)[[:space:]]*/month,[[:space:]]*incl'),',','.'),'')::numeric
where source_id=9 and warm_rent is null
  and substring(coalesce(title,'') from '€[[:space:]]*([0-9]+[,.]?[0-9]*)[[:space:]]*/month,[[:space:]]*incl') is not null;

update public.listings
set deposit=0,
    enrichment_evidence=jsonb_set(coalesce(enrichment_evidence,'{}'::jsonb),'{deposit}',jsonb_build_object('value',0,'source','audit:title_no_deposit','confidence',0.99),true)
where source_id=9 and deposit is null and lower(coalesce(title,'')) like '%no deposit%';

select app_private.refresh_source_field_capabilities();
select app_private.refresh_source_field_audit_status();
