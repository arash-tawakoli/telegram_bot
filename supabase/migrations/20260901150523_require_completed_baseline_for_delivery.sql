create or replace function app_private.enforce_current_delivery_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_first_seen_at timestamptz;
  v_is_active boolean;
  v_baseline_completed_at timestamptz;
begin
  if coalesce(new.event_type, 'new_listing') <> 'new_listing' then return new; end if;
  select l.first_seen_at,l.is_active,s.baseline_completed_at into v_first_seen_at,v_is_active,v_baseline_completed_at
  from public.listings l join public.sources s on s.id=l.source_id where l.id=new.listing_id;
  if not found then return new; end if;
  if v_baseline_completed_at is null
     or v_baseline_completed_at > v_first_seen_at
     or not coalesce(v_is_active,false)
     or coalesce(new.created_at,now())-v_first_seen_at > interval '3 hours' then
    new.status := 'skipped';
    new.next_retry_at := null;
    new.error_message := case
      when v_baseline_completed_at is null or v_baseline_completed_at > v_first_seen_at then 'baseline inventory blocked by current-only delivery guard'
      when not coalesce(v_is_active,false) then 'inactive listing blocked by current-only delivery guard'
      else 'stale listing blocked by current-only delivery guard'
    end;
  end if;
  return new;
end;
$$;

create or replace function app_private.prepare_current_delivery_queue()
returns integer
language plpgsql
set search_path = ''
as $$
declare v_count integer;
begin
  with stopped as (
    update public.delivery_events de
    set status='skipped',next_retry_at=null,
        error_message=case
          when s.baseline_completed_at is null or s.baseline_completed_at > l.first_seen_at then 'baseline inventory blocked by current-only dispatch guard'
          when not coalesce(l.is_active,false) then 'inactive listing blocked by current-only dispatch guard'
          when not coalesce(l.fresh_delivery_eligible,false) then 'unverified freshness blocked by current-only dispatch guard'
          else 'stale replay blocked by current-only dispatch guard'
        end
    from public.listings l join public.sources s on s.id=l.source_id
    where l.id=de.listing_id
      and de.event_type='new_listing'
      and de.status in ('pending','failed')
      and (s.baseline_completed_at is null or s.baseline_completed_at > l.first_seen_at or not coalesce(l.is_active,false) or not coalesce(l.fresh_delivery_eligible,false) or de.created_at-l.first_seen_at>interval '3 hours')
    returning de.id
  ) select count(*) into v_count from stopped;
  return v_count;
end;
$$;

select app_private.prepare_current_delivery_queue();
