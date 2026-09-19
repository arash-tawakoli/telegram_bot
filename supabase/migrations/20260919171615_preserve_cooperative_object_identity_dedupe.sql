set local lock_timeout='3s';
set local statement_timeout='30s';
-- Preserve distinct platform object identities and avoid repeated no-op writes.
create or replace function app_private.assign_listing_dedupe(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path='' as $fn$
declare
  c public.listings%rowtype;
  v_group uuid;
  v_old_group uuid;
  v_winner uuid;
  v_target jsonb;
  v_sid text;
begin
  select * into c from public.listings where id=p_listing_id for update;
  if not found or c.quality_status='rejected' then return null; end if;
  v_old_group:=c.dedupe_group_id;
  v_target:=app_private.immomio_application_target(c.raw,c.canonical_url);
  v_sid:=case when v_target->>'status'='resolved' then v_target->>'source_identifier' end;

  select l.dedupe_group_id into v_group
  from public.listings l
  where l.id<>c.id and l.is_active=true and l.quality_status<>'rejected'
    and l.dedupe_group_id is not null
    and (
      (v_sid is not null and app_private.immomio_application_target(l.raw,l.canonical_url)->>'source_identifier'=v_sid)
      or (c.canonical_url is not null and l.canonical_url=c.canonical_url)
      or (c.cross_source_hash is not null and l.cross_source_hash=c.cross_source_hash)
      or (length(app_private.normalized_listing_address(c.address))>=6
        and app_private.normalized_listing_address(c.address)=app_private.normalized_listing_address(l.address)
        and (c.rooms is null or l.rooms is null or abs(c.rooms-l.rooms)<=0.5)
        and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm-l.area_sqm)<=3))
      or (
        c.source_id<>l.source_id and nullif(trim(c.postal_code),'') is not null
        and c.postal_code=l.postal_code
        and length(regexp_replace(lower(coalesce(c.title,'')),'[^[:alnum:]äöüß]+','','g'))>=12
        and regexp_replace(lower(coalesce(c.title,'')),'[^[:alnum:]äöüß]+','','g')
          =regexp_replace(lower(coalesce(l.title,'')),'[^[:alnum:]äöüß]+','','g')
        and c.rooms is not null and l.rooms is not null and abs(c.rooms-l.rooms)<=0.25
        and c.area_sqm is not null and l.area_sqm is not null and abs(c.area_sqm-l.area_sqm)<=1
        and coalesce(nullif(c.warm_rent,0),nullif(c.cold_rent,0)) is not null
        and coalesce(nullif(l.warm_rent,0),nullif(l.cold_rent,0)) is not null
        and abs(coalesce(nullif(c.warm_rent,0),nullif(c.cold_rent,0))-coalesce(nullif(l.warm_rent,0),nullif(l.cold_rent,0)))
          <=greatest(5,least(coalesce(nullif(c.warm_rent,0),nullif(c.cold_rent,0)),coalesce(nullif(l.warm_rent,0),nullif(l.cold_rent,0)))*0.01)
      )
    )
    -- A fuzzy match to one member must not bridge incompatible known objects.
    and (v_sid is null or not exists(
      select 1 from public.listings g
      cross join lateral(select app_private.immomio_application_target(g.raw,g.canonical_url) target) t
      where g.dedupe_group_id=l.dedupe_group_id and g.id<>c.id
        and g.is_active=true and g.quality_status<>'rejected'
        and t.target->>'status'='resolved' and t.target->>'source_identifier'<>v_sid
    ))
  order by (l.dedupe_group_id=v_old_group) desc nulls last,l.first_seen_at,l.id limit 1;

  if v_group is null and v_old_group is not null
     and exists(select 1 from public.listing_dedupe_groups where id=v_old_group)
     and (v_sid is null or not exists(
       select 1 from public.listings g
       cross join lateral(select app_private.immomio_application_target(g.raw,g.canonical_url) target)t
       where g.dedupe_group_id=v_old_group and g.id<>c.id
         and g.is_active=true and g.quality_status<>'rejected'
         and t.target->>'status'='resolved' and t.target->>'source_identifier'<>v_sid
     )) then
    v_group:=v_old_group;
  end if;
  if v_group is null then
    insert into public.listing_dedupe_groups default values returning id into v_group;
  end if;
  update public.listings set dedupe_group_id=v_group
  where id=c.id and dedupe_group_id is distinct from v_group;

  if v_old_group is not null and v_old_group<>v_group then
    perform app_private.refresh_listing_dedupe_group(v_old_group);
  end if;
  -- Use the existing stable, completeness-aware winner policy everywhere.
  v_winner:=app_private.refresh_listing_dedupe_group(v_group);
  update public.listings set dedupe_match_reason=case when id=v_winner then 'primary' else 'duplicate' end
  where dedupe_group_id=v_group
    and dedupe_match_reason is distinct from (case when id=v_winner then 'primary' else 'duplicate' end);

  update public.delivery_events de
  set status='skipped',next_retry_at=null,error_message='Deduplicated in favor of preferred listing'
  from public.listings dl
  where de.listing_id=dl.id and dl.dedupe_group_id=v_group and dl.id<>v_winner
    and de.status in ('pending','failed') and not coalesce(de.delivery_outcome_unknown,false);
  return v_group;
end $fn$;
revoke all on function app_private.assign_listing_dedupe(uuid) from public,anon,authenticated;
grant execute on function app_private.assign_listing_dedupe(uuid) to service_role;