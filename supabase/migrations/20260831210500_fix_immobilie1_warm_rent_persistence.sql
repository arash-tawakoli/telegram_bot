create or replace function app_private.preserve_enriched_listing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cold_rent is null and old.cold_rent is not null then new.cold_rent:=old.cold_rent; end if;
  if new.warm_rent is null and old.warm_rent is not null and not (
    new.source_id=16 and (
      coalesce(old.enrichment_evidence->'additional_costs'->>'source','')='detail:text'
      or coalesce(old.enrichment_evidence->'heating_costs'->>'source','')='detail:text'
    )
  ) then
    new.warm_rent:=old.warm_rent;
    new.warm_rent_is_calculated:=old.warm_rent_is_calculated;
  end if;
  if new.heating_costs is null and old.heating_costs is not null and not (
    new.source_id=16 and coalesce(old.enrichment_evidence->'heating_costs'->>'source','')='detail:text'
  ) then new.heating_costs:=old.heating_costs; end if;
  if new.additional_costs is null and old.additional_costs is not null and not (
    new.source_id=16 and coalesce(old.enrichment_evidence->'additional_costs'->>'source','')='detail:text'
  ) then new.additional_costs:=old.additional_costs; end if;
  if new.operating_costs is null and old.operating_costs is not null then new.operating_costs:=old.operating_costs; end if;
  if new.deposit is null and old.deposit is not null then new.deposit:=old.deposit; end if;
  if nullif(new.deposit_text,'') is null and nullif(old.deposit_text,'') is not null then new.deposit_text:=old.deposit_text; end if;
  if new.area_sqm is null and old.area_sqm is not null then new.area_sqm:=old.area_sqm; end if;
  if new.rooms is null and old.rooms is not null then new.rooms:=old.rooms; end if;
  if nullif(new.image_url,'') is null and nullif(old.image_url,'') is not null then new.image_url:=old.image_url; end if;
  if nullif(new.resolved_image_url,'') is null and nullif(old.resolved_image_url,'') is not null then new.resolved_image_url:=old.resolved_image_url; end if;
  return new;
end;
$$;
