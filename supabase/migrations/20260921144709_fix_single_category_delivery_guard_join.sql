-- Correct the UPDATE ... FROM scope used by the delivery guard.

CREATE OR REPLACE FUNCTION app_private.prepare_current_delivery_queue()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with stopped as (
    update public.delivery_events de
    set status='skipped',
        next_retry_at=null,
        error_message=case
          when not coalesce(p.is_active,false) then 'inactive search profile blocked by delivery guard'
          when p.profile_slot>1 and not app_private.user_is_premium(p.user_id) then 'profile slot requires premium'
          when not coalesce(l.is_active,false) then 'inactive listing blocked by delivery guard'
          when coalesce(l.quality_status,'unchecked')='rejected' then 'rejected listing blocked by delivery guard'
          when not coalesce(l.is_primary_listing,false) then 'deduplicated listing blocked by delivery guard'
          when not coalesce(s.enabled,false) or s.runtime_mode<>'live' or s.delivery_mode<>'live'
            then 'source not live blocked by delivery guard'
          when not app_private.matches_property_filters(p,l)
            then 'listing no longer matches current profile/category filters'
          else 'listing is not qualified as <=24h new inventory'
        end
    from public.listings l, public.sources s, public.search_profiles p
    where l.id=de.listing_id
      and s.id=l.source_id
      and p.id=de.profile_id
      and de.status in ('pending','failed')
      and coalesce(de.delivery_outcome_unknown,false)=false
      and (
        not coalesce(p.is_active,false)
        or (p.profile_slot>1 and not app_private.user_is_premium(p.user_id))
        or not coalesce(l.is_active,false)
        or coalesce(l.quality_status,'unchecked')='rejected'
        or not coalesce(l.is_primary_listing,false)
        or not coalesce(s.enabled,false)
        or s.runtime_mode<>'live'
        or s.delivery_mode<>'live'
        or not app_private.matches_property_filters(p,l)
        or (
          coalesce(de.event_type,'new_listing')='new_listing'
          and not app_private.delivery_newness_qualified(l.id,statement_timestamp())
        )
      )
    returning de.id
  )
  select count(*) into v_count from stopped;

  return v_count;
end;
$function$
;