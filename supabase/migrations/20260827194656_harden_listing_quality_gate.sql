create or replace function app_private.enforce_listing_quality()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_title text:=lower(coalesce(new.title,''));
  v_url text:=lower(coalesce(new.canonical_url,''));
  v_city text:=lower(coalesce(new.city,''));
  v_raw text:=lower(left(coalesce(new.raw::text,''),8000));
  v_no_core boolean:=new.cold_rent is null and new.warm_rent is null and new.area_sqm is null and new.rooms is null;
begin
  new.quality_status:='accepted';
  new.quality_reason:=null;

  if v_url ~ '^(mailto:|tel:|javascript:)'
     or v_url ~ '^https?://(www\.)?(maps\.app\.goo\.gl|google\.[^/]+/maps)'
     or v_title ~ '^(datenschutz|datenschutzerklärung|impressum|sitemap|kontakt|kontaktformular|kontakt aufnehmen|cookie(-erklärung|-erklaerung)?|erklärung zur barrierefreiheit|barrierefreiheit|privacy|privacy policy|terms|terms of service|agb|faq|newsletter|karriere|downloads?|e-mail|anfahrt( in)? google maps|für mitglieder|journal|wahlergebnis|vertreterversammlung)(\b|\s|$)'
     or v_title ~ '(datenschutzerklärung|impressum|sitemap|erklärung zur barrierefreiheit|anfahrt in google maps)'
     or v_url ~ '/(datenschutz|datenschutzerklaerung|impressum|sitemap|kontakt|cookie(-erklaerung)?|barrierefreiheit|privacy|terms|agb|geschaeftsstelle|geschäftsstelle|notfall|mitglieder|journal)(/|$|[?])'
     or (v_no_core and new.source_id in (40,44,60) and (
          v_url ~ '/wohnungsangebote?/?$'
          or v_title ~ '(geschäftsstelle|geschaeftsstelle|notfall|vertreterwahl|wohnungsgenossenschaft)'
          or v_raw ~ '(sitemap.{0,160}datenschutz.{0,160}impressum|geschäftsstelle.{0,400}notdienst|geschaeftsstelle.{0,400}notdienst)'
        ))
  then
    new.quality_status:='rejected'; new.quality_reason:='navigation_or_legal_page';
  elsif nullif(new.postal_code,'') is not null and new.postal_code !~ '^2[0-9]{4}$' then
    new.quality_status:='rejected'; new.quality_reason:='postal_code_outside_hamburg_region';
  elsif v_city not in ('','hamburg') and v_city ~ '(hannover|berlin|münchen|munich|köln|cologne|frankfurt|düsseldorf|dusseldorf|stuttgart|bremen|leipzig|dresden)' then
    new.quality_status:='rejected'; new.quality_reason:='city_outside_hamburg';
  elsif v_title !~ 'hamburg' and v_title ~ '(hannover|berlin|münchen|munich|köln|cologne|frankfurt|düsseldorf|dusseldorf|stuttgart|bremen|leipzig|dresden)' then
    new.quality_status:='rejected'; new.quality_reason:='title_outside_hamburg';
  end if;

  if new.quality_status='rejected' then
    new.enrichment_delivery_eligible:=false;
    new.is_active:=false;
  elsif tg_op='UPDATE' and old.quality_status='rejected' and coalesce(new.is_active,false)=true then
    new.enrichment_delivery_eligible:=true;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_quality_gate on public.listings;
create trigger listings_quality_gate
before insert or update of title,canonical_url,postal_code,city,is_active,enrichment_delivery_eligible,raw,cold_rent,warm_rent,area_sqm,rooms
on public.listings for each row execute function app_private.enforce_listing_quality();

create or replace function app_private.queue_listing_enrichment_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.quality_status='rejected' or new.enrichment_delivery_eligible=false then
    return new;
  end if;
  if tg_op='INSERT'
     or old.canonical_url is distinct from new.canonical_url
     or old.raw is distinct from new.raw
     or old.image_url is distinct from new.image_url then
    perform app_private.queue_listing_enrichment_id(new.id);
  end if;
  return new;
end;
$$;

update public.listings set title=title;

update public.delivery_events de
set status='skipped',error_message='quality_gate_invalid_listing'
from public.listings l
where de.listing_id=l.id and l.quality_status='rejected' and de.status in ('pending','failed');
