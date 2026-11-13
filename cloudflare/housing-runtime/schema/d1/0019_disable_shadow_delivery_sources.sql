UPDATE source_registry
SET connector_config = json_set(connector_config, '$.queue_matches', json('false'))
WHERE id IN (30, 32, 36, 39, 71);
