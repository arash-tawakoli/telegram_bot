create or replace function app_private.refresh_source_field_capabilities()
returns integer
language plpgsql
set search_path=''
as $$
declare
  v_count integer;
begin
  insert into public.source_field_capabilities(
    source_id,audit_status,sample_size,
    cold_rent_count,cold_rent_coverage,cold_rent_hint_count,cold_rent_conflict_count,
    warm_rent_count,warm_rent_coverage,warm_rent_hint_count,warm_rent_conflict_count,
    heating_costs_count,heating_costs_coverage,heating_costs_hint_count,heating_costs_conflict_count,
    additional_costs_count,additional_costs_coverage,additional_costs_hint_count,additional_costs_conflict_count,
    deposit_count,deposit_coverage,deposit_hint_count,deposit_conflict_count,
    area_sqm_count,area_sqm_coverage,area_sqm_hint_count,area_sqm_conflict_count,
    rooms_count,rooms_coverage,rooms_hint_count,rooms_conflict_count,
    direct_image_count,resolved_image_count,fallback_image_count,image_coverage,image_hint_count,
    observed_fields,potential_fields,last_listing_at,last_audited_at
  )
  select s.id,
    case when count(l.id)=0 then 'no_sample' else 'sampled' end,
    count(l.id)::int,
    count(l.id) filter(where l.cold_rent is not null)::int,
    coalesce(round((count(l.id) filter(where l.cold_rent is not null))::numeric/nullif(count(l.id),0),4),0),
    count(l.id) filter(where l.cold_rent is null and l.raw::text ~* '(kaltmiete|nettokaltmiete|nettorent|base.?rent|rent.?cold|kalt.?rent|rentnet|net.?rent|basicrent)')::int,
    count(l.id) filter(where l.field_conflicts->'cold_rent' is not null)::int,
    count(l.id) filter(where l.warm_rent is not null)::int,
    coalesce(round((count(l.id) filter(where l.warm_rent is not null))::numeric/nullif(count(l.id),0),4),0),
    count(l.id) filter(where l.warm_rent is null and l.raw::text ~* '(warmmiete|gesamtmiete|bruttomiete|gross.?rent|total.?rent|warm.?rent|rentgross|totalrentgross)')::int,
    count(l.id) filter(where l.field_conflicts->'warm_rent' is not null)::int,
    count(l.id) filter(where l.heating_costs is not null)::int,
    coalesce(round((count(l.id) filter(where l.heating_costs is not null))::numeric/nullif(count(l.id),0),4),0),
    count(l.id) filter(where l.heating_costs is null and l.raw::text ~* '(heizkosten|heating.?cost|heiz.?kosten)')::int,
    count(l.id) filter(where l.field_conflicts->'heating_costs' is not null)::int,
    count(l.id) filter(where l.additional_costs is not null)::int,
    coalesce(round((count(l.id) filter(where l.additional_costs is not null))::numeric/nullif(count(l.id),0),4),0),
    count(l.id) filter(where l.additional_costs is null and l.raw::text ~* '(nebenkosten|betriebskosten|additional.?cost|service.?charge|utilities)')::int,
    count(l.id) filter(where l.field_conflicts->'additional_costs' is not null)::int,
    count(l.id) filter(where l.deposit is not null or nullif(l.deposit_text,'') is not null)::int,
    coalesce(round((count(l.id) filter(where l.deposit is not null or nullif(l.deposit_text,'') is not null))::numeric/nullif(count(l.id),0),4),0),
    count(l.id) filter(where l.deposit is null and nullif(l.deposit_text,'') is null and l.raw::text ~* '(kaution|deposit|security.?deposit|mietsicherheit)')::int,
    count(l.id) filter(where l.field_conflicts->'deposit' is not null)::int,
    count(l.id) filter(where l.area_sqm is not null)::int,
    coalesce(round((count(l.id) filter(where l.area_sqm is not null))::numeric/nullif(count(l.id),0),4),0),
    count(l.id) filter(where l.area_sqm is null and l.raw::text ~* '(wohnfl.che|wohnflaeche|living.?area|area.?sqm|square.?meter|size)')::int,
    count(l.id) filter(where l.field_conflicts->'area_sqm' is not null)::int,
    count(l.id) filter(where l.rooms is not null)::int,
    coalesce(round((count(l.id) filter(where l.rooms is not null))::numeric/nullif(count(l.id),0),4),0),
    count(l.id) filter(where l.rooms is null and l.raw::text ~* '(zimmer|rooms|room.?count|totalrooms)')::int,
    count(l.id) filter(where l.field_conflicts->'rooms' is not null)::int,
    count(l.id) filter(where nullif(l.image_url,'') is not null)::int,
    count(l.id) filter(where nullif(l.resolved_image_url,'') is not null and l.image_status<>'fallback')::int,
    count(l.id) filter(where l.image_status='fallback')::int,
    coalesce(round((count(l.id) filter(where nullif(l.resolved_image_url,'') is not null and l.image_status<>'fallback'))::numeric/nullif(count(l.id),0),4),0),
    count(l.id) filter(where nullif(l.image_url,'') is null and l.raw::text ~* '(image|photo|bild|gallery|thumbnail|media|picture)')::int,
    jsonb_build_object(
      'cold_rent',count(l.id) filter(where l.cold_rent is not null)>0,
      'warm_rent',count(l.id) filter(where l.warm_rent is not null)>0,
      'heating_costs',count(l.id) filter(where l.heating_costs is not null)>0,
      'additional_costs',count(l.id) filter(where l.additional_costs is not null)>0,
      'deposit',count(l.id) filter(where l.deposit is not null or nullif(l.deposit_text,'') is not null)>0,
      'area_sqm',count(l.id) filter(where l.area_sqm is not null)>0,
      'rooms',count(l.id) filter(where l.rooms is not null)>0,
      'image',count(l.id) filter(where nullif(l.resolved_image_url,'') is not null and l.image_status<>'fallback')>0
    ),
    jsonb_build_object(
      'cold_rent',count(l.id) filter(where l.cold_rent is not null or l.raw::text ~* '(kaltmiete|nettokaltmiete|nettorent|base.?rent|rent.?cold|kalt.?rent)')>0,
      'warm_rent',count(l.id) filter(where l.warm_rent is not null or l.raw::text ~* '(warmmiete|gesamtmiete|bruttomiete|gross.?rent|total.?rent|rentgross)')>0,
      'heating_costs',count(l.id) filter(where l.heating_costs is not null or l.raw::text ~* '(heizkosten|heating.?cost)')>0,
      'additional_costs',count(l.id) filter(where l.additional_costs is not null or l.raw::text ~* '(nebenkosten|betriebskosten|additional.?cost|service.?charge|utilities)')>0,
      'deposit',count(l.id) filter(where l.deposit is not null or nullif(l.deposit_text,'') is not null or l.raw::text ~* '(kaution|deposit|mietsicherheit)')>0,
      'area_sqm',count(l.id) filter(where l.area_sqm is not null or l.raw::text ~* '(wohnfl.che|wohnflaeche|living.?area|area.?sqm|size)')>0,
      'rooms',count(l.id) filter(where l.rooms is not null or l.raw::text ~* '(zimmer|rooms|room.?count|totalrooms)')>0,
      'image',count(l.id) filter(where nullif(l.image_url,'') is not null or l.raw::text ~* '(image|photo|bild|gallery|thumbnail|media|picture)')>0
    ),
    max(l.last_seen_at),now()
  from public.sources s
  left join public.listings l on l.source_id=s.id
  group by s.id
  on conflict(source_id) do update set
    audit_status=excluded.audit_status,sample_size=excluded.sample_size,
    cold_rent_count=excluded.cold_rent_count,cold_rent_coverage=excluded.cold_rent_coverage,cold_rent_hint_count=excluded.cold_rent_hint_count,cold_rent_conflict_count=excluded.cold_rent_conflict_count,
    warm_rent_count=excluded.warm_rent_count,warm_rent_coverage=excluded.warm_rent_coverage,warm_rent_hint_count=excluded.warm_rent_hint_count,warm_rent_conflict_count=excluded.warm_rent_conflict_count,
    heating_costs_count=excluded.heating_costs_count,heating_costs_coverage=excluded.heating_costs_coverage,heating_costs_hint_count=excluded.heating_costs_hint_count,heating_costs_conflict_count=excluded.heating_costs_conflict_count,
    additional_costs_count=excluded.additional_costs_count,additional_costs_coverage=excluded.additional_costs_coverage,additional_costs_hint_count=excluded.additional_costs_hint_count,additional_costs_conflict_count=excluded.additional_costs_conflict_count,
    deposit_count=excluded.deposit_count,deposit_coverage=excluded.deposit_coverage,deposit_hint_count=excluded.deposit_hint_count,deposit_conflict_count=excluded.deposit_conflict_count,
    area_sqm_count=excluded.area_sqm_count,area_sqm_coverage=excluded.area_sqm_coverage,area_sqm_hint_count=excluded.area_sqm_hint_count,area_sqm_conflict_count=excluded.area_sqm_conflict_count,
    rooms_count=excluded.rooms_count,rooms_coverage=excluded.rooms_coverage,rooms_hint_count=excluded.rooms_hint_count,rooms_conflict_count=excluded.rooms_conflict_count,
    direct_image_count=excluded.direct_image_count,resolved_image_count=excluded.resolved_image_count,fallback_image_count=excluded.fallback_image_count,image_coverage=excluded.image_coverage,image_hint_count=excluded.image_hint_count,
    observed_fields=excluded.observed_fields,potential_fields=excluded.potential_fields,last_listing_at=excluded.last_listing_at,last_audited_at=excluded.last_audited_at;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace view app_private.source_field_capabilities_v as
select s.name,s.source_type,s.enabled,s.worker_slug,s.tier,s.poll_interval_minutes,c.*
from public.sources s
join public.source_field_capabilities c on c.source_id=s.id;

select app_private.refresh_source_field_capabilities();
