begin;

update public.sources
set search_url='https://suche.schiffszimmerer.de/', coverage_status='partial', baseline_completed_at=null,
    last_checked_at='1970-01-01'::timestamptz, updated_at=now()
where id=40;
update public.source_connectors
set label='Schiffszimmerer Suchfrontend', connector_kind='html_discovery', enumerable=false, shadow_only=false,
    enabled=true, evidence_tier='K2', connector_role='primary', config=jsonb_build_object('url','https://suche.schiffszimmerer.de/'), updated_at=now()
where id=117;
update public.source_connectors set enabled=false, shadow_only=true, connector_role='fallback', updated_at=now() where id in (118,119);

update public.sources
set search_url='https://www.gartenstadt-hamburg.de/angebote/', coverage_status='partial', baseline_completed_at=null,
    last_checked_at='1970-01-01'::timestamptz, updated_at=now()
where id=44;
update public.source_connectors
set label='Offizielle Immomio-Registrierungsseite', connector_kind='html_discovery', enumerable=false, shadow_only=false,
    enabled=true, evidence_tier='K2', connector_role='primary',
    config=jsonb_build_object('url','https://www.gartenstadt-hamburg.de/angebote/','no_offer_patterns',jsonb_build_array('Bei der Vermietung unserer Wohnungen arbeiten wir mit der Plattform Immomio zusammen')), updated_at=now()
where id=129;
update public.source_connectors set enabled=false, shadow_only=true, connector_role='fallback', updated_at=now() where id=130;

update public.sources
set search_url='https://www.fluwog.de/wohnen/wohnungssuche/', coverage_status='partial', baseline_completed_at=null,
    last_checked_at='1970-01-01'::timestamptz, updated_at=now()
where id=45;
update public.source_connectors
set label='Offizielle Immomio-Registrierungsseite', connector_kind='html_discovery', enumerable=false, shadow_only=false,
    enabled=true, evidence_tier='K2', connector_role='primary',
    config=jsonb_build_object('url','https://www.fluwog.de/wohnen/wohnungssuche/','no_offer_patterns',jsonb_build_array('Über unser Immobilienportal Immomio können Sie schnell und einfach ein Suchprofil aufgeben')), updated_at=now()
where id=131;
update public.source_connectors set enabled=false, shadow_only=true, connector_role='fallback', updated_at=now() where id=132;

update public.sources
set search_url='https://www.1904.de/wohnungen/wohnungssuche', coverage_status='partial', baseline_completed_at=null,
    last_checked_at='1970-01-01'::timestamptz, updated_at=now()
where id=55;
update public.source_connectors
set label='Offizielle Immomio-Registrierungsseite', connector_kind='html_discovery', enumerable=false, shadow_only=false,
    enabled=true, evidence_tier='K2', connector_role='primary',
    config=jsonb_build_object('url','https://www.1904.de/wohnungen/wohnungssuche','no_offer_patterns',jsonb_build_array('Bei der Vermietung unserer Wohnungen arbeiten wir mit der Plattform Immomio zusammen')), updated_at=now()
where id=159;
update public.source_connectors set enabled=false, shadow_only=true, connector_role='fallback', updated_at=now() where id=160;
update public.listings
set is_active=false, fresh_delivery_eligible=false, quality_status='rejected'
where source_id=55 and is_active=true and canonical_url='https://www.1904.de/wohnungen/wohnungssuche';

update public.sources
set search_url='https://www.wohnreform-eg.de/', coverage_strategy='full_page', coverage_status='partial', baseline_completed_at=null,
    warmed_up=false, last_checked_at='1970-01-01'::timestamptz, updated_at=now()
where id=58;
update public.source_connectors
set label='Autoritative Wohnreform Verfügbarkeitsseite', connector_kind='html_discovery', enumerable=true, shadow_only=false,
    enabled=true, evidence_tier='K1', connector_role='primary',
    config=jsonb_build_object('url','https://www.wohnreform-eg.de/','no_offer_patterns',jsonb_build_array('Leider können wir keine freien Wohnungen anbieten, weil alle Wohnungen dauerhaft belegt sind')), updated_at=now()
where id=166;
update public.source_connectors
set enabled=false, shadow_only=true, enumerable=false, connector_role='fallback', evidence_tier='K3', updated_at=now()
where id=167;

update public.sources
set search_url='https://buchdrucker.immomio.de/', coverage_strategy='full_page', coverage_status='partial', baseline_completed_at=null,
    warmed_up=false, last_checked_at='1970-01-01'::timestamptz, updated_at=now()
where id=60;
update public.source_connectors
set label='Immomio HP Modul', connector_kind='html_discovery', enumerable=true, shadow_only=false,
    enabled=true, evidence_tier='K1', connector_role='primary',
    config=jsonb_build_object('url','https://buchdrucker.immomio.de/','no_offer_patterns',jsonb_build_array('Aktuell keine Angebote.')), updated_at=now()
where id=172;
update public.source_connectors
set enabled=false, shadow_only=true, enumerable=false, connector_role='fallback', evidence_tier='K3', updated_at=now()
where id in (170,171);

commit;
