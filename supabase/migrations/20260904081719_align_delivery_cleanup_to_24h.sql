create or replace function app_private.prepare_current_delivery_queue()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with stopped as (
    update public.delivery_events de
    set status = 'skipped',
        next_retry_at = null,
        error_message = case
          when s.baseline_completed_at is null or s.baseline_completed_at > l.first_seen_at then 'baseline inventory blocked by current-only dispatch guard'
          when not coalesce(l.is_active, false) then 'inactive listing blocked by current-only dispatch guard'
          when not coalesce(l.fresh_delivery_eligible, false) then 'unverified freshness blocked by current-only dispatch guard'
          when de.created_at - l.first_seen_at > interval '24 hours' then 'stale replay blocked by current-only dispatch guard'
          else 'stale listing blocked by current-only dispatch guard'
        end
    from public.listings l
    join public.sources s on s.id = l.source_id
    where l.id = de.listing_id
      and de.event_type = 'new_listing'
      and de.status in ('pending', 'failed')
      and (
        s.baseline_completed_at is null
        or s.baseline_completed_at > l.first_seen_at
        or not coalesce(l.is_active, false)
        or not coalesce(l.fresh_delivery_eligible, false)
        or de.created_at - l.first_seen_at > interval '24 hours'
        or now() - l.first_seen_at > case coalesce((select np.delivery_mode from public.notification_preferences np where np.profile_id = de.profile_id), 'instant')
          when 'daily_digest' then interval '26 hours'
          when 'hourly_digest' then interval '24 hours'
          else interval '24 hours'
        end
      )
    returning de.id
  )
  select count(*) into v_count from stopped;
  return v_count;
end;
$$;
