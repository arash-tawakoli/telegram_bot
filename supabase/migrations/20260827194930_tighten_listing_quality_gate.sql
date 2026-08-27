create or replace function app_private.enforce_listing_quality()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_title text:=lower(trim(coalesce(new.title,'')));
  v_url text:=lower(trim(coalesce(new.canonical_url,'')));
  v_city text:=lower(trim(coalesce(new.city,'')));
  v_raw text:=lower(left(coalesce(new.raw::text,''),6000));
  v_has_property_fields boolean:=new.cold_rent is not null or new.warm_rent is not null or new.area_sqm is not null or new.rooms is not null;
begin
  new.quality_status:='accepted';
  new.quality_reason:=null;

  if v_url ~ '^(mailto:|tel:|javascript:)' then
    new.quality_status:='rejected'; new.quality_reason:='non_http_action';
  elsif v_url ~ '^https?://(www\.)?(maps\.app\.goo\.gl|google\.[^/]+/maps)' then
    new.quality_status:='rejected'; new.quality_reason:='map_link';
  elsif v_title ~ '^(datenschutz|datenschutzerklärung|datenschutzerklaerung|impressum|sitemap|kontakt|kontaktformular|kontakt aufnehmen|cookie-erklärung|cookie-erklaerung|erklärung zur barrierefreiheit|erklaerung zur barrierefreiheit|barrierefreiheit|privacy|privacy policy|terms|terms of service|agb|faq|newsletter|karriere|downloads?|e-mail|email|anfahrt( in)? google maps)(\b|\s|$)'
     or v_title ~ '(datenschutzerklärung|datenschutzerklaerung|erklärung zur barrierefreiheit|erklaerung zur barrierefreiheit|anfahrt in google maps)' then
    new.quality_status:='rejected'; new.quality_reason:='navigation_or_legal_page';
  elsif v_url ~ '/(datenschutz|datenschutzerklaerung|impressum|sitemap|kontakt|cookie(-erklaerung)?|barrierefreiheit|privacy|terms|agb|geschaeftsstelle|geschäftsstelle|notfall)(/|$|\?)' then
    new.quality_status:='rejected'; new.quality_reason:='navigation_or_legal_url';
  elsif new.source_id=40 and not v_has_property_fields and (
        v_title ~ '^(für mitglieder|fuer mitglieder|journal|sitemap|anfahrt|allgemeine deutsche schiffszimmerer)' or
        v_url ~ '/(mitglieder|journal|sitemap)(/|$|\?)' or
        v_raw ~ 'sitemap.{0,160}(datenschutz|impressum)'
      ) then
    new.quality_status:='rejected'; new.quality_reason:='source_navigation_page';
  elsif new.source_id=44 and not v_has_property_fields and (
        v_title ~ '(wahlergebnis|vertreterwahl|vertreterversammlung|wohnungsgenossenschaft berner allee|telefonische beratungszeit)' or
        (v_url ~ '^https?://(www\.)?gartenstadt-hamburg\.de/?$' and v_raw ~ '(e-mail|telefonische beratungszeit|vertreterversammlung)')
      ) then
    new.quality_status:='rejected'; new.quality_reason:='source_news_or_navigation_page';
  elsif new.source_id=60 and not v_has_property_fields and (
        v_title ~ '^(geschäftsstelle|geschaeftsstelle|im notfall|wohnungsangebote|cookie-erklärung|cookie-erklaerung|datenschutz|impressum|e-mail|email)' or
        v_url ~ '/de/(geschaeftsstelle|notfall|wohnungsangebote?|cookie-erklaerung|datenschutz|impressum)(/|$|\?)' or
        v_raw ~ 'geschäfts.{0,20}stelle.{0,500}notdienst' or v_raw ~ 'geschaefts.{0,20}stelle.{0,500}notdienst'
      ) then
    new.quality_status:='rejected'; new.quality_reason:='source_navigation_page';
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
  elsif tg_op='UPDATE' and old.quality_status='rejected' and new.enrichment_delivery_eligible=false then
    new.enrichment_delivery_eligible:=true;
  end if;
  return new;
end;
$$;

update public.listings set title=title;

update public.delivery_events de
set status='skipped',error_message='quality_gate_rejected_listing'
from public.listings l
where de.listing_id=l.id and l.quality_status='rejected' and de.status in ('pending','failed');
