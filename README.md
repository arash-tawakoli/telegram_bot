# Traumwohnung Hamburg Bot

Supabase-Backend für `@traumwohnunghamburgbot`: zentrale Wohnungssuche über 65 konfigurierte Hamburger Quellen, Dublettenprüfung, Suchprofile und Telegram-Zustellung.

- [Architektur](docs/ARCHITECTURE.md)
- [Review vom 5. September 2026](docs/ARCHITECTURE_REVIEW_2026-09-05.md)
- [Migrationsabgleich und Rollout](docs/MIGRATION_RECONCILIATION.md)
- [Quellen und Connectoren](docs/source-connectors.md)

## Pipeline

Cron plant Source-Jobs in PGMQ ein. Der Source-Worker wählt den passenden Adapter, speichert Inserate und lässt Qualität, Aktualität, Dubletten und Matching durch SQL prüfen. Der Notification-Dispatcher verarbeitet die daraus erzeugten Delivery-Ereignisse. Telegram-Gateway, UI und Premium-Funktionen bearbeiten Nutzereingaben.

Supabase `sources` und `source_connectors` sind die produktive Quellenkonfiguration. K1/K2/K3 und Live/Shadow sind getrennt. Je Quelle sind höchstens ein Primärconnector und zwei Fallbacks aktiviert.

## Tests

Node 24 vorausgesetzt:

```sh
npm ci --ignore-scripts
npm test
```

Die Tests verwenden synthetische Daten und führen keinen Telegram-Versand aus. Die SQL-Tests prüfen die neue Migration mit einem vereinfachten PGMQ-Testmodell. Vor einem produktiven Rollout ist ein Integrationstest mit echter Supabase-/PGMQ-Umgebung erforderlich.

## Deployment-Status

Dieser Review-Stand ist ein Änderungsvorschlag. Produktion und GitHub hatten unterschiedliche Dispatcher-Implementierungen und Migrationsnummern. Vor dem Rollout die Historie abgleichen, die additive Migration anwenden und danach die Worker deployen. Den bisherigen Dispatcher vor dem Austausch auslaufen lassen. Keine historischen Migrationen blind erneut ausführen.

Die frühere Anforderung von fünf Minuten Polling, 15 Sekunden Versandabstand und keinem Source-Backoff entspricht derzeit nicht dem Live-Stand. Details und Folgearbeiten stehen im Review.
