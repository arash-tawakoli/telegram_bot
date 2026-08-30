-- Architecture-v3 bootstrap registry for all 65 Hamburg sources.
-- K1/K2/K3 is the user-authored source category. It is independent of
-- runtime_mode, connector health, coverage_strategy and crawl scheduling.
-- P1/P2 below are technical connector priorities; a third fallback is optional.

insert into public.sources (id,source_type,name,tier,homepage_url,search_url,poll_interval_minutes,enabled,notes) values
(1,'Immobilienportal','ImmobilienScout24 Hamburg','K1','https://www.immobilienscout24.de','https://www.immobilienscout24.de/Suche/de/hamburg/hamburg/wohnung-mieten',5,true,null),
(2,'Marketplace','Kleinanzeigen Hamburg','K1','https://www.kleinanzeigen.de','https://www.kleinanzeigen.de/s-wohnung-mieten/hamburg/c203l9409',5,true,null),
(3,'Immobilienportal','Immowelt Hamburg','K1','https://www.immowelt.de','https://www.immowelt.de/suche/mieten/wohnung/hamburg/hamburg-20095/ad08de1113',5,true,null),
(4,'Wohnungsunternehmen','SAGA','K3','https://www.saga.hamburg','https://www.saga.hamburg/immobiliensuche',30,true,null),
(5,'Wohnungsunternehmen','Vonovia Hamburg','K1','https://www.vonovia.de','https://www.vonovia.de/de-de/immobiliensuche',5,true,null),
(6,'Marketplace','WG-Gesucht Hamburg','K1','https://www.wg-gesucht.de','https://www.wg-gesucht.de/wohnungen-in-Hamburg.55.2.1.0.html',5,true,null),
(7,'Wohnungsunternehmen','TAG Wohnen Hamburg','K2','https://tag-wohnen.de','https://tag-wohnen.de/immosuche?filters%5Bproperty_city%5D%5B%5D=Hamburg&size=50&view=LIST',10,true,null),
(8,'Wohnungsunternehmen','Grand City Property Hamburg','K2','https://www.grandcityproperty.de','https://www.grandcityproperty.de/wohnungssuche',10,true,null),
(9,'Marketplace','HousingAnywhere Hamburg','K1','https://housinganywhere.com','https://housinganywhere.com/s/Hamburg--Germany',5,true,null),
(10,'Marketplace','Wunderflats Hamburg','K2','https://wunderflats.com','https://wunderflats.com/de/moeblierte-wohnungen-auf-zeit/hamburg',10,true,null),
(11,'Wohnungsunternehmen','Heimstaden Hamburg','K2','https://heimstaden.com/de/','https://heimstaden.com/de/immobiliensuche/wohnung-hamburg/',10,true,null),
(12,'Immobilienportal','Ohne-Makler.net Hamburg','K1','https://www.ohne-makler.net','https://www.ohne-makler.net/immobilien/wohnung-mieten/hamburg/',5,true,null),
(13,'Marketplace','Homelike / Spacest Hamburg','K1','https://www.thehomelike.com','https://www.thehomelike.com/furnished-apartments/hamburg/',5,true,null),
(14,'Immobilienportal','meinestadt.de Hamburg','K1','https://www.meinestadt.de','https://www.meinestadt.de/hamburg/immobilien/wohnungen',5,true,null),
(15,'Immobilienportal','immobilien.de Hamburg','K1','https://www.immobilien.de','https://www.immobilien.de/mieten/wohnung/hamburg/',5,true,null),
(16,'Immobilienportal','immobilie1 Hamburg','K1','https://www.immobilie1.de','https://www.immobilie1.de/immobilien/hamburg/wohnung/mieten',5,true,null),
(17,'Vermittlungsplattform','City-Wohnen Hamburg','K1','https://www.city-wohnen.de/','https://www.city-wohnen.de/',5,true,null),
(18,'Studentenwohnen','Studierendenwerk Hamburg','K2','https://www.stwhh.de','https://www.stwhh.de/wohnen',30,false,null),
(19,'Marketplace','Nestpick Hamburg','K1','https://www.nestpick.com','https://www.nestpick.com/hamburg/',5,true,null),
(20,'Wohnungsunternehmen','Covivio Hamburg','K2','https://www.covivio.immo','https://www.covivio.immo/wohnen/immobilie-finden/',10,true,null),
(21,'Tauschplattform','Tauschwohnung.com Hamburg','K1','https://www.tauschwohnung.com/','https://www.tauschwohnung.com/search/result?city=Hamburg&region=Hamburg&housing_type=1&page=0&sort=standard',5,true,null),
(22,'Tauschplattform','Wohnungsswap.de Hamburg','K1','https://wohnungsswap.de','https://wohnungsswap.de/',5,true,null),
(23,'Baugenossenschaft','Hamburger Wohnen','K1','https://www.hamburgerwohnen.de','https://www.hamburgerwohnen.de/wohnen/wohnungssuche-home.html',5,true,null),
(24,'Baugenossenschaft','Bergedorf-Bille','K2','https://www.bergedorf-bille.de','https://2211665.hpm.immosolve.eu/#!/result-list-2',10,true,null),
(25,'Baugenossenschaft','BVE','K1','https://www.bve.de','https://www.bve.de/wohnen-beim-bve/wohnungsbestand/wohnungsangebote/',5,true,null),
(26,'Baugenossenschaft','altoba','K2','https://www.altoba.de','https://2222820.hpm.immosolve.eu/?startRoute=result-list&objectIdentifier=2#!/result-list-2',10,true,null),
(27,'Baugenossenschaft','HANSA','K2','https://hansa-wohnen.de','https://hansa-wohnen.de/wohnen/unsere-wohnungen',10,true,null),
(28,'Baugenossenschaft','BGFG','K2','https://www.bgfg.de','https://www.bgfg.de/zuhause-finden/aktuelle-angebote',10,true,null),
(29,'Baugenossenschaft','VHW','K1','https://www.vhw-hamburg.de','https://www.vhw-hamburg.de/wohnen/aktuelle-angebote.html',5,true,null),
(30,'Baugenossenschaft','HARABAU','K1','https://www.harabau.de','https://www.harabau.de/wohnen/wohnungsangebote/',5,true,null),
(31,'Wohnungsunternehmen','GWG-Gruppe Hamburg','K1','https://gwg-gruppe.de','https://gwg-gruppe.de/standorte/hamburg',5,true,null),
(32,'Baugenossenschaft','EBV Harburg','K1','https://www.ebv-harburg.de','https://www.ebv-harburg.de/wohnungen/wohnungsangebote/',5,true,null),
(33,'Baugenossenschaft','KAIFU-NORDLAND','K2','https://kaifu.de','https://kaifu.de/wohnen/hamburg',10,true,null),
(34,'Baugenossenschaft','Bauverein Reiherstieg','K2','https://www.reiherstieg.de','https://www.reiherstieg.de/wohnungsangebote/',10,true,null),
(35,'Baugenossenschaft','Walddörfer','K2','https://www.walddoerfer.de','https://www.walddoerfer.de/wohnungsangebote/aktuelle-angebote/',10,true,null),
(36,'Baugenossenschaft','Fuhlsbüttel','K1','https://www.bg-fuhlsbuettel.de','https://www.bg-fuhlsbuettel.de/index.php?id=22',5,true,null),
(37,'Baugenossenschaft','Finkenwärder-Hoffnung','K1','https://fwheg.de','https://fwheg.de/wohnungsangebote/',5,true,null),
(38,'Baugenossenschaft','Hanseatische Baugenossenschaft','K2','https://www.hanseatische.de','https://www.hanseatische.de/de/wohnungsangebote',10,true,null),
(39,'Baugenossenschaft','mgf Gartenstadt Farmsen','K2','https://www.mgf-farmsen.de','https://www.mgf-farmsen.de/immobiliensuche/aktuelle-angebote-wohnungen/stellplaetze/',10,true,null),
(40,'Baugenossenschaft','Schiffszimmerer','K2','https://www.schiffszimmerer.de','https://www.schiffszimmerer.de/',10,true,null),
(41,'Baugenossenschaft','Süderelbe','K2','https://www.baugen-suederelbe.de','https://www.baugen-suederelbe.de/wohnungangebote/',10,true,null),
(42,'Baugenossenschaft','Lehrerbau','K2','https://www.lehrerbau.de','https://www.lehrerbau.de/',10,true,null),
(43,'Baugenossenschaft','Gartenstadt Wandsbek','K3','https://www.gartenstadt-wandsbek.de','https://asp2.immosolve.eu/immosolve_presentation/pub/modern/2227623/HP/immo.jsp',30,true,null),
(44,'Baugenossenschaft','Gartenstadt Hamburg','K3','https://www.gartenstadt-hamburg.de','https://www.gartenstadt-hamburg.de/',30,true,null),
(45,'Baugenossenschaft','FLUWOG-NORDMARK','K3','https://www.fluwog.de','https://www.fluwog.de/',30,true,null),
(46,'Baugenossenschaft','Wohnungsverein Hamburg von 1902','K2','https://wv1902.de','https://wv1902.de/wohnungsangebote/',10,true,null),
(47,'Wohnungsunternehmen','Wohnungsunternehmen Fiefstuecken','K2','https://www.fiefstuecken.de','https://www.fiefstuecken.de/',10,true,null),
(48,'Wohnungsunternehmen','meravis Hamburg','K2','https://www.meravis.de','https://www.meravis.de/mieten/wohnungssuche/',10,true,null),
(49,'Serviced Apartments','Smartments Hamburg','K1','https://smartments.com/de/','https://smartments.com/de/serviced-apartments-hamburg/',5,true,null),
(50,'Studentenwohnen','Urban Living Hamburg','K2','https://www.urban-living-hamburg.de','https://www.urban-living-hamburg.de/',10,true,null),
(51,'Studentenwohnen','Felixx student Hamburg','K2','https://www.felixx-student.de/','https://www.felixx-student.de/standorte/',30,false,null),
(52,'Wohnungsunternehmen','Wichern Baugesellschaft','K2','https://wichernbau.de/','https://wichernbau.de/vermietung/',10,true,null),
(53,'Baugenossenschaft','KOLPING','K2','https://baugenossenschaft-kolping.de/','https://baugenossenschaft-kolping.de/wohnungsbestand/#wohnungen',10,true,null),
(54,'Wohnungsunternehmen','HSG Wohnen','K3','https://www.hsg-wohnen.de','https://www.hsg-wohnen.de/',60,false,null),
(55,'Baugenossenschaft','WG von 1904','K3','https://www.1904.de','https://www.1904.de/wohnungen/wohnungssuche',30,true,null),
(56,'Baugenossenschaft','WHW 1897','K3','https://www.whw1897.de','https://www.whw1897.de/',60,false,null),
(57,'Verein / Wohnprojekt','WGPV','K2','https://www.wgpv.de','https://www.wgpv.de/',30,false,null),
(58,'Baugenossenschaft','Wohnreform eG','K3','https://www.wohnreform-eg.de/','https://www.wohnreform-eg.de/',30,true,null),
(59,'Baugenossenschaft','Wohnwarft eG','K3','https://wohnwarft.de/','https://wohnwarft.de/',60,false,null),
(60,'Baugenossenschaft','Baugenossenschaft der Buchdrucker','K3','https://www.buchdrucker.de','https://www.buchdrucker.de/de/wohnungsangebote',30,true,null),
(61,'Baugenossenschaft','dhu','K3','https://www.dhu.hamburg','https://hpm2.immosolve.eu/immosolve_presentation/pub/modern/2223228/HP/immo.jsp',30,true,null),
(62,'Immobilienunternehmen','DVG Immobilien','K3','https://www.dvgimmobilien.de/','https://www.dvgimmobilien.de/',60,false,null),
(63,'Immobilienportal','Wohnungsbörse.net Hamburg','K3','https://www.wohnungsboerse.net','https://www.wohnungsboerse.net/Hamburg/mieten/wohnungen',60,false,null),
(64,'Baugenossenschaft','Falkenried-Terrassen','K3','https://www.falkenried-terrassen.de','https://www.falkenried-terrassen.de/',60,false,'Kein bestätigter digitaler Wohnungslisting-Connector'),
(65,'Baugenossenschaft','BDS Dennerstraße-Selbsthilfe','K2','https://www.bds-hamburg.de','https://www.bds-hamburg.de/unser-angebot/interessentenportal-immomio/',10,true,null)
on conflict (id) do update set
  source_type=excluded.source_type,name=excluded.name,tier=excluded.tier,
  homepage_url=excluded.homepage_url,search_url=excluded.search_url,
  poll_interval_minutes=excluded.poll_interval_minutes,enabled=excluded.enabled,
  notes=excluded.notes,updated_at=now();

