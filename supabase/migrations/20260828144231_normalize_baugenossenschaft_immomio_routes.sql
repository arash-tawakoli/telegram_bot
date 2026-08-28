-- Keep every Baugenossenschaft with a verified Immomio tenant connector
-- on the strict, enumerable source-immomio path.

with immomio_bg as (
  select s.id
  from public.sources s
  join public.source_connectors sc on sc.source_id=s.id
  where s.source_type='Baugenossenschaft'
    and sc.priority=1
    and sc.enabled=true
    and sc.connector_kind='immomio_tenant'
)
update public.sources s
set worker_slug='source-immomio',
    last_error_at=null,
    consecutive_failures=0,
    updated_at=now()
from immomio_bg b
where s.id=b.id;

with immomio_bg as (
  select s.id
  from public.sources s
  join public.source_connectors sc on sc.source_id=s.id
  where s.source_type='Baugenossenschaft'
    and sc.priority=1
    and sc.connector_kind='immomio_tenant'
)
update public.source_connectors sc
set label='Immomio Tenant GraphQL',
    enabled=true,
    evidence_tier='K1',
    connector_role='primary',
    enumerable=true,
    shadow_only=false,
    updated_at=now()
from immomio_bg b
where sc.source_id=b.id and sc.priority=1;

with immomio_bg as (
  select s.id
  from public.sources s
  join public.source_connectors sc on sc.source_id=s.id
  where s.source_type='Baugenossenschaft'
    and sc.priority=1
    and sc.connector_kind='immomio_tenant'
)
update public.source_connectors sc
set enabled=false,
    evidence_tier='K3',
    connector_role='fallback',
    enumerable=false,
    shadow_only=true,
    updated_at=now()
from immomio_bg b
where sc.source_id=b.id and sc.priority<>1;
