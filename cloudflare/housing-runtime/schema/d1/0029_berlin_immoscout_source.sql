-- Berlin is an independent live MCP source. Existing Hamburg and SH offers are unchanged.
INSERT OR IGNORE INTO source_registry(id,name,family,connector,connector_config,enabled)
VALUES (72,'ImmobilienScout24 Berlin','immoscout24','mcp',
  '{"url":"https://app.chatgpt.immobilienscout24.de/v2/mcp","adapter":"source-worker/scout-berlin"}',1);