-- Runtime metadata is applied after all migrations, because seed.sql executes after migrations.
update public.sources set
  coverage_strategy=case
    when id=1 then 'adaptive_partition'
    when id=2 then 'district_hybrid'
    when id in (5,7,23,24,25,26,27,28,29,30,32,33,34,35,36,37,39,43,61,65) then 'tenant_api'
    when id in (3,6,8,9,10,12,14,15,16,21,22) then 'pagination'
    when id in (38,41,42,46,52,53,58) then 'full_page'
    when id in (49,50) then 'availability'
    else 'generic' end,
  runtime_mode=case when id in (18,51,54,56,57,59,62,63,64) then 'shadow' else 'live' end,
  delivery_mode=case when id in (18,51,54,56,57,59,62,63,64) then 'shadow' else 'live' end,
  worker_slug=case when id in (18,51,54,56,57,59,62,63,64) then null else 'source-worker' end,
  coverage_status='unknown',baseline_completed_at=null,warmed_up=false,
  enabled=case when id in (18,51,54,56,57,59,62,63,64) then false else true end,
  poll_interval_minutes=case
    when id in (1,2) then 1
    when id in (3,6,14) then 2
    when id in (18,51,57) then 30
    when id in (54,56,59,62,63,64) then 60
    when tier='K1' then 5 when tier='K2' then 10 else 30 end,
  updated_at=now();

