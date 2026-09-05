update public.source_connectors
set connector_kind='json_endpoint', enumerable=false, enabled=true, shadow_only=false,
    label='HousingAnywhere verified native-new feed (Primary)',
    config=jsonb_build_object('role','primary','adapter','source-worker/housinganywhere','freshness_mode','newest_first','url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/noncoop-new-feed?source_id=9')
where source_id=9 and priority=1;
update public.source_connectors set shadow_only=true where source_id=9 and priority>1;

update public.source_connectors
set connector_kind='json_endpoint', enumerable=false, enabled=true, shadow_only=false,
    label='Ohne-Makler verified new-ID feed (Primary)',
    config=jsonb_build_object('role','primary','adapter','source-worker/ohne-makler','freshness_mode','newest_first','fresh_id_floor',coalesce(config->>'fresh_id_floor','0'),'url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/noncoop-new-feed?source_id=12&floor='||coalesce(config->>'fresh_id_floor','0'))
where source_id=12 and priority=1;
update public.source_connectors set shadow_only=true where source_id=12 and priority>1;

update public.source_connectors
set connector_kind='json_endpoint', enumerable=false, enabled=true, shadow_only=false,
    label='Covivio official normalized feed (Primary)',
    config=jsonb_build_object('role','primary','adapter','source-worker/covivio','url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/noncoop-new-feed?source_id=20&lane=primary')
where source_id=20 and priority=1;
update public.source_connectors
set connector_kind='json_endpoint', enumerable=false, enabled=true, shadow_only=false,
    label='Covivio official-detail index feed (Fallback 1)',
    config=jsonb_build_object('role','fallback_1','adapter','source-worker/covivio-index','url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/noncoop-new-feed?source_id=20&lane=fallback')
where source_id=20 and priority=2;
update public.source_connectors set shadow_only=true where source_id=20 and priority>2;

update public.source_connectors
set connector_kind='json_endpoint', enumerable=false, enabled=true, shadow_only=false,
    label='Wohnungsswap official normalized feed (Primary)',
    config=jsonb_build_object('role','primary','adapter','source-worker/wohnungsswap','freshness_mode','newest_first','url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/noncoop-new-feed?source_id=22&lane=primary')
where source_id=22 and priority=1;
update public.source_connectors
set connector_kind='json_endpoint', enumerable=false, enabled=true, shadow_only=false,
    label='Wohnungsswap public-detail index feed (Fallback 1)',
    config=jsonb_build_object('role','fallback_1','adapter','source-worker/wohnungsswap-index','url','https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/noncoop-new-feed?source_id=22&lane=fallback')
where source_id=22 and priority=2;
update public.source_connectors set shadow_only=true where source_id=22 and priority>2;
