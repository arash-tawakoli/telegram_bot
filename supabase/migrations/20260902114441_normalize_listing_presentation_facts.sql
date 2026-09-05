create or replace function app_private.normalize_listing_presentation_facts()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  txt text := coalesce(new.raw->>'text','') || ' ' || coalesce(new.raw->>'snippet','') || ' ' || coalesce(new.raw->>'alt','') || ' ' || coalesce(new.title,'');
  m text[];
  candidate text;
begin
  if nullif(btrim(new.address),'') is null then
    candidate := coalesce(
      nullif(btrim(new.raw#>>'{address,streetAddress}'),''),
      nullif(btrim(new.raw#>>'{address,street}'),''),
      nullif(btrim(new.raw->>'streetAddress'),''),
      nullif(btrim(new.raw->>'street'),'')
    );
    if candidate is not null then
      candidate := btrim(candidate || case when coalesce(new.raw#>>'{address,houseNumber}',new.raw->>'houseNumber') is not null then ' ' || coalesce(new.raw#>>'{address,houseNumber}',new.raw->>'houseNumber') else '' end);
      new.address := candidate;
    else
      m := regexp_match(txt, '(?i)([A-ZÄÖÜ][A-Za-zÄÖÜäöüß .''-]{1,60}(?:straße|strasse|str\.|weg|allee|ring|platz|chaussee|damm|kamp|stieg|ufer|twiete|gasse)\s+[0-9]{1,4}[a-zA-Z]?(?:\s*[-/]\s*[0-9]{1,4}[a-zA-Z]?)?)');
      if m is not null then new.address := btrim(m[1]); end if;
    end if;
  end if;

  if nullif(btrim(new.district),'') is null then
    new.district := coalesce(nullif(btrim(new.raw#>>'{address,district}'),''),nullif(btrim(new.raw->>'district'),''),nullif(btrim(new.raw#>>'{entry,address,quarter}'),''));
  end if;
  if nullif(btrim(new.postal_code),'') is null then
    new.postal_code := coalesce(nullif(btrim(new.raw#>>'{address,postalCode}'),''),nullif(btrim(new.raw#>>'{address,zipCode}'),''),nullif(btrim(new.raw->>'postalCode'),''),nullif(btrim(new.raw->>'zipCode'),''),substring(txt from '\m(2[0-9]{4})\M'));
  end if;

  if new.image_url like 'https://www.grandcityproperty.de/grandcityproperty.de/%' then
    new.image_url := regexp_replace(new.image_url, '^https://www[.]grandcityproperty[.]de/grandcityproperty[.]de/', 'https://www.grandcityproperty.de/');
  end if;

  if new.image_url ~ '^https://mms[.]immowelt[.]de/' then
    if new.image_url ~ '([?&])h=50([&#]|$)' and new.image_url !~ '([?&])w=' then
      new.image_url := regexp_replace(new.image_url,'([?&])h=50([&#]|$)','\1w=525&h=394\2','i');
    end if;
    new.resolved_image_url := new.image_url;
    new.image_status := 'direct';
    new.image_source := 'immowelt_mms';
    new.image_error := null;
    new.image_last_checked_at := now();
  elsif new.image_url ~* '^https://.*\.(?:jpe?g|png|webp)(?:[?&#]|$)' then
    new.resolved_image_url := new.image_url;
    new.image_status := 'direct';
    new.image_source := coalesce(new.image_source,'source_direct');
    new.image_error := null;
    new.image_last_checked_at := coalesce(new.image_last_checked_at,now());
  end if;

  if new.source_id=8 and new.canonical_url ~* '/wohnungssuche/(leipzig|dresden|celle|halle-saale-|chemnitz|delmenhorst|osterwieck)/' then
    new.quality_status := 'rejected';
    new.is_active := false;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_normalize_presentation_facts on public.listings;
create trigger listings_normalize_presentation_facts
before insert or update of raw,address,district,postal_code,image_url,canonical_url
on public.listings
for each row execute function app_private.normalize_listing_presentation_facts();
