create or replace function app_private.enrich_listing_fields()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  txt text := coalesce(new.raw::text,'');
  m text[];
  room_candidate numeric;
begin
  if new.source_id=1 and new.cold_rent is null and new.warm_rent is null
     and new.raw->>'parser'='immoscout24_official_chatgpt_mcp' then
    begin new.cold_rent := nullif(new.raw#>>'{entry,price,value}','')::numeric; exception when others then null; end;
  end if;
  if new.source_id=6 and new.warm_rent is null and new.cold_rent is not null then new.warm_rent:=new.cold_rent; new.cold_rent:=null; end if;
  if new.source_id=10 and new.warm_rent is null and new.cold_rent is not null then new.warm_rent:=new.cold_rent; new.cold_rent:=null; end if;

  if new.warm_rent is null then m:=regexp_match(txt,'(?i)(?:Warmmiete|Gesamtmiete|Miete warm)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.warm_rent:=app_private.parse_eur(m[1]); end if; end if;
  if new.cold_rent is null then m:=regexp_match(txt,'(?i)(?:Nettokaltmiete|Kaltmiete|Grundmiete|Nettomiete|(?:^|Kosten[^A-Za-z]{0,20})Miete\s*:)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.cold_rent:=app_private.parse_eur(m[1]); end if; end if;
  if new.heating_costs is null then m:=regexp_match(txt,'(?i)(?:Heizkosten|Heizungskosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.heating_costs:=app_private.parse_eur(m[1]); end if; end if;
  if new.additional_costs is null then m:=regexp_match(txt,'(?i)(?:Nebenkosten|Betriebskosten|sonstige Kosten)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.additional_costs:=app_private.parse_eur(m[1]); end if; end if;
  if new.deposit is null then m:=regexp_match(txt,'(?i)(?:Kaution|Mietkaution|Mietsicherheit)[^0-9]{0,50}([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)'); if m is not null then new.deposit:=app_private.parse_eur(m[1]); end if; end if;
  if new.deposit_text is null and new.deposit is null then m:=regexp_match(txt,'(?i)((?:Kaution|Mietkaution|Mietsicherheit)[^,;}]{0,100})'); if m is not null then new.deposit_text:=left(regexp_replace(m[1],'\s+',' ','g'),120); end if; end if;
  if new.warm_rent is null and new.cold_rent is not null and (new.heating_costs is not null or new.additional_costs is not null) then new.warm_rent:=new.cold_rent+coalesce(new.heating_costs,0)+coalesce(new.additional_costs,0); end if;

  -- Sanity guards: never persist an impossible room count. Prefer an explicit N-Zimmer title value.
  if new.rooms is not null and (new.rooms<0.5 or new.rooms>20) then
    m:=regexp_match(coalesce(new.title,''),'(?i)([0-9]+(?:[.,][0-9]+)?)\s*[- ]?Zimmer');
    room_candidate:=case when m is not null then replace(m[1],',','.')::numeric else null end;
    if room_candidate between 0.5 and 20 then new.rooms:=room_candidate; else new.rooms:=null; end if;
  end if;

  -- Warm rent cannot be below cold rent. Hide the less trustworthy generic cold value rather than presenting contradiction.
  if new.warm_rent is not null and new.cold_rent is not null and new.warm_rent<new.cold_rent then
    new.cold_rent:=null;
  end if;
  return new;
end;
$$;

-- Repair existing invalid room counts using high-confidence structured enrichment evidence first,
-- then explicit N-Zimmer wording in title, otherwise hide the value.
update public.listings l
set rooms = case
  when coalesce(l.enrichment_evidence#>>'{rooms,confidence}','0')::numeric >= 0.95
       and coalesce(l.enrichment_evidence#>>'{rooms,value}','') ~ '^[0-9]+([.][0-9]+)?$'
       and (l.enrichment_evidence#>>'{rooms,value}')::numeric between 0.5 and 20
    then (l.enrichment_evidence#>>'{rooms,value}')::numeric
  when substring(l.title from '(?i)([0-9]+(?:[.,][0-9]+)?)\s*[- ]?Zimmer') is not null
    then replace(substring(l.title from '(?i)([0-9]+(?:[.,][0-9]+)?)\s*[- ]?Zimmer'),',','.')::numeric
  else null
end
where l.rooms is not null and (l.rooms<0.5 or l.rooms>20);

update public.listings
set field_conflicts = field_conflicts || jsonb_build_object('rent_order',jsonb_build_object('cold_rent',cold_rent,'warm_rent',warm_rent,'action','cold_rent_hidden')),
    cold_rent=null
where cold_rent is not null and warm_rent is not null and warm_rent<cold_rent;
