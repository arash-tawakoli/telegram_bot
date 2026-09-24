
-- Direct Immowelt provider profile polling is blocked from Supabase Edge.
-- Keep the profile metadata, but do not poll it. Global Immowelt/Scout sources
-- remain the secondary discovery lane.

update public.source_connectors
set enabled=false,
    shadow_only=true,
    connector_role='monitoring',
    enumerable=false,
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'audit_role','portal_provider_profile_metadata',
      'edge_fetch_status','blocked_403',
      'audited_at','2026-09-24'
    ),
    updated_at=now()
where id in (192,193,194);

update public.source_connectors
set enabled=false,
    shadow_only=true,
    connector_role='monitoring',
    enumerable=false,
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'audit_role','portal_provider_profile_metadata',
      'audited_at','2026-09-24'
    ),
    updated_at=now()
where id=190;

update public.sources
set runtime_mode='shadow',delivery_mode='shadow',updated_at=now()
where id in (45,56,67);

-- ADLERSHORST official page itself is reachable; keep crawl active but delivery shadow.
update public.sources
set runtime_mode='live',delivery_mode='shadow',updated_at=now()
where id=68;
