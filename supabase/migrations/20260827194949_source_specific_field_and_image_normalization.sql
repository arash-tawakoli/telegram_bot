create or replace function app_private.normalize_listing_image_url()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.source_id=2 and new.image_url is not null and new.image_url ~ '^https://img\.kleinanzeigen\.de/' then
    new.image_url:=regexp_replace(new.image_url,'\.AUTO([&#?]|$)','.JPG\1','i');
  end if;
  return new;
end;
$$;

drop trigger if exists listings_normalize_image_url on public.listings;
create trigger listings_normalize_image_url
before insert or update of source_id,image_url on public.listings
for each row execute function app_private.normalize_listing_image_url();

create or replace function app_private.enrich_listing_fields()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  txt text := coalesce(new.raw::text,'');
  m text[];
  room_candidate numeric;
  room_word text;
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

  if new.rooms is null and new.source_id=6 then
    m:=regexp_match(coalesce(new.raw->>'text',''),'(?i)([0-9]+(?:[.,][0-9]+)?)\s*[-– ]?\s*Zimmer(?:-Wohnung)?');
    if m is not null then room_candidate:=replace(m[1],',','.')::numeric; if room_candidate between 0.5 and 20 then new.rooms:=room_candidate; end if; end if;
  elsif new.rooms is null and new.source_id=1 then
    m:=regexp_match(coalesce(new.title,'')||' '||coalesce(new.raw->>'description',''),'(?i)\m(ein|eine|einen|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|[0-9]+)\M.{0,20}\mzimmer(n)?\M');
    if m is not null then
      room_word:=lower(m[1]);
      room_candidate:=case room_word when 'ein' then 1 when 'eine' then 1 when 'einen' then 1 when 'zwei' then 2 when 'drei' then 3 when 'vier' then 4 when 'fünf' then 5 when 'fuenf' then 5 when 'sechs' then 6 when 'sieben' then 7 when 'acht' then 8 when 'neun' then 9 when 'zehn' then 10 else case when room_word ~ '^[0-9]+$' then room_word::numeric else null end end;
      if room_candidate between 0.5 and 20 then new.rooms:=room_candidate; end if;
    end if;
  end if;

  if new.rooms is not null and (new.rooms<0.5 or new.rooms>20) then
    m:=regexp_match(coalesce(new.title,''),'(?i)([0-9]+(?:[.,][0-9]+)?)\s*[- ]?Zimmer');
    room_candidate:=case when m is not null then replace(m[1],',','.')::numeric else null end;
    if room_candidate between 0.5 and 20 then new.rooms:=room_candidate; else new.rooms:=null; end if;
  end if;

  if new.warm_rent is not null and new.cold_rent is not null and new.warm_rent<new.cold_rent then
    new.cold_rent:=null;
  end if;
  return new;
end;
$$;

update public.listings
set image_url=regexp_replace(image_url,'\.AUTO([&#?]|$)','.JPG\1','i')
where source_id=2 and image_url ~ '^https://img\.kleinanzeigen\.de/' and image_url ~ '\.AUTO([&#?]|$)';
