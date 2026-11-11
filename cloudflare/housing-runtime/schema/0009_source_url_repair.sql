UPDATE housing.source_registry
SET connector_config = jsonb_set(connector_config, '{url}', to_jsonb('https://www.immowelt.de/suche/mieten/wohnung/hamburg/hamburg-20095/ad08de1113'::text), true)
WHERE id = 3;

UPDATE housing.source_registry
SET connector_config = jsonb_set(connector_config, '{url}', to_jsonb('https://www.immowelt.de/suche/mieten/wohnung/schleswig-holstein/ad04de1'::text), true)
WHERE id = 71;
