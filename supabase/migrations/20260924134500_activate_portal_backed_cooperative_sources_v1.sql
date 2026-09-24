-- Activate every currently qualifiable cooperative source without inventing
-- a public inventory feed where only registration/portal discovery exists.

update public.sources
set enabled=true,
    runtime_mode='live',
    delivery_mode='live',
    coverage_status='partial',
    coverage_strategy='portal_registry_mirror',
    poll_interval_minutes=60,
    baseline_completed_at=coalesce(baseline_completed_at,now()),
    warmed_up=true,
    consecutive_failures=0,
    last_checked_at=null,
    notes=case name
      when 'NEUE LÜBECKER' then
        'Live via shared Immowelt/ImmoScout cooperative-provider registry. Official inventory remains preferred evidence but is currently not reliably fetchable from Supabase Edge; direct connector retained as monitoring metadata. Portal delivery remains Hamburg/residential/exact-provider gated.'
      when 'FLUWOG-NORDMARK' then
        'Live via shared Immowelt/ImmoScout cooperative-provider registry. Official Immomio path is registration-only, not enumerable inventory; no redundant direct polling.'
      when 'Gartenstadt Hamburg' then
        'Live via shared Immowelt/ImmoScout cooperative-provider registry. Official Immomio path is registration-only, not enumerable inventory; no redundant direct polling.'
      when 'WG von 1904' then
        'Live via shared Immowelt/ImmoScout cooperative-provider registry. Official Immomio path is registration-only, not enumerable inventory; no redundant direct polling.'
      when 'WHW 1897' then
        'Live via shared Immowelt/ImmoScout cooperative-provider registry. Productive discovery is restricted to the existing Hamburg residential portal lanes; provider-profile commercial inventory is not crawled directly.'
      else notes
    end,
    updated_at=now()
where source_type='Baugenossenschaft'
  and name in (
    'FLUWOG-NORDMARK',
    'Gartenstadt Hamburg',
    'NEUE LÜBECKER',
    'WG von 1904',
    'WHW 1897'
  );

update public.sources
set enabled=true,
    runtime_mode='live',
    delivery_mode='live',
    coverage_status='partial',
    coverage_strategy='official_primary_portal_fallback_live',
    poll_interval_minutes=10,
    baseline_completed_at=coalesce(baseline_completed_at,now()),
    warmed_up=true,
    consecutive_failures=0,
    last_checked_at=null,
    notes='Live. Official free-apartment page remains the direct monitor; shared Immowelt/ImmoScout cooperative-provider registry provides productive Hamburg residential fallback. Existing baseline is suppressed.',
    updated_at=now()
where source_type='Baugenossenschaft'
  and name='ADLERSHORST';

update public.source_connectors sc
set shadow_only=true,
    connector_role='monitoring',
    updated_at=now()
where sc.source_id in (
  select s.id
  from public.sources s
  where s.source_type='Baugenossenschaft'
    and s.name in (
      'FLUWOG-NORDMARK',
      'Gartenstadt Hamburg',
      'NEUE LÜBECKER',
      'WG von 1904',
      'WHW 1897'
    )
);

update public.listings l
set fresh_delivery_eligible=false
where l.source_id in (
  select s.id
  from public.sources s
  where s.source_type='Baugenossenschaft'
    and s.name in (
      'ADLERSHORST',
      'FLUWOG-NORDMARK',
      'Gartenstadt Hamburg',
      'NEUE LÜBECKER',
      'WG von 1904',
      'WHW 1897'
    )
);

update public.sources
set enabled=false,
    runtime_mode='shadow',
    delivery_mode='shadow',
    coverage_status='unknown',
    updated_at=now()
where source_type='Baugenossenschaft'
  and name in ('Falkenried-Terrassen','Wohnwarft eG');
