create or replace function app_private.enqueue_matched_application()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if coalesce(new.event_type,'new_listing') <> 'new_listing'
     or not app_private.delivery_newness_qualified(new.listing_id,statement_timestamp())
  then
    return new;
  end if;

  insert into public.applications(user_id, listing_id, source_id)
  select u.id, l.id, l.source_id
  from public.bot_users u
  join public.listings l on l.id=new.listing_id
  join public.sources s on s.id=l.source_id
  where u.id=new.recipient_user_id
    and u.is_active
    and app_private.user_is_premium(u.id)
    and app_private.applicant_profile_identity_ready(u.id)
    and (
      coalesce(new.channel,'telegram') <> 'telegram'
      or l.source_id not in (1,3)
      or coalesce(l.raw->>'portal_application_target_checked','')='true'
      or app_private.immomio_application_target(l.raw,l.canonical_url)->>'status'='resolved'
    )
    and app_private.application_provider_preference_enabled(
      u.id,
      app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)
    )
    and app_private.application_target_ready(u.id,l.source_id,l.raw,l.canonical_url)
    and app_private.application_listing_auto_apply_allowed(l.title,l.property_type,l.raw)
    and l.is_active
    and coalesce(l.quality_status,'unchecked')<>'rejected'
    and coalesce(l.is_primary_listing,false)
    and s.enabled
    and s.runtime_mode='live'
    and s.delivery_mode='live'
  on conflict(user_id,listing_id) do nothing;

  return new;
end
$function$;

create or replace function public.reconcile_listing_applications(p_listing_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_inserted integer := 0;
begin
  insert into public.applications(user_id,listing_id,source_id)
  select distinct u.id,l.id,l.source_id
  from public.listings l
  join public.sources s on s.id=l.source_id
  join public.delivery_events d on d.listing_id=l.id
  join public.bot_users u on u.id=d.recipient_user_id
  where l.id=p_listing_id
    and l.source_id in (1,3)
    and (
      coalesce(l.raw->>'portal_application_target_checked','')='true'
      or app_private.immomio_application_target(l.raw,l.canonical_url)->>'status'='resolved'
    )
    and d.event_type='new_listing'
    and d.channel='telegram'
    and d.status in ('pending','processing','sent')
    and coalesce(d.delivery_outcome_unknown,false)=false
    and app_private.delivery_newness_qualified(l.id,statement_timestamp())
    and u.is_active
    and app_private.user_is_premium(u.id)
    and app_private.applicant_profile_identity_ready(u.id)
    and app_private.application_provider_preference_enabled(
      u.id,
      app_private.application_provider_target(l.source_id,l.raw,l.canonical_url)
    )
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

revoke all on function public.reconcile_listing_applications(uuid) from public,anon,authenticated;
grant execute on function public.reconcile_listing_applications(uuid) to service_role;
