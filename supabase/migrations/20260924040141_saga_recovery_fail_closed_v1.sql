
create or replace function app_private.saga_recovery_probe_candidate_id()
returns uuid
language sql
stable
set search_path to ''
as $function$
  select l.id
  from public.listings l
  join public.sources s on s.id=l.source_id
  where l.source_id in (1,3)
    and l.is_active=true
    and coalesce(l.is_primary_listing,false)=true
    and coalesce(l.quality_status,'unchecked')<>'rejected'
    and l.first_seen_at < statement_timestamp()-interval '24 hours'
    and l.last_seen_at >= statement_timestamp()-interval '30 minutes'
    and s.enabled=true and s.runtime_mode='live' and s.delivery_mode='live'
    and l.raw->>'provider_entity'='SAGA'
    and app_private.saga_object_ref(l.raw,l.enrichment_evidence) is not null
    and coalesce(l.raw->>'applicationLink',l.enrichment_evidence#>>'{saga_probe,application_url}') ~* '^https://tenant[.]immomio[.]com/(de/)?apply/[0-9a-f-]{36}/?$'
    and (
      l.enrichment_evidence#>>'{saga_probe,status}' is null
      or (
        l.enrichment_evidence#>>'{saga_probe,status}'='error'
        and coalesce((l.enrichment_evidence#>>'{saga_probe,next_check_at}')::timestamptz,'-infinity'::timestamptz)<=statement_timestamp()
      )
    )
    and exists (
      select 1
      from public.search_profiles p
      join public.bot_users u on u.id=p.user_id and u.is_active=true
      where p.is_active=true
        and (p.profile_slot=1 or app_private.user_is_premium(p.user_id))
        and app_private.matches_property_filters(p,l)
        and not exists (
          select 1
          from public.delivery_events de
          join public.listings oldl on oldl.id=de.listing_id
          where de.recipient_user_id=p.user_id
            and de.status='sent'
            and (
              oldl.dedupe_group_id=l.dedupe_group_id
              or app_private.saga_object_ref(oldl.raw,oldl.enrichment_evidence)
                 =app_private.saga_object_ref(l.raw,l.enrichment_evidence)
            )
        )
    )
  order by l.first_seen_at desc,l.id
  limit 1;
$function$;
