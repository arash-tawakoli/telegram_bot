create or replace function app_private.reconcile_listing_duplicates(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.listings%rowtype;
  v_group uuid;
  v_winner uuid;
  v_reason text := 'singleton';
  v_merge record;
begin
  select * into c from public.listings where id=p_listing_id for update;
  if not found or c.quality_status='rejected' or not c.enrichment_delivery_eligible then return null; end if;

  select z.group_id,z.reason into v_group,v_reason
  from (
    select l.dedupe_group_id as group_id,
      case
        when c.cross_source_hash is not null and l.cross_source_hash=c.cross_source_hash then 'cross_source_hash'
        when length(app_private.normalized_listing_address(c.address))>=6 and app_private.normalized_listing_address(c.address)=app_private.normalized_listing_address(l.address) then 'exact_address'
        else 'property_signature'
      end reason,
      coalesce(dg.created_at,now()) group_created
    from public.listings l
    left join public.listing_dedupe_groups dg on dg.id=l.dedupe_group_id
    where l.id<>c.id and l.is_active=true and l.quality_status<>'rejected' and l.enrichment_delivery_eligible=true
      and (
        (c.cross_source_hash is not null and l.cross_source_hash=c.cross_source_hash)
        or (
          length(app_private.normalized_listing_address(c.address))>=6
          and app_private.normalized_listing_address(c.address)=app_private.normalized_listing_address(l.address)
          and (c.rooms is null or l.rooms is null or abs(c.rooms-l.rooms)<=0.5)
          and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm-l.area_sqm)<=3)
        )
        or (
          c.postal_code is not null and c.postal_code=l.postal_code
          and c.rooms is not null and l.rooms is not null and abs(c.rooms-l.rooms)<=0.25
          and c.area_sqm is not null and l.area_sqm is not null and abs(c.area_sqm-l.area_sqm)<=2
          and (coalesce(c.warm_rent,c.cold_rent) is null or coalesce(l.warm_rent,l.cold_rent) is null or abs(coalesce(c.warm_rent,c.cold_rent)-coalesce(l.warm_rent,l.cold_rent))<=greatest(25,least(coalesce(c.warm_rent,c.cold_rent),coalesce(l.warm_rent,l.cold_rent))*0.05))
          and extensions.similarity(lower(regexp_replace(coalesce(c.title,''),'[^[:alnum:]äöüß ]','','g')),lower(regexp_replace(coalesce(l.title,''),'[^[:alnum:]äöüß ]','','g'))) >= case when c.source_id in (1,2,3,16) or l.source_id in (1,2,3,16) then 0.48 else 0.58 end
        )
      )
  ) z
  where z.group_id is not null
  order by z.group_created
  limit 1;

  if v_group is null and c.dedupe_group_id is not null then v_group:=c.dedupe_group_id; end if;
  if v_group is null then insert into public.listing_dedupe_groups default values returning id into v_group; end if;

  for v_merge in
    select distinct l.dedupe_group_id id
    from public.listings l
    where l.id<>c.id and l.dedupe_group_id is not null and l.dedupe_group_id<>v_group and l.is_active=true and l.quality_status<>'rejected'
      and (
        (c.cross_source_hash is not null and l.cross_source_hash=c.cross_source_hash)
        or (length(app_private.normalized_listing_address(c.address))>=6 and app_private.normalized_listing_address(c.address)=app_private.normalized_listing_address(l.address) and (c.rooms is null or l.rooms is null or abs(c.rooms-l.rooms)<=0.5) and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm-l.area_sqm)<=3))
        or (c.postal_code is not null and c.postal_code=l.postal_code and c.rooms is not null and l.rooms is not null and abs(c.rooms-l.rooms)<=0.25 and c.area_sqm is not null and l.area_sqm is not null and abs(c.area_sqm-l.area_sqm)<=2 and extensions.similarity(lower(regexp_replace(coalesce(c.title,''),'[^[:alnum:]äöüß ]','','g')),lower(regexp_replace(coalesce(l.title,''),'[^[:alnum:]äöüß ]','','g'))) >= case when c.source_id in (1,2,3,16) or l.source_id in (1,2,3,16) then 0.48 else 0.58 end)
      )
  loop
    update public.listings set dedupe_group_id=v_group where dedupe_group_id=v_merge.id;
    delete from public.listing_dedupe_groups where id=v_merge.id;
  end loop;

  update public.listings set dedupe_group_id=v_group,dedupe_match_reason=v_reason where id=c.id;
  update public.listings l set dedupe_group_id=v_group,dedupe_match_reason=case when c.cross_source_hash is not null and l.cross_source_hash=c.cross_source_hash then 'cross_source_hash' when length(app_private.normalized_listing_address(c.address))>=6 and app_private.normalized_listing_address(c.address)=app_private.normalized_listing_address(l.address) then 'exact_address' else 'property_signature' end
  where l.id<>c.id and l.dedupe_group_id is null and l.is_active=true and l.quality_status<>'rejected' and l.enrichment_delivery_eligible=true
    and (
      (c.cross_source_hash is not null and l.cross_source_hash=c.cross_source_hash)
      or (length(app_private.normalized_listing_address(c.address))>=6 and app_private.normalized_listing_address(c.address)=app_private.normalized_listing_address(l.address) and (c.rooms is null or l.rooms is null or abs(c.rooms-l.rooms)<=0.5) and (c.area_sqm is null or l.area_sqm is null or abs(c.area_sqm-l.area_sqm)<=3))
      or (c.postal_code is not null and c.postal_code=l.postal_code and c.rooms is not null and l.rooms is not null and abs(c.rooms-l.rooms)<=0.25 and c.area_sqm is not null and l.area_sqm is not null and abs(c.area_sqm-l.area_sqm)<=2 and (coalesce(c.warm_rent,c.cold_rent) is null or coalesce(l.warm_rent,l.cold_rent) is null or abs(coalesce(c.warm_rent,c.cold_rent)-coalesce(l.warm_rent,l.cold_rent))<=greatest(25,least(coalesce(c.warm_rent,c.cold_rent),coalesce(l.warm_rent,l.cold_rent))*0.05)) and extensions.similarity(lower(regexp_replace(coalesce(c.title,''),'[^[:alnum:]äöüß ]','','g')),lower(regexp_replace(coalesce(l.title,''),'[^[:alnum:]äöüß ]','','g'))) >= case when c.source_id in (1,2,3,16) or l.source_id in (1,2,3,16) then 0.48 else 0.58 end)
    );

  v_winner:=app_private.refresh_listing_dedupe_group(v_group);
  if v_winner is not null then
    update public.matches set status='suppressed',updated_at=now() where listing_id in(select id from public.listings where dedupe_group_id=v_group and id<>v_winner) and status='matched';
    update public.delivery_events set status='skipped',next_retry_at=null,error_message='Suppressed by higher-priority duplicate' where listing_id in(select id from public.listings where dedupe_group_id=v_group and id<>v_winner) and status in('pending','failed');
  end if;
  return v_group;
end;
$$;
revoke all on function app_private.reconcile_listing_duplicates(uuid) from public,anon,authenticated;
grant execute on function app_private.reconcile_listing_duplicates(uuid) to service_role;
