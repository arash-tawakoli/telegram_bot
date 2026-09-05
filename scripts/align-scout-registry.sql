-- Runtime source 1 is dispatched directly to runScout; portal probes are diagnostic.
-- Idempotent configuration repair; no credentials or source eligibility changes.
begin;
update public.source_connectors
set label='ImmoScout MCP adaptive coverage', connector_kind='mcp',
    config=jsonb_build_object('adapter','source-worker/scout',
      'url','https://app.chatgpt.immobilienscout24.de/v2/mcp')
where source_id=1 and priority=1;
update public.source_connectors set shadow_only=true
where source_id=1 and priority>1 and shadow_only=false;
commit;
