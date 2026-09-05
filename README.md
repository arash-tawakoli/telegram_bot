# Traumwohnung Hamburg Bot

Supabase-Backend für `@traumwohnunghamburgbot`: zentrale Wohnungssuche über 65 konfigurierte Hamburger Quellen, Dublettenprüfung, Suchprofile und Telegram-Zustellung.

- [Architektur](docs/ARCHITECTURE.md)
- [Review vom 5. September 2026](docs/ARCHITECTURE_REVIEW_2026-09-05.md)
- [Migrationsabgleich und Rollout](docs/MIGRATION_RECONCILIATION.md)
- [Quellen und Connectoren](docs/source-connectors.md)
- [Prüfung aller 65 Quellen](docs/SOURCE_AUDIT_2026-09-05.md)
- [Rollout und Versandstörung](docs/ROLLOUT_2026-09-05.md)

## Pipeline

Cron plant Source-Jobs in PGMQ ein. Der Source-Worker wählt den passenden Adapter, speichert Inserate und lässt Qualität, Aktualität, Dubletten und Matching durch SQL prüfen. Der Notification-Dispatcher verarbeitet die daraus erzeugten Delivery-Ereignisse. Telegram-Gateway, UI und Premium-Funktionen bearbeiten Nutzereingaben.

Supabase `sources` und `source_connectors` sind die produktive Quellenkonfiguration. K1/K2/K3 und Live/Shadow sind getrennt. Je Quelle sind höchstens ein Primärconnector und zwei Fallbacks aktiviert.

## Tests

Node 24 vorausgesetzt:

```sh
npm ci --ignore-scripts
npm test
```

Die 26 Tests verwenden synthetische Daten und führen keinen Telegram-Versand aus. Die SQL-Suite verwendet PGlite mit einem vereinfachten PGMQ-Modell. Zusätzlich wurde ein Integrationstest gegen echtes PostgreSQL/PGMQ in einer zurückgerollten Transaktion durchgeführt. `node scripts/check-runtime.mjs` prüft 22 Function-Snapshots und 142 kanonische Migrationen.

## Deployment-Status

Die Sicherheits-/Lifecycle-Migrationen und Runtime-Änderungen wurden produktiv ausgerollt. Die Migrationsdateien sind nach dem tatsächlichen Produktionsregister abgeglichen; historische SQL-Inhalte wurden nicht blind erneut ausgeführt. Die Runtime-Snapshots dokumentieren die aus Supabase gelesenen Versionen.

Fünf Minuten Source-Polling, kein Source-Backoff und ein globaler 15-Sekunden-Versandabstand sind aktiv. Ein nach dem Rollout entdeckter Variablenfehler blockierte die Zustellung; Dispatcher v30 korrigiert ihn und wurde anhand echter Versandbestätigungen geprüft. Vollständige Abdeckung sämtlicher externer Quellen ist ausdrücklich nicht zugesichert; Zugangssperren und offene Connector-Kandidaten stehen im Quellenbericht.
