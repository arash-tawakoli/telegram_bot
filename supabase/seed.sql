-- Architecture-v3 bootstrap registry for the retained housing search sources only.
-- Retained families: ImmoScout24, Immowelt, Immomio tenant connectors, plus verified tenant.immomio delivery.
-- Bootstrap only: never overwrite a configured environment or reset its baselines.
begin;
do $bootstrap$
begin
  if exists(select 1 from public.sources) or exists(select 1 from public.source_connectors) then
    raise exception 'Bootstrap refused: source registry already exists';
  end if;
end
$bootstrap$;
-- K1/K2/K3 is the user-authored source category. It is independent of
-- runtime_mode, connector health, coverage_strategy and crawl scheduling.
-- P1/P2 below are technical connector priorities; a third fallback is optional.

insert into public.sources (id,source_type,name,tier,homepage_url,search_url,poll_interval_minutes,enabled,notes) values
(1,'Immobilienportal','ImmobilienScout24 Hamburg','K1','https://www.immobilienscout24.de','https://www.immobilienscout24.de/Suche/de/hamburg/hamburg/wohnung-mieten',5,true,null),
(3,'Immobilienportal','Immowelt Hamburg','K1','https://www.immowelt.de','https://www.immowelt.de/suche/mieten/wohnung/hamburg/hamburg-20095/ad08de1113',5,true,null),
(23,'Baugenossenschaft','Hamburger Wohnen','K1','https://www.hamburgerwohnen.de','https://www.hamburgerwohnen.de/wohnen/wohnungssuche-home.html',5,true,null),
(28,'Baugenossenschaft','BGFG','K2','https://www.bgfg.de','https://www.bgfg.de/zuhause-finden/aktuelle-angebote',10,true,null),
(29,'Baugenossenschaft','VHW','K1','https://www.vhw-hamburg.de','https://www.vhw-hamburg.de/wohnen/aktuelle-angebote.html',5,true,null),
(30,'Baugenossenschaft','HARABAU','K1','https://www.harabau.de','https://www.harabau.de/wohnen/wohnungsangebote/',5,true,null),
(32,'Baugenossenschaft','EBV Harburg','K1','https://www.ebv-harburg.de','https://www.ebv-harburg.de/wohnungen/wohnungsangebote/',5,true,null),
(34,'Baugenossenschaft','Bauverein Reiherstieg','K2','https://www.reiherstieg.de','https://www.reiherstieg.de/wohnungsangebote/',10,true,null),
(35,'Baugenossenschaft','Walddörfer','K2','https://www.walddoerfer.de','https://www.walddoerfer.de/wohnungsangebote/aktuelle-angebote/',10,true,null),
(36,'Baugenossenschaft','Fuhlsbüttel','K1','https://www.bg-fuhlsbuettel.de','https://www.bg-fuhlsbuettel.de/index.php?id=22',5,true,null),
(37,'Baugenossenschaft','Finkenwärder-Hoffnung','K1','https://fwheg.de','https://fwheg.de/wohnungsangebote/',5,true,null),
(39,'Baugenossenschaft','mgf Gartenstadt Farmsen','K2','https://www.mgf-farmsen.de','https://www.mgf-farmsen.de/immobiliensuche/aktuelle-angebote-wohnungen/stellplaetze/',10,true,null),
(65,'Baugenossenschaft','BDS Dennerstraße-Selbsthilfe','K2','https://www.bds-hamburg.de','https://www.bds-hamburg.de/unser-angebot/interessentenportal-immomio/',10,true,null),
(66,'Baugenossenschaft','GEWOBA Nord','K2','https://www.gewoba-nord.de','https://www.gewoba-nord.de/wohne-mit-uns/wohnungssuche/',10,true,null),
(69,'Immobilienportal','ImmobilienScout24 Schleswig-Holstein','K1','https://www.immobilienscout24.de','https://www.immobilienscout24.de/Suche/de/schleswig-holstein/wohnung-mieten',5,true,null),
(71,'Immobilienportal','Immowelt Schleswig-Holstein','K1','https://www.immowelt.de','https://www.immowelt.de/suche/mieten/wohnung/schleswig-holstein/ad04de1/',5,true,null);

-- Runtime metadata for retained sources.
update public.sources set
  coverage_strategy=case
    when id in (1,69) then 'adaptive_partition'
    when id=3 then 'pagination'
    when id=71 then 'category_streams_only'
    when id in (23,28,29,30,32,34,35,36,37,39,65,66) then 'tenant_api'
    else coverage_strategy end,
  runtime_mode=case when id=71 then 'live' else runtime_mode end,
  delivery_mode=case when id=71 then 'shadow' else delivery_mode end,
  worker_slug='source-worker',
  coverage_status='unknown',
  baseline_completed_at=null,
  warmed_up=false,
  enabled=true,
  poll_interval_minutes=case when id in (1,69,3) then 5 else 10 end,
  updated_at=now()
where id in (1,3,23,28,29,30,32,34,35,36,37,39,65,66,69,71);

-- Create the initial registry. Existing registries were rejected before any writes.
insert into public.source_connectors(source_id,priority,label,connector_kind,config,enabled,enumerable,shadow_only)
select id,1,'Primary source','html_discovery',jsonb_build_object('url',search_url),true,false,(runtime_mode='shadow')
from public.sources;

insert into public.source_connectors(source_id,priority,label,connector_kind,config,enabled,enumerable,shadow_only)
select id,2,'Official homepage fallback','html_discovery',jsonb_build_object('url',homepage_url),true,false,(runtime_mode='shadow')
from public.sources
where homepage_url is not null and search_url is distinct from homepage_url;

-- Specialized primary adapters. Public tenant/search URLs are used instead of committing credentials.
update public.source_connectors set label='ImmoScout MCP adaptive coverage',connector_kind='mcp',enumerable=true,config='{}'::jsonb where source_id=1 and priority=1;
update public.source_connectors set label='Immomio Tenant',connector_kind='immomio_tenant',enumerable=true,config=jsonb_build_object('url',(select search_url from public.sources where id=source_connectors.source_id)) where source_id in (23,28,29,30,32,34,35,36,39,65) and priority=1;
update public.source_connectors set label='Finkenwaerder REST API',connector_kind='json_endpoint',enumerable=true,config='{"url":"https://fwheg.de/wp-json/immo/v1/estates"}'::jsonb where source_id=37 and priority=1;
update public.source_connectors set label='ImmoScout MCP Schleswig-Holstein adaptive coverage',connector_kind='mcp',enumerable=true,config='{}'::jsonb where source_id=69 and priority=1;
update public.source_connectors set label='Immowelt Schleswig-Holstein category streams',connector_kind='html_discovery',enumerable=true,config=jsonb_build_object('url',(select search_url from public.sources where id=71)) where source_id=71 and priority=1;

-- Mark strategies that are designed to enumerate the entire source.
update public.source_connectors c set enumerable=true
from public.sources s
where c.source_id=s.id and c.priority=1 and s.coverage_strategy in ('pagination','full_page','district_pagination','district_hybrid','adaptive_partition');

-- Retained sources are the only bootstrapped search sources.
update public.sources
set enabled = true,
    runtime_mode = 'live',
    delivery_mode = case when id = 71 then 'shadow' else 'live' end,
    worker_slug = 'source-worker'
where id in (1,3,23,28,29,30,32,34,35,36,37,39,65,66,69,71);
commit;
