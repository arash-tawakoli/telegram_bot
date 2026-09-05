-- Verified public inventory routes; no private APIs or applicant credentials.
begin;
update public.source_connectors
set label='TAG official Hamburg inventory API', connector_kind='json_endpoint', enumerable=true,
 config=jsonb_build_object('adapter','source-worker/tag-public','url','https://immo.tag-wohnen.de/properties?filters%5Bproperty_city%5D%5B%5D=Hamburg&size=50')
where source_id=7 and priority=1;
update public.source_connectors
set label='Heimstaden official Hamburg provider portal', connector_kind='html_discovery', enumerable=true,
 config=jsonb_build_object('adapter','source-worker/heim-public','url','https://portal.immobilienscout24.de/ergebnisliste/75089905','freshness_mode','newest_first')
where source_id=11 and priority=1;
update public.source_connectors
set label='Urban Living apartment availability map', connector_kind='html_discovery', enumerable=true,
 config=jsonb_build_object('adapter','source-worker/urban-public','url','https://www.urban-living-hamburg.de/mieten')
where source_id=50 and priority=1;
update public.source_connectors set shadow_only=true
where source_id in(7,11,50) and priority>1;
commit;
