alter table public.listings
  add column if not exists quality_status text not null default 'unchecked',
  add column if not exists quality_reason text;

do $$ begin
  alter table public.listings add constraint listings_quality_status_chk
    check (quality_status in ('unchecked','accepted','rejected'));
exception when duplicate_object then null; end $$;

create index if not exists listings_quality_status_idx
  on public.listings(quality_status,enrichment_delivery_eligible,is_active,last_seen_at desc);

create or replace function app_private.preserve_enriched_listing_fields()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.cold_rent is null and old.cold_rent is not null then new.cold_rent:=old.cold_rent; end if;
  if new.warm_rent is null and old.warm_rent is not null then new.warm_rent:=old.warm_rent; end if;
  if new.heating_costs is null and old.heating_costs is not null then new.heating_costs:=old.heating_costs; end if;
  if new.additional_costs is null and old.additional_costs is not null then new.additional_costs:=old.additional_costs; end if;
  if new.deposit is null and old.deposit is not null then new.deposit:=old.deposit; end if;
  if nullif(new.deposit_text,'') is null and nullif(old.deposit_text,'') is not null then new.deposit_text:=old.deposit_text; end if;
  if new.area_sqm is null and old.area_sqm is not null then new.area_sqm:=old.area_sqm; end if;
  if new.rooms is null and old.rooms is not null then new.rooms:=old.rooms; end if;
  if nullif(new.image_url,'') is null and nullif(old.image_url,'') is not null then new.image_url:=old.image_url; end if;
  if nullif(new.resolved_image_url,'') is null and nullif(old.resolved_image_url,'') is not null then new.resolved_image_url:=old.resolved_image_url; end if;
  return new;
end;
$$;

drop trigger if exists listings_preserve_enriched_fields on public.listings;
create trigger listings_preserve_enriched_fields
before update of cold_rent,warm_rent,heating_costs,additional_costs,deposit,deposit_text,area_sqm,rooms,image_url,resolved_image_url
on public.listings for each row execute function app_private.preserve_enriched_listing_fields();

create or replace function app_private.enforce_listing_quality()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_title text:=lower(coalesce(new.title,''));
  v_url text:=lower(coalesce(new.canonical_url,''));
  v_city text:=lower(coalesce(new.city,''));
  v_postal_in_title text;
begin
  new.quality_status:='accepted';
  new.quality_reason:=null;

  if v_title ~ '^(datenschutz|datenschutzerklärung|impressum|sitemap|kontakt|kontaktformular|kontakt aufnehmen|erklärung zur barrierefreiheit|barrierefreiheit|privacy|privacy policy|terms|terms of service|agb|faq|newsletter|karriere|downloads?)$'
     or v_title ~ '^(anfahrt|route)( in)? google maps'
     or v_url ~ '/(datenschutz|datenschutzerklaerung|impressum|sitemap|kontakt|barrierefreiheit|privacy|terms|agb)(/|$|[?])'
     or v_url ~ 'google\.[^/]+/maps'
  then
    new.quality_status:='rejected'; new.quality_reason:='navigation_or_legal_page';
  elsif nullif(new.postal_code,'') is not null and new.postal_code !~ '^2[0-9]{4}$' then
    new.quality_status:='rejected'; new.quality_reason:='postal_code_outside_hamburg_region';
  elsif v_city not in ('','hamburg') and v_city ~ '(hannover|berlin|münchen|munich|köln|cologne|frankfurt|düsseldorf|dusseldorf|stuttgart|bremen|leipzig|dresden)' then
    new.quality_status:='rejected'; new.quality_reason:='city_outside_hamburg';
  elsif v_title ~ '(hannover|münchen|munich|köln|cologne|frankfurt|düsseldorf|dusseldorf|stuttgart|bremen|leipzig|dresden)' then
    new.quality_status:='rejected'; new.quality_reason:='title_outside_hamburg';
  else
    v_postal_in_title := substring(coalesce(new.title,'') from '(^|[^0-9])([3-9][0-9]{4})([^0-9]|$)');
    if v_postal_in_title is not null then
      new.quality_status:='rejected'; new.quality_reason:='title_postal_code_outside_hamburg_region';
    end if;
  end if;

  if new.quality_status='rejected' then
    new.enrichment_delivery_eligible:=false;
    new.is_active:=false;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_quality_gate on public.listings;
create trigger listings_quality_gate
before insert or update of title,canonical_url,postal_code,city,is_active,enrichment_delivery_eligible
on public.listings for each row execute function app_private.enforce_listing_quality();

-- Evaluate every existing row through the same gate.
update public.listings set title=title;

-- Keep the capability matrix based on deliverable listings only.
do $$
declare v text;
begin
  select pg_get_functiondef(p.oid) into v
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app_private' and p.proname='refresh_source_field_capabilities';
  if position('left join public.listings l on l.source_id=s.id' in v)>0 then
    v:=replace(v,
      'left join public.listings l on l.source_id=s.id',
      'left join public.listings l on l.source_id=s.id and l.enrichment_delivery_eligible=true and l.quality_status<>''rejected''');
    execute v;
  end if;
end $$;

select app_private.refresh_source_field_capabilities();
select app_private.refresh_source_field_audit_status();
