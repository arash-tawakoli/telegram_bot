begin;
-- Registry remains the sole runtime source of connector configuration.
update source_connectors set shadow_only=true,connector_role='monitoring',enumerable=false,
 config=config||'{"audit_role":"diagnostic_not_qualified_fallback","audited_at":"2026-09-06"}'::jsonb
 where priority>1 and source_id in (2,3,4,6,7,10,11,14,17,18,21,31,33,47,49,50,51,52,54,56,57,59,62,63);
update source_connectors set connector_kind='html_discovery',enumerable=true,enabled=true,shadow_only=false,connector_role='primary',
 config=(config-'freshness_mode')||jsonb_build_object('adapter',case source_id when 10 then 'source-worker/wunder-catalog' when 17 then 'source-worker/city-catalog' else 'source-worker/swap-catalog' end,'url',case source_id when 10 then 'https://wunderflats.com/de/moeblierte-wohnungen-auf-zeit/hamburg' when 17 then 'https://www.city-wohnen.de/moeblierte-wohnung-mieten-hamburg/' else 'https://www.tauschwohnung.com/hamburg' end,'freshness_mode','new_id_after_complete_route_baseline'),
 label=case source_id when 10 then 'Public native catalog with verified pagination' when 17 then 'Public apartment catalog; AJAX pagination unverified' else 'Hamburg native catalog with rolling pagination' end
 where source_id in (10,17,21) and priority=1;
update source_connectors set config=config||jsonb_build_object('adapter',case source_id when 33 then 'source-worker/kaifu-public' else 'source-worker/finken-public' end),enumerable=true where source_id in (33,37) and priority=1;
update source_connectors set config=config||'{"empty_array_is_complete":true}'::jsonb where source_id=25 and priority=1;
update sources set search_url=case id when 17 then 'https://www.city-wohnen.de/moeblierte-wohnung-mieten-hamburg/' else 'https://www.tauschwohnung.com/hamburg' end where id in (17,21);
-- Location pages and applications do not prove an available apartment.
update sources set runtime_mode='shadow',delivery_mode='shadow',coverage_status='partial' where id in (49,60);
update source_connectors set connector_kind='html_discovery',connector_role='monitoring',enabled=true,shadow_only=true,enumerable=false,label='Public registration portal; no verified inventory',config='{"url":"https://buchdrucker.immomio.de/","audit_role":"registration_only"}' where source_id=60 and priority=1;
update source_connectors set enabled=false,shadow_only=true,enumerable=false,connector_role='monitoring' where source_id=60 and priority>1;
update source_connectors set enabled=true,shadow_only=true,enumerable=false,connector_role='monitoring' where source_id=56 and priority=1;
-- Only the verified native parser may refresh these sources' listing fields.
update listings set is_active=false where source_id=49 or (source_id in (10,17,21) and coalesce(raw->>'provider','') <> case source_id when 10 then 'wunderflats_catalog' when 17 then 'city_wohnen_catalog' else 'tauschwohnung_catalog' end);
update source_connectors set connector_kind='immomio_tenant',connector_role='fallback',enabled=true,shadow_only=false,enumerable=true,label='Official provider wrapper / tenant rediscovery',config='{"url": "https://www.hamburgerwohnen.de/wohnen/wohnungssuche-home.html", "audit_role": "official_wrapper_recovery", "audited_at": "2026-09-06"}'::jsonb where source_id=23 and priority=2;
update source_connectors set connector_kind='immomio_tenant',connector_role='fallback',enabled=true,shadow_only=false,enumerable=true,label='Official provider wrapper / tenant rediscovery',config='{"url": "https://www.vhw-hamburg.de/wohnen/aktuelle-angebote.html", "audit_role": "official_wrapper_recovery", "audited_at": "2026-09-06"}'::jsonb where source_id=29 and priority=2;
update source_connectors set connector_kind='immomio_tenant',connector_role='fallback',enabled=true,shadow_only=false,enumerable=true,label='Official provider wrapper / tenant rediscovery',config='{"url": "https://www.harabau.de/wohnen/wohnungsangebote/", "audit_role": "official_wrapper_recovery", "audited_at": "2026-09-06"}'::jsonb where source_id=30 and priority=2;
update source_connectors set connector_kind='immomio_tenant',connector_role='fallback',enabled=true,shadow_only=false,enumerable=true,label='Official provider wrapper / tenant rediscovery',config='{"url": "https://www.reiherstieg.de/wohnungsangebote/", "audit_role": "official_wrapper_recovery", "audited_at": "2026-09-06"}'::jsonb where source_id=34 and priority=2;
update source_connectors set connector_kind='immomio_tenant',connector_role='fallback',enabled=true,shadow_only=false,enumerable=true,label='Official provider wrapper / tenant rediscovery',config='{"url": "https://www.bg-fuhlsbuettel.de/index.php?id=22", "audit_role": "official_wrapper_recovery", "audited_at": "2026-09-06"}'::jsonb where source_id=36 and priority=2;
update source_connectors set connector_kind='immomio_tenant',connector_role='fallback',enabled=true,shadow_only=false,enumerable=true,label='Official provider wrapper / tenant rediscovery',config='{"url": "https://www.bds-hamburg.de/unser-angebot/interessentenportal-immomio/", "audit_role": "official_wrapper_recovery", "audited_at": "2026-09-06"}'::jsonb where source_id=65 and priority=2;
update sources set last_checked_at=null where id in (10,17,21,23,25,29,30,33,34,36,37,65);
commit;
