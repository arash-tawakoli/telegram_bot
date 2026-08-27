create or replace function app_private.enrich_listing_fields()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  txt text := coalesce(new.raw::text,'');
  m text[];
begin
  if new.source_id=1 and new.cold_rent is null and new.warm_rent is null
     and new.raw->>'parser'='immoscout24_official_chatgpt_mcp' then
    begin new.cold_rent := nullif(new.raw#>>'{entry,price,value}','')::numeric; exception when others then null; end;
  end if;

  if new.source_id=6 and new.warm_rent is null and new.cold_rent is not null then
    new.warm_rent := new.cold_rent;
    new.cold_rent := null;
  end if;

  if new.source_id=10 and new.warm_rent is null and new.cold_rent is not null then
    new.warm_rent := new.cold_rent;
    new.cold_rent := null;
  end if;

  if new.warm_rent is null then
    m := regexp_match(txt,'(?i)(?:Warmmiete|Gesamtmiete|Miete warm)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.warm_rent := app_private.parse_eur(m[1]); end if;
  end if;
  if new.cold_rent is null then
    m := regexp_match(txt,'(?i)(?:Nettokaltmiete|Kaltmiete|Grundmiete|Nettomiete|(?:^|Kosten[^A-Za-z]{0,20})Miete\s*:)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.cold_rent := app_private.parse_eur(m[1]); end if;
  end if;
  if new.heating_costs is null then
    m := regexp_match(txt,'(?i)(?:Heizkosten|Heizungskosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.heating_costs := app_private.parse_eur(m[1]); end if;
  end if;
  if new.additional_costs is null then
    m := regexp_match(txt,'(?i)(?:Nebenkosten|Betriebskosten|sonstige Kosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.additional_costs := app_private.parse_eur(m[1]); end if;
  end if;
  if new.deposit is null then
    m := regexp_match(txt,'(?i)(?:Kaution|Mietkaution|Mietsicherheit)[^0-9]{0,50}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)');
    if m is not null then new.deposit := app_private.parse_eur(m[1]); end if;
  end if;
  if new.deposit_text is null and new.deposit is null then
    m := regexp_match(txt,'(?i)((?:Kaution|Mietkaution|Mietsicherheit)[^,;}]{0,100})');
    if m is not null then new.deposit_text := left(regexp_replace(m[1],'\s+',' ','g'),120); end if;
  end if;
  if new.warm_rent is null and new.cold_rent is not null and (new.heating_costs is not null or new.additional_costs is not null) then
    new.warm_rent := new.cold_rent + coalesce(new.heating_costs,0) + coalesce(new.additional_costs,0);
  end if;
  return new;
end;
$$;

create or replace function app_private.require_enriched_delivery_event()
returns trigger
language plpgsql
set search_path=''
as $$
declare l record;
begin
  select enrichment_delivery_eligible,enrichment_status into l from public.listings where id=new.listing_id;
  if found and coalesce(l.enrichment_delivery_eligible,false)=true and coalesce(l.enrichment_status,'pending')<>'done' then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_events_require_enriched_listing on public.delivery_events;
create trigger delivery_events_require_enriched_listing
before insert on public.delivery_events
for each row execute function app_private.require_enriched_delivery_event();

update public.listings
set cold_rent = nullif(raw#>>'{entry,price,value}','')::numeric,
    enrichment_evidence = enrichment_evidence || jsonb_build_object('cold_rent',jsonb_build_object('value',(raw#>>'{entry,price,value}')::numeric,'source','source_semantics:immoscout_search_card','confidence',0.99))
where source_id=1 and cold_rent is null and warm_rent is null
  and raw->>'parser'='immoscout24_official_chatgpt_mcp'
  and coalesce(raw#>>'{entry,price,value}','') ~ '^[0-9]+([.][0-9]+)?$';

update public.listings
set image_url=replace(replace(raw#>>'{entry,titlePictureUrls,0,href}','%WIDTH%','1200'),'%HEIGHT%','800')
where source_id=1
  and nullif(raw#>>'{entry,titlePictureUrls,0,href}','') is not null
  and (image_url is null or image_status='fallback');

update public.listings
set warm_rent=cold_rent,
    cold_rent=null,
    enrichment_evidence=enrichment_evidence || jsonb_build_object('warm_rent',jsonb_build_object('value',cold_rent,'source','source_semantics:wg_gesucht_gesamtmiete','confidence',0.99))
where source_id=6 and warm_rent is null and cold_rent is not null;

update public.listings
set warm_rent=cold_rent,
    cold_rent=null,
    enrichment_evidence=enrichment_evidence || jsonb_build_object('warm_rent',jsonb_build_object('value',cold_rent,'source','source_semantics:wunderflats_pauschal_warmmiete','confidence',1.0))
where source_id=10 and warm_rent is null and cold_rent is not null;

select app_private.queue_listing_enrichment_id(id)
from public.listings
where is_active=true and source_id in (1,6,10);
