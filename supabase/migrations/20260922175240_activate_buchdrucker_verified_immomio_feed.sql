update public.sources
set enabled=true,
    runtime_mode='live',
    delivery_mode='live',
    last_checked_at=null,
    updated_at=now()
where id=60;

update public.source_connectors
set enabled=true,
    shadow_only=false,
    enumerable=true,
    label='WP-ImmoMakler + Immomio Apply',
    config=jsonb_build_object(
      'url','https://buchdrucker.immomio.de/immobilien/feed/',
      'adapter','source-worker/buchdrucker-public',
      'audit_role','verified_public_inventory_feed_live',
      'application_target_required',true,
      'application_target_host','tenant.immomio.com',
      'verified_at','2026-09-22'
    ),
    updated_at=now()
where source_id=60 and priority=2;
