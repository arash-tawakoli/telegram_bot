-- Phase 1: cooperative source hierarchy cleanup.
-- Safe changes only: source roles, shadow/live state, and source metadata.
-- No portal-detail enrichment or delivery algorithm changes in this migration.

update public.source_connectors
set connector_role='monitoring',
    label='Immomio registration only (no public inventory)',
    evidence_tier='K2',
    shadow_only=true,
    enumerable=false,
    updated_at=now()
where id=170;

update public.source_connectors
set connector_role='primary',
    label='Official WP-ImmoMakler feed + verified Immomio Apply',
    evidence_tier='K1',
    shadow_only=false,
    enumerable=true,
    enabled=true,
    updated_at=now()
where id=171;

update public.source_connectors
set connector_role='fallback',
    shadow_only=true,
    updated_at=now()
where id=172;

update public.listings
set fresh_delivery_eligible=false
where source_id=60;

update public.sources
set runtime_mode='live',
    delivery_mode='live',
    coverage_status='complete',
    coverage_strategy='full_page',
    notes='Official public inventory feed verified in controlled shadow-delivery QA on 2026-09-24. Feed resolves tenant.immomio.com/apply targets. Existing baseline suppressed; only future fresh inventory is deliverable.',
    updated_at=now()
where id=60;

update public.source_connectors
set connector_role='monitoring',
    label='Immomio registration only (no public inventory)',
    shadow_only=true,
    enumerable=false,
    updated_at=now()
where id in (129,131,159,161);

update public.sources
set coverage_strategy='portal_fallback_shadow',
    notes=case id
      when 44 then 'Official site uses Immomio for applicant registration, but no public enumerable Immomio inventory is verified. Keep Shadow; portal fallback required.'
      when 45 then 'Official site uses Immomio for applicant registration, but no public enumerable Immomio inventory is verified. Keep Shadow; portal fallback required.'
      when 55 then 'Official site uses Immomio for applicant registration, but no public enumerable Immomio inventory is verified. Keep Shadow; portal fallback required.'
      when 56 then 'Immomio applicant registration exists, but no public enumerable inventory is verified. Source remains disabled/Shadow until portal fallback is qualified.'
      else notes end,
    updated_at=now()
where id in (44,45,55,56);

update public.sources
set coverage_strategy='official_primary_portal_fallback_shadow',
    notes='Official inventory is Primary in principle but currently fails from Supabase Edge with an HTTP/2 transport error. Keep Shadow. Immowelt/ImmoScout provider fallback will be added in Phase 2; no user delivery before QA.',
    runtime_mode='shadow',
    delivery_mode='shadow',
    updated_at=now()
where id=67;

update public.sources
set coverage_strategy='passive_registry',
    notes='No verified public online rental inventory. Keep disabled/Shadow; only passive portal-provider discovery should reactivate this source.',
    updated_at=now()
where id=59;

update public.sources
set coverage_strategy='offline_process',
    notes='No verified digital rental listing connector; official process is not suitable for automated polling. Keep disabled/Shadow and only react to a future verified provider listing.',
    updated_at=now()
where id=64;

insert into public.sources(
  id,source_type,name,tier,homepage_url,search_url,poll_interval_minutes,enabled,notes,
  button_label,delivery_mode,worker_slug,listing_priority,crawl_priority,coverage_strategy,
  runtime_mode,coverage_status,search_capabilities
)
overriding system value
values(
  68,'Baugenossenschaft','ADLERSHORST','K2',
  'https://www.adlershorst.de',
  'https://www.adlershorst.de/wohnen/fuer-wohnungssuchende/freie-wohnungen/',
  10,true,
  'Shadow only. Official free-apartment page is Primary. Hamburg stock is verified, but current public offers can also be outside Hamburg. No official public Immomio inventory verified. Portal provider profiles are fallback metadata only until Phase 2 Hamburg-only enrichment QA.',
  'ADLERSHORST','shadow','source-worker',6,68,
  'official_primary_portal_fallback_shadow','shadow','partial',
  '{"version":1,"evidence":"official_inventory_shadow","discovery":"official_inventory_plus_portal_fallback","offer_modes":["rent"],"configured_kinds":["apartment"],"additional_kinds_require_evidence":true}'::jsonb
)
on conflict(name) do update set
  homepage_url=excluded.homepage_url,
  search_url=excluded.search_url,
  notes=excluded.notes,
  runtime_mode='shadow',
  delivery_mode='shadow',
  worker_slug='source-worker',
  coverage_strategy=excluded.coverage_strategy,
  updated_at=now();

insert into public.source_connectors(
  id,source_id,priority,label,connector_kind,config,enabled,evidence_tier,
  connector_role,enumerable,shadow_only
)
overriding system value
select 189,id,1,'Official free apartments','html_discovery',
  '{"url":"https://www.adlershorst.de/wohnen/fuer-wohnungssuchende/freie-wohnungen/","audit_role":"official_inventory_shadow","hamburg_only":true,"audited_at":"2026-09-24"}'::jsonb,
  true,'K2','primary',true,false
from public.sources where name='ADLERSHORST'
on conflict(source_id,priority) do update set
  label=excluded.label,connector_kind=excluded.connector_kind,config=excluded.config,
  enabled=true,evidence_tier='K2',connector_role='primary',enumerable=true,shadow_only=false,updated_at=now();

insert into public.source_connectors(
  id,source_id,priority,label,connector_kind,config,enabled,evidence_tier,
  connector_role,enumerable,shadow_only
)
overriding system value
select 190,id,2,'Immowelt provider profile','html_discovery',
  '{"url":"https://www.immowelt.de/profil/c8c597a6f6074b2c99b9af2b68a3d69d","audit_role":"portal_provider_profile_metadata","provider_name":"ADLERSHORST Baugenossenschaft eG","portal":"immowelt","hamburg_only":true,"audited_at":"2026-09-24"}'::jsonb,
  false,'K2','monitoring',false,true
from public.sources where name='ADLERSHORST'
on conflict(source_id,priority) do update set
  label=excluded.label,config=excluded.config,enabled=false,connector_role='monitoring',enumerable=false,shadow_only=true,updated_at=now();

insert into public.source_connectors(
  id,source_id,priority,label,connector_kind,config,enabled,evidence_tier,
  connector_role,enumerable,shadow_only
)
overriding system value
select 191,id,3,'ImmoScout provider profile','html_discovery',
  '{"url":"https://www.immobilienscout24.de/anbieter/profil/adlershorst-baugenossenschaft-eg","audit_role":"portal_provider_profile_metadata","provider_name":"ADLERSHORST Baugenossenschaft eG","portal":"immoscout","hamburg_only":true,"audited_at":"2026-09-24"}'::jsonb,
  false,'K2','monitoring',false,true
from public.sources where name='ADLERSHORST'
on conflict(source_id,priority) do update set
  label=excluded.label,config=excluded.config,enabled=false,connector_role='monitoring',enumerable=false,shadow_only=true,updated_at=now();

select setval(pg_get_serial_sequence('public.sources','id'),greatest((select max(id) from public.sources),68),true);
select setval(pg_get_serial_sequence('public.source_connectors','id'),greatest((select max(id) from public.source_connectors),191),true);
