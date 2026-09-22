update public.sources
set runtime_mode='shadow', delivery_mode='shadow', updated_at=now()
where id in (44,45,55);

update public.source_connectors
set shadow_only=true,
    enumerable=false,
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'audit_role','tenant_pool_registration_only',
      'immomio_inventory_public',false,
      'verified_at','2026-09-22'
    ),
    updated_at=now()
where source_id in (44,45,55,56)
  and priority=1;

update public.source_connectors
set config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'immomio_registration_role','tenant_pool_only',
      'immomio_inventory_public',false,
      'verified_at','2026-09-22'
    ),
    updated_at=now()
where source_id=42 and priority=1;

update public.sources
set search_url='https://buchdrucker.immomio.de/immobilien/',
    updated_at=now()
where id=60;

update public.source_connectors
set shadow_only=true,
    enumerable=false,
    config=coalesce(config,'{}'::jsonb) || jsonb_build_object(
      'audit_role','tenant_pool_registration_only',
      'immomio_inventory_public',false,
      'verified_at','2026-09-22'
    ),
    updated_at=now()
where source_id=60 and priority=1;

update public.source_connectors
set enabled=true,
    shadow_only=true,
    enumerable=true,
    label='WP-ImmoMakler Immobilien-Feed (Shadow)',
    config=jsonb_build_object(
      'url','https://buchdrucker.immomio.de/immobilien/feed/',
      'audit_role','verified_public_inventory_feed_shadow',
      'verified_empty_pattern','rss_channel_without_item',
      'verified_at','2026-09-22'
    ),
    updated_at=now()
where source_id=60 and priority=2;

update public.source_connectors
set enabled=true,
    shadow_only=true,
    enumerable=true,
    label='WP-ImmoMakler Immobilien-Modul (Shadow)',
    config=jsonb_build_object(
      'url','https://buchdrucker.immomio.de/immobilien/',
      'no_offer_patterns',jsonb_build_array('0 Treffer anzeigen'),
      'audit_role','verified_public_inventory_html_shadow',
      'immomio_redirect_host','rdr.immomio.com',
      'verified_at','2026-09-22'
    ),
    updated_at=now()
where source_id=60 and priority=3;
