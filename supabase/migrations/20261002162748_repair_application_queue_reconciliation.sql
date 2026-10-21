-- RECONSTRUCTED EQUIVALENT from the live catalog captured 2026-10-21.
-- Original historical SQL bytes were not recoverable; this migration restores the observed contract.

CREATE OR REPLACE FUNCTION app_private.reconcile_recent_user_applications(p_user uuid, p_provider text DEFAULT NULL::text, p_window interval DEFAULT '48:00:00'::interval, p_limit integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer := 0;
  v_window interval;
begin
  if p_user is null then
    return 0;
  end if;
  if p_provider is not null
     and p_provider not in ('immoscout','kleinanzeigen','immowelt','immomio')
  then
    raise exception 'invalid_provider';
  end if;
  if p_limit is not null and p_limit < 0 then
    raise exception 'invalid_limit';
  end if;

  v_window := least(coalesce(p_window, interval '48 hours'), interval '168 hours');
  if v_window <= interval '0' then
    return 0;
  end if;

  with candidates as (
    select distinct on (u.id,l.id)
      u.id as user_id,
      l.id as listing_id,
      l.source_id,
      d.created_at
    from public.delivery_events d
    join public.bot_users u on u.id=d.recipient_user_id
    join public.listings l on l.id=d.listing_id
    join public.sources s on s.id=l.source_id
    cross join lateral (
      select app_private.application_provider_target(l.source_id,l.raw,l.canonical_url) as provider
    ) target
    where u.id=p_user
      and d.event_type='new_listing'
      and d.channel='telegram'
      and d.status in ('pending','processing','sent')
      and coalesce(d.delivery_outcome_unknown,false)=false
      and d.created_at >= clock_timestamp()-v_window
      and target.provider is not null
      and (p_provider is null or target.provider=p_provider)
      and app_private.delivery_newness_qualified(l.id,statement_timestamp())
      and u.is_active
      and app_private.user_is_premium(u.id)
      and app_private.applicant_profile_identity_ready(u.id)
      and app_private.application_provider_preference_enabled(u.id,target.provider)
      and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
      and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
      and l.is_active
      and coalesce(l.quality_status,'unchecked')<>'rejected'
      and coalesce(l.is_primary_listing,false)
      and s.enabled
      and s.runtime_mode='live'
      and s.delivery_mode='live'
    order by u.id,l.id,d.created_at desc
  ), limited as (
    select *
    from candidates
    order by created_at desc
    limit coalesce(p_limit,2147483647)
  )
  insert into public.applications(user_id,listing_id,source_id)
  select user_id,listing_id,source_id
  from limited
  on conflict(user_id,listing_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$function$;

CREATE OR REPLACE FUNCTION app_private.reconcile_applications_after_connection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status='connected'
     and (tg_op='INSERT' or old.status is distinct from 'connected')
  then
    perform app_private.reconcile_recent_user_applications(
      new.user_id,new.provider,interval '48 hours',null
    );
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_listing_applications(p_listing_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_inserted integer := 0;
begin
  insert into public.applications(user_id,listing_id,source_id)
  select distinct u.id,l.id,l.source_id
  from public.listings l
  join public.sources s on s.id=l.source_id
  join public.delivery_events d on d.listing_id=l.id
  join public.bot_users u on u.id=d.recipient_user_id
  cross join lateral (
    select app_private.application_provider_target(l.source_id,l.raw,l.canonical_url) as provider
  ) target
  where l.id=p_listing_id
    and target.provider is not null
    and d.event_type='new_listing'
    and d.channel='telegram'
    and d.status in ('pending','processing','sent')
    and coalesce(d.delivery_outcome_unknown,false)=false
    and app_private.delivery_newness_qualified(l.id,statement_timestamp())
    and u.is_active
    and app_private.user_is_premium(u.id)
    and app_private.applicant_profile_identity_ready(u.id)
    and app_private.application_provider_preference_enabled(u.id,target.provider)
    and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
    and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
    and l.is_active
    and coalesce(l.quality_status,'unchecked')<>'rejected'
    and coalesce(l.is_primary_listing,false)
    and s.enabled
    and s.runtime_mode='live'
    and s.delivery_mode='live'
  on conflict(user_id,listing_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end
$function$;

drop trigger if exists platform_connections_reconcile_applications on public.platform_connections;
create trigger platform_connections_reconcile_applications
after insert or update of status on public.platform_connections
for each row execute function app_private.reconcile_applications_after_connection();

revoke all on function app_private.reconcile_recent_user_applications(uuid,text,interval,integer) from public, anon, authenticated;
grant execute on function app_private.reconcile_recent_user_applications(uuid,text,interval,integer) to service_role;
revoke all on function app_private.reconcile_applications_after_connection() from public, anon, authenticated;
grant execute on function app_private.reconcile_applications_after_connection() to service_role;
revoke all on function public.reconcile_listing_applications(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_listing_applications(uuid) to service_role;
