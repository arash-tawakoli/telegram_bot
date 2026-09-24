create or replace function app_private.refresh_listing_dedupe_group(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare v_winner uuid;
begin
  if p_group_id is null then return null; end if;

  select l.id into v_winner
  from public.listings l
  join public.sources s on s.id=l.source_id
  where l.dedupe_group_id=p_group_id
    and l.is_active=true
    and l.quality_status<>'rejected'
  order by
    case
      when app_private.saga_object_ref(l.raw,l.enrichment_evidence) is not null
        then coalesce(l.fresh_delivery_eligible,false)::int
      else 0
    end desc,
    s.listing_priority asc,
    ((l.resolved_image_url is not null)::int+(l.address is not null)::int
     +(l.warm_rent is not null)::int+(l.cold_rent is not null)::int
     +(l.rooms is not null)::int+(l.area_sqm is not null)::int
     +(l.deposit is not null or l.deposit_text is not null)::int) desc,
    l.first_seen_at asc,l.id
  limit 1;

  update public.listings
  set is_primary_listing=(v_winner is not null and id=v_winner),
      duplicate_of_listing_id=case when v_winner is null or id=v_winner then null else v_winner end
  where dedupe_group_id=p_group_id
    and (is_primary_listing is distinct from (v_winner is not null and id=v_winner)
      or duplicate_of_listing_id is distinct from
         (case when v_winner is null or id=v_winner then null else v_winner end));

  update public.listing_dedupe_groups
  set preferred_listing_id=v_winner,updated_at=now()
  where id=p_group_id and preferred_listing_id is distinct from v_winner;

  return v_winner;
end;
$function$;
