update public.sources
set worker_slug='source-immomio',
    last_error_at=null,
    consecutive_failures=0,
    updated_at=now()
where id=35;

update public.source_connectors
set connector_kind='immomio_tenant',
    label='Immomio Tenant GraphQL',
    config=jsonb_build_object('url','https://www.walddoerfer.de/wohnungsangebote/aktuelle-angebote/'),
    enabled=true,
    evidence_tier='K1',
    connector_role='primary',
    enumerable=true,
    shadow_only=false,
    updated_at=now()
where source_id=35 and priority=1;

update public.source_connectors
set enabled=false,
    evidence_tier='K3',
    connector_role='fallback',
    enumerable=false,
    shadow_only=true,
    updated_at=now()
where source_id=35 and priority in (2,3);

delete from public.listings
where source_id=35
  and canonical_url='https://www.walddoerfer.de/wohnungsangebote/aktuelle-angebote/';
