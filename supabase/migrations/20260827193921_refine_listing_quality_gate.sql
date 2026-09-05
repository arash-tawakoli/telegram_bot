create or replace function app_private.enforce_listing_quality()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_title text:=lower(coalesce(new.title,''));
  v_url text:=lower(coalesce(new.canonical_url,''));
  v_city text:=lower(coalesce(new.city,''));
begin
  new.quality_status:='accepted';
  new.quality_reason:=null;

  if v_title ~ '^(datenschutz|datenschutzerklärung|impressum|sitemap|kontakt|kontaktformular|kontakt aufnehmen|erklärung zur barrierefreiheit|barrierefreiheit|privacy|privacy policy|terms|terms of service|agb|faq|newsletter|karriere|downloads?)$'
     or v_title ~ '(datenschutzerklärung|impressum|sitemap|erklärung zur barrierefreiheit|anfahrt in google maps)'
     or v_url ~ '/(datenschutz|datenschutzerklaerung|impressum|sitemap|kontakt|barrierefreiheit|privacy|terms|agb)(/|$|[?])'
     or v_url ~ 'google\.[^/]+/maps'
     or v_url ~ 'maps\.app\.goo\.gl'
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
  end if;
  return new;
end;
$$;

-- Restore rows rejected only by the superseded overly broad title rules and re-evaluate them.
update public.listings
set is_active=true,enrichment_delivery_eligible=true,quality_status='unchecked',quality_reason=null
where quality_reason='title_postal_code_outside_hamburg_region'
   or (quality_reason='title_outside_hamburg' and lower(coalesce(title,'')) like '%hamburg%');

update public.listings set title=title
where quality_status='unchecked';

select app_private.refresh_source_field_capabilities();
select app_private.refresh_source_field_audit_status();
