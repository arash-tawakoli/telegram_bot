-- Keep Source 1 aligned with the verified public-search discovery strategy.
-- Yahoo public web search is primary; Bing RSS is fallback; direct ImmoScout
-- access is diagnostic only because the public result page may return bot protection.

update public.source_connectors
set label = 'Yahoo Public Web Search - ImmoScout exposed listings',
    connector_kind = 'indexed_html',
    config = '{"provider":"yahoo","freshness":"week","test_only":true,"pagination":true,"public_search":true}'::jsonb,
    enabled = true
where source_id = 1 and priority = 1;

update public.source_connectors
set label = 'Bing RSS public index fallback',
    connector_kind = 'indexed_rss',
    config = '{"provider":"bing","fallback":true,"test_only":true}'::jsonb,
    enabled = true
where source_id = 1 and priority = 2;

update public.source_connectors
set label = 'Direct ImmoScout public page diagnostic',
    connector_kind = 'html_discovery',
    config = '{"provider":"immoscout","diagnostic_only":true}'::jsonb,
    enabled = true
where source_id = 1 and priority = 3;
