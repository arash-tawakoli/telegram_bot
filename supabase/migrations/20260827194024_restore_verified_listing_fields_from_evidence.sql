-- Kleinanzeigen: explicit labeled values from each listing detail page.
update public.listings
set cold_rent=(enrichment_evidence->'cold_rent'->>'value')::numeric
where source_id=2 and cold_rent is null
  and enrichment_evidence->'cold_rent'->>'source'='detail:text'
  and (enrichment_evidence->'cold_rent'->>'confidence')::numeric>=0.8
  and (enrichment_evidence->'cold_rent'->>'value')::numeric between 1 and 100000;

update public.listings
set warm_rent=(enrichment_evidence->'warm_rent'->>'value')::numeric
where source_id=2 and warm_rent is null
  and enrichment_evidence->'warm_rent'->>'source'='detail:text'
  and (enrichment_evidence->'warm_rent'->>'confidence')::numeric>=0.8
  and (enrichment_evidence->'warm_rent'->>'value')::numeric between 1 and 100000;

-- HousingAnywhere: structured JSON-LD numberOfRooms.
update public.listings
set rooms=(enrichment_evidence->'rooms'->>'value')::numeric,
    field_conflicts=coalesce(field_conflicts,'{}'::jsonb)-'rooms'
where source_id=9 and rooms is null
  and enrichment_evidence->'rooms'->>'source' like 'raw:jsonld.%'
  and (enrichment_evidence->'rooms'->>'confidence')::numeric>=0.95
  and (enrichment_evidence->'rooms'->>'value')::numeric between 0.5 and 50;

-- Ohne-Makler: its card title ends with "<rooms> <area>m² Monatsrate".
with x as (
  select id,
    replace(substring(title from ' ([0-9]+[,.]?[0-9]*) [0-9]+[,.]?[0-9]*m² Monatsrate'),',','.')::numeric as v
  from public.listings
  where source_id=12 and rooms is null
    and substring(title from ' ([0-9]+[,.]?[0-9]*) [0-9]+[,.]?[0-9]*m² Monatsrate') is not null
)
update public.listings l
set rooms=x.v,
    enrichment_evidence=jsonb_set(coalesce(l.enrichment_evidence,'{}'::jsonb),'{rooms}',jsonb_build_object('value',x.v,'source','audit:source12_card','confidence',0.99),true),
    field_conflicts=coalesce(l.field_conflicts,'{}'::jsonb)-'rooms'
from x where l.id=x.id and x.v between 0.5 and 50;

-- immobilien.de: its normalized card includes "Zimmer <n> Etage".
with x as (
  select id,replace(substring(title from 'Zimmer ([0-9]+[,.]?[0-9]*) Etage'),',','.')::numeric as v
  from public.listings
  where source_id=15 and rooms is null
    and substring(title from 'Zimmer ([0-9]+[,.]?[0-9]*) Etage') is not null
)
update public.listings l
set rooms=x.v,
    enrichment_evidence=jsonb_set(coalesce(l.enrichment_evidence,'{}'::jsonb),'{rooms}',jsonb_build_object('value',x.v,'source','audit:source15_card','confidence',0.99),true),
    field_conflicts=coalesce(l.field_conflicts,'{}'::jsonb)-'rooms'
from x where l.id=x.id and x.v between 0.5 and 50;

update public.listings
set warm_rent=(enrichment_evidence->'warm_rent'->>'value')::numeric
where source_id=15 and warm_rent is null
  and enrichment_evidence->'warm_rent'->>'source'='detail:text'
  and (enrichment_evidence->'warm_rent'->>'confidence')::numeric>=0.8
  and (enrichment_evidence->'warm_rent'->>'value')::numeric between 1 and 100000;

-- WG-Gesucht: only override room count when the listing title itself explicitly states it.
with x as (
  select id,
    replace(coalesce(
      substring(title from '([0-9]+[,.]?[0-9]*)[ -]+Zimmer'),
      substring(title from '^([0-9]+[,.]?[0-9]*)[^0-9]{0,15}Zi')
    ),',','.')::numeric as v
  from public.listings
  where source_id=6
    and coalesce(
      substring(title from '([0-9]+[,.]?[0-9]*)[ -]+Zimmer'),
      substring(title from '^([0-9]+[,.]?[0-9]*)[^0-9]{0,15}Zi')
    ) is not null
)
update public.listings l
set rooms=x.v,
    enrichment_evidence=jsonb_set(coalesce(l.enrichment_evidence,'{}'::jsonb),'{rooms}',jsonb_build_object('value',x.v,'source','audit:source6_title','confidence',0.99),true),
    field_conflicts=coalesce(l.field_conflicts,'{}'::jsonb)-'rooms'
from x where l.id=x.id and x.v between 0.5 and 50 and l.rooms is distinct from x.v;

select app_private.refresh_source_field_capabilities();
select app_private.refresh_source_field_audit_status();
