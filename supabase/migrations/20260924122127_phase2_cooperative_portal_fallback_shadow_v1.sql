
-- Phase 2 QA: verified Immowelt provider profiles as additive/fallback inventory.
-- runtime live + delivery shadow means crawl/observe without Telegram delivery.

insert into public.source_connectors(
  id,source_id,priority,label,connector_kind,config,enabled,evidence_tier,
  connector_role,enumerable,shadow_only
)
overriding system value
values
(192,67,2,'Immowelt provider profile','html_discovery',
 '{"url":"https://www.immowelt.de/profil/e66e6ca2c4a3824f880a62edc64a0a7c","audit_role":"portal_provider_inventory_shadow","portal":"immowelt","provider_entity":"NEUE LÜBECKER","hamburg_only":true,"residential_only":true,"audited_at":"2026-09-24"}'::jsonb,
 true,'K2','fallback',true,false),
(193,45,3,'Immowelt provider profile','html_discovery',
 '{"url":"https://www.immowelt.de/profil/9e80843783eb4e4e973b973bbae3aa8c","audit_role":"portal_provider_inventory_shadow","portal":"immowelt","provider_entity":"FLUWOG-NORDMARK","hamburg_only":true,"residential_only":true,"audited_at":"2026-09-24"}'::jsonb,
 true,'K2','fallback',true,false),
(194,56,3,'Immowelt provider profile','html_discovery',
 '{"url":"https://www.immowelt.de/profil/96eb8219ea0d4474abb2920db81099ff","audit_role":"portal_provider_inventory_shadow","portal":"immowelt","provider_entity":"WHW 1897","hamburg_only":true,"residential_only":true,"audited_at":"2026-09-24"}'::jsonb,
 true,'K2','fallback',true,false)
on conflict(source_id,priority) do update set
  label=excluded.label,
  connector_kind=excluded.connector_kind,
  config=excluded.config,
  enabled=true,
  evidence_tier='K2',
  connector_role='fallback',
  enumerable=true,
  shadow_only=false,
  updated_at=now();

update public.source_connectors
set config='{"url":"https://www.immowelt.de/profil/c8c597a6f6074b2c99b9af2b68a3d69d","audit_role":"portal_provider_inventory_shadow","portal":"immowelt","provider_entity":"ADLERSHORST","hamburg_only":true,"residential_only":true,"audited_at":"2026-09-24"}'::jsonb,
    enabled=true,
    evidence_tier='K2',
    connector_role='fallback',
    enumerable=true,
    shadow_only=false,
    updated_at=now()
where id=190 and source_id=68;

update public.sources
set enabled=true,
    runtime_mode='live',
    delivery_mode='shadow',
    updated_at=now()
where id in (45,56,67,68);

select setval(pg_get_serial_sequence('public.source_connectors','id'),greatest((select max(id) from public.source_connectors),194),true);
