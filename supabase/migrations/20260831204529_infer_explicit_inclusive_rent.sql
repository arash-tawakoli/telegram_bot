create or replace function app_private.enrich_listing_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  txt text := coalesce(new.raw::text,'');
  m text[];
  room_candidate numeric;
begin
  if new.source_id=1 and new.cold_rent is null and new.warm_rent is null and new.raw->>'parser'='immoscout24_official_chatgpt_mcp' then
    begin new.cold_rent:=nullif(new.raw#>>'{entry,price,value}','')::numeric; exception when others then null; end;
  end if;
  if new.source_id in (6,10) and new.warm_rent is null and new.cold_rent is not null then new.warm_rent:=new.cold_rent; new.cold_rent:=null; new.warm_rent_is_calculated:=false; end if;

  if new.warm_rent is null then
    begin
      new.warm_rent:=coalesce(nullif(new.raw->>'warmRent','')::numeric,nullif(new.raw->>'totalRentGross','')::numeric,nullif(new.raw->>'totalRent','')::numeric,nullif(new.raw->>'grossRent','')::numeric,nullif(new.raw->>'monthlyTotalRent','')::numeric);
      if new.warm_rent is not null then new.warm_rent_is_calculated:=false; end if;
    exception when others then null;
    end;
  end if;
  if new.warm_rent is null then m:=regexp_match(txt,'(?i)(?:Warmmiete|Bruttowarmmiete|Bruttomiete|Gesamtmiete|Miete\s*warm|Miete\s*inkl\.?\s*(?:NK|Nebenkosten))[^0-9]{0,60}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.warm_rent:=app_private.parse_eur(m[1]); new.warm_rent_is_calculated:=false; end if; end if;
  if new.warm_rent is null then m:=regexp_match(txt,'(?i)([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(?:€|EUR)?\s*(?:inkl\.?\s*(?:NK|Nebenkosten)|inklusive\s+Nebenkosten)'); if m is not null then new.warm_rent:=app_private.parse_eur(m[1]); new.warm_rent_is_calculated:=false; end if; end if;
  if new.warm_rent is null and new.cold_rent is not null and txt ~* '(inkl\.?\s*(NK|Nebenkosten)|inklusive\s+Nebenkosten)' then new.warm_rent:=new.cold_rent; new.warm_rent_is_calculated:=false; end if;
  if new.cold_rent is null then m:=regexp_match(txt,'(?i)(?:Nettokaltmiete|Kaltmiete|Grundmiete|Nettomiete|(?:^|Kosten[^A-Za-z]{0,20})Miete\s*:)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.cold_rent:=app_private.parse_eur(m[1]); end if; end if;
  if new.heating_costs is null then m:=regexp_match(txt,'(?i)(?:Heizkosten|Heizungskosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.heating_costs:=app_private.parse_eur(m[1]); end if; end if;
  if new.additional_costs is null then m:=regexp_match(txt,'(?i)(?:Nebenkosten|sonstige Kosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.additional_costs:=app_private.parse_eur(m[1]); end if; end if;
  if new.operating_costs is null then m:=regexp_match(txt,'(?i)(?:Betriebskosten|Betriebskostenvorauszahlung)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.operating_costs:=app_private.parse_eur(m[1]); end if; end if;
  if new.deposit is null then m:=regexp_match(txt,'(?i)(?:Kaution|Mietkaution|Mietsicherheit)[^0-9]{0,50}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.deposit:=app_private.parse_eur(m[1]); end if; end if;

  if new.rooms is null and new.source_id=6 then m:=regexp_match(coalesce(new.raw->>'text',''),'(?i)([0-9]+(?:[.,][0-9]+)?)\s*[-– ]?\s*Zimmer(?:-Wohnung)?'); if m is not null then room_candidate:=replace(m[1],',','.')::numeric; if room_candidate between 0.5 and 20 then new.rooms:=room_candidate; end if; end if; end if;

  if new.warm_rent is null and new.cold_rent is not null and (new.additional_costs is not null or new.operating_costs is not null or new.heating_costs is not null) then new.warm_rent:=new.cold_rent+coalesce(new.additional_costs,new.operating_costs,0)+coalesce(new.heating_costs,0); new.warm_rent_is_calculated:=true;
  elsif new.warm_rent is not null and not coalesce(new.warm_rent_is_calculated,false) then new.warm_rent_is_calculated:=false;
  end if;
  if new.warm_rent is not null and new.cold_rent is not null and new.warm_rent<new.cold_rent then new.warm_rent:=null; new.warm_rent_is_calculated:=false; end if;
  return new;
end;
$function$;
