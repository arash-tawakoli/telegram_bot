-- shortcut: matching stays disabled during parallel delivery; enable after deduplication and coverage checks.
INSERT OR IGNORE INTO source_registry(id, name, family, connector, connector_config, enabled) VALUES
  (30, 'HARABAU', 'immomio', 'immomio_tenant', '{"url":"https://www.harabau.de/wohnen/wohnungsangebote/","tenant_hash":"fe4024000d1feffce8bcf21bb2623bc75088b30f0e0ba818bb39cb78bca189b2","queue_matches":false}', 1),
  (32, 'EBV Harburg', 'immomio', 'immomio_tenant', '{"url":"https://www.ebv-harburg.de/wohnungen/wohnungsangebote/","tenant_hash":"8f5c0451cd6279562ec23e25588590d6a345e59fb5e9d4430c64b8ec17ad2f5a","queue_matches":false}', 1),
  (36, 'Fuhlsbüttel', 'immomio', 'immomio_tenant', '{"url":"https://www.bg-fuhlsbuettel.de/index.php?id=22","tenant_hash":"8807833d711635dbc829db2436e0c5f20cd41f7338f887c885fc23d6ed4e9cd1","queue_matches":false}', 1),
  (39, 'mgf Gartenstadt Farmsen', 'immomio', 'immomio_tenant', '{"url":"https://www.mgf-farmsen.de/immobiliensuche/aktuelle-angebote-wohnungen/stellplaetze/","tenant_hash":"0d04a900eded8576a1decdfb6d3fb676d1b8aa0247874469857a6e1312238cba","queue_matches":false}', 1);
