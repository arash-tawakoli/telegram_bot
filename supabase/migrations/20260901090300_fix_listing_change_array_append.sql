create or replace function app_private.capture_listing_changes()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  f text[] := '{}';
  ov jsonb := '{}';
  nv jsonb := '{}';
begin
  if old.warm_rent is distinct from new.warm_rent then
    f := array_append(f, 'warm_rent');
    ov := ov || jsonb_build_object('warm_rent', old.warm_rent);
    nv := nv || jsonb_build_object('warm_rent', new.warm_rent);
  end if;
  if old.cold_rent is distinct from new.cold_rent then
    f := array_append(f, 'cold_rent');
    ov := ov || jsonb_build_object('cold_rent', old.cold_rent);
    nv := nv || jsonb_build_object('cold_rent', new.cold_rent);
  end if;
  if old.deposit is distinct from new.deposit then
    f := array_append(f, 'deposit');
    ov := ov || jsonb_build_object('deposit', old.deposit);
    nv := nv || jsonb_build_object('deposit', new.deposit);
  end if;
  if old.rooms is distinct from new.rooms then
    f := array_append(f, 'rooms');
    ov := ov || jsonb_build_object('rooms', old.rooms);
    nv := nv || jsonb_build_object('rooms', new.rooms);
  end if;
  if old.area_sqm is distinct from new.area_sqm then
    f := array_append(f, 'area_sqm');
    ov := ov || jsonb_build_object('area_sqm', old.area_sqm);
    nv := nv || jsonb_build_object('area_sqm', new.area_sqm);
  end if;
  if old.available_from is distinct from new.available_from then
    f := array_append(f, 'available_from');
    ov := ov || jsonb_build_object('available_from', old.available_from);
    nv := nv || jsonb_build_object('available_from', new.available_from);
  end if;
  if old.canonical_url is distinct from new.canonical_url then
    f := array_append(f, 'canonical_url');
    ov := ov || jsonb_build_object('canonical_url', old.canonical_url);
    nv := nv || jsonb_build_object('canonical_url', new.canonical_url);
  end if;
  if old.is_active is distinct from new.is_active then
    f := array_append(f, 'is_active');
    ov := ov || jsonb_build_object('is_active', old.is_active);
    nv := nv || jsonb_build_object('is_active', new.is_active);
  end if;
  if cardinality(f) > 0 then
    insert into public.listing_changes(listing_id, changed_fields, old_values, new_values)
    values(new.id, f, ov, nv);
  end if;
  return new;
end;
$function$;