-- Ranking/crawl priority from the 65-source research list. This does not alter K1/K2/K3.
with p(source_id,crawl_priority) as (values
(1,1),(2,2),(3,3),(6,4),(5,5),(4,6),(7,7),(14,8),(9,9),(21,10),
(12,11),(8,12),(10,13),(11,14),(15,15),(20,16),(25,17),(63,18),(27,19),(24,20),
(40,21),(22,22),(38,23),(28,24),(26,25),(29,26),(31,27),(48,28),(65,29),(23,30),
(33,31),(45,32),(18,33),(13,34),(19,35),(41,36),(61,37),(17,38),(16,39),(55,40),
(56,41),(32,42),(43,43),(37,44),(39,45),(46,46),(35,47),(30,48),(44,49),(42,50),
(54,51),(52,52),(60,53),(34,54),(49,55),(51,56),(47,57),(50,58),(53,59),(36,60),
(62,61),(57,62),(64,63),(58,64),(59,65))
update public.sources s set crawl_priority=p.crawl_priority from p where s.id=p.source_id;

-- Rebuild a compact connector registry. Primary is the search endpoint; homepage is a generic fallback.
delete from public.source_connectors;
insert into public.source_connectors(source_id,priority,label,connector_kind,config,enabled,enumerable,shadow_only)
select id,1,'Primary source','html_discovery',jsonb_build_object('url',search_url),true,false,(runtime_mode='shadow')
from public.sources;

