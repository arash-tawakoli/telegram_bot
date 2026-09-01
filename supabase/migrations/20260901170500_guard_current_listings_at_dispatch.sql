-- Preserve verified fresh-lane evidence and reject stale/unverified events before dispatch.

create or replace function app_private.enforce_current_source_freshness()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_preserve_fresh boolean := false;
begin
  if not coalesce(new.fresh_delivery_eligible, false) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_preserve_fresh := coalesce(old.fresh_delivery_eligible, false)
      and (
        coalesce(old.raw ->> 'delivery_lane', '') = 'fresh'
        or (old.source_id = 1 and lower(coalesce(old.raw ->> 'query', '')) like '%neueste inserate%')
        or (old.source_id = 2 and coalesce(old.raw ->> 'lane', '') = 'fast')
        or (old.source_id = 3 and lower(coalesce(old.raw ->> 'is_new', 'false')) = 'true')
      );
  end if;

  if new.source_id = 1 then
    if lower(coalesce(new.raw ->> 'query', '')) like '%neueste inserate%' or v_preserve_fresh then
      new.raw := coalesce(new.raw, '{}'::jsonb) || jsonb_build_object('delivery_lane', 'fresh');
    else
      new.fresh_delivery_eligible := false;
    end if;
  elsif new.source_id = 2 then
    if coalesce(new.raw ->> 'lane', '') = 'fast' or v_preserve_fresh then
      new.raw := coalesce(new.raw, '{}'::jsonb) || jsonb_build_object('delivery_lane', 'fresh');
    else
      new.fresh_delivery_eligible := false;
    end if;
  elsif new.source_id = 3 then
    if lower(coalesce(new.raw ->> 'is_new', 'false')) = 'true' or v_preserve_fresh then
      new.raw := coalesce(new.raw, '{}'::jsonb) || jsonb_build_object('delivery_lane', 'fresh');
    else
      new.fresh_delivery_eligible := false;
    end if;
  end if;

  return new;
end;
$$;

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
          when not coalesce(l.is_active, false) then 'inactive listing blocked by current-only dispatch guard'
          when not coalesce(l.fresh_delivery_eligible, false) then 'unverified freshness blocked by current-only dispatch guard'
          else 'stale replay blocked by current-only dispatch guard'
        end
    from public.listings l
    where l.id = de.listing_id
      and de.event_type = 'new_listing'
      and de.status in ('pending', 'failed')
      and (
        not coalesce(l.is_active, false)
        or not coalesce(l.fresh_delivery_eligible, false)
        or de.created_at - l.first_seen_at > interval '3 hours'
      )
    returning de.id
  )
  select count(*) into v_count from stopped;

  return v_count;
end;
$$;

select app_private.prepare_current_delivery_queue();

select cron.alter_job(
  job_id := 4,
  command := $command$
  select app_private.prepare_current_delivery_queue();
  select net.http_post(
    url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/notification-dispatcher',
    headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
    body:=jsonb_build_object('time',now()),
    timeout_milliseconds:=45000
  );
  $command$
);