insert into public.source_connectors(source_id,priority,label,connector_kind,config,enabled,enumerable,shadow_only)
select id,2,'Official homepage fallback','html_discovery',jsonb_build_object('url',homepage_url),true,false,(runtime_mode='shadow')
from public.sources
where homepage_url is not null and search_url is distinct from homepage_url;

-- Specialized primary adapters. Public tenant/search URLs are used instead of committing credentials.
update public.source_connectors set label='ImmoScout MCP adaptive coverage',connector_kind='mcp',enumerable=true,config='{}'::jsonb where source_id=1 and priority=1;
update public.source_connectors set label='Kleinanzeigen 7-district hybrid coverage',connector_kind='pagination',enumerable=true,config='{}'::jsonb where source_id=2 and priority=1;
update public.source_connectors set label='Vonovia REST /api/real-estate/list',connector_kind='json_endpoint',enumerable=true,config='{"path":"/api/real-estate/list"}'::jsonb where source_id=5 and priority=1;
update public.source_connectors set label='TAG JSON /properties',connector_kind='json_endpoint',enumerable=true,config='{"path":"/properties"}'::jsonb where source_id=7 and priority=1;
update public.source_connectors set label='Immomio Tenant',connector_kind='immomio_tenant',enumerable=true,config=jsonb_build_object('url',(select search_url from public.sources where id=source_connectors.source_id)) where source_id in (23,28,29,30,32,34,35,36,39,65) and priority=1;
update public.source_connectors set label='ImmoSolve HPM REST',connector_kind='immosolve_api',enumerable=true,config=jsonb_build_object('url',(select search_url from public.sources where id=source_connectors.source_id)) where source_id in (24,26,43,61) and priority=1;
update public.source_connectors set label='ImmoSolve HPM REST',connector_kind='immosolve_api',enumerable=true,config='{"url":"https://2228361.hpm.immosolve.eu/","mandator_id":"2228361"}'::jsonb where source_id=27 and priority=1;
update public.source_connectors set label='BVE Wohnungsangebote API',connector_kind='json_endpoint',enumerable=true,config='{"url":"https://www.bve.de/Umbraco/Surface/BVEData/GetMapMarkersForWohnungsangebote?wohnanlageBaseUrl=%2Fwohnen-beim-bve%2Fwohnungsbestand%2Fwohnungsangebote%2Fwohnungsangebot%2F&mapsMarkerIconUrl=%2FWebsite%2FHtmlMedia%2Fimg%2Fic_maps_marker.png"}'::jsonb where source_id=25 and priority=1;
update public.source_connectors set label='KAIFU property supply API',connector_kind='json_endpoint',enumerable=true,config='{"url":"https://kaifu.de/api/property-supply/all"}'::jsonb where source_id=33 and priority=1;
update public.source_connectors set label='Finkenwaerder REST API',connector_kind='json_endpoint',enumerable=true,config='{"url":"https://fwheg.de/wp-json/immo/v1/estates"}'::jsonb where source_id=37 and priority=1;

-- Mark strategies that are designed to enumerate the entire source.
update public.source_connectors c set enumerable=true
from public.sources s
where c.source_id=s.id and c.priority=1 and s.coverage_strategy in ('pagination','full_page','district_pagination','district_hybrid','adaptive_partition');