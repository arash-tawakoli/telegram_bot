# Traumwohnung Hamburg Bot

Supabase-Backend für `@traumwohnunghamburgbot`: zentrale Wohnungssuche über 65 konfigurierte Hamburger Quellen, Dublettenprüfung, Suchprofile und Telegram-Zustellung.

- [Architektur](docs/ARCHITECTURE.md)
- [Produktive Optimierung und Verifikation vom 11. September 2026](docs/SUPABASE_OPTIMIZATION_2026-09-11.md)
- [Bereinigung und Prüfnachweise vom 9. September 2026](docs/ARCHITECTURE_CLEANUP_2026-09-09.md)
- [Migrationsabgleich und Rollout](docs/MIGRATION_RECONCILIATION.md)
- [Quellen und Connectoren](docs/source-connectors.md)
- [Aktuelle Prüfung aller 65 Quellen](docs/SOURCE_DELIVERY_AUDIT_2026-09-09.md)
- [Rollout und Versandstörung](docs/ROLLOUT_2026-09-05.md)

## Wohnungsplaner

Neu: Bewerbungsstatus, private Notizen, Wohnungsvergleich, Kontaktentwürfe und Kostenübersicht für gespeicherte Wohnungen. Einstieg über `/planer` oder das Startmenü; Bestandteil der Premium-Merkliste. [Bedienung und Prüfungen](docs/WOHNUNGSPLANER_2026-09-09.md).

## Pipeline

Cron plant Source-Jobs in PGMQ ein. Der Source-Worker wählt den passenden Adapter, speichert Inserate und lässt Qualität, Aktualität, Dubletten und Matching durch SQL prüfen. Der Notification-Dispatcher verarbeitet die daraus erzeugten Delivery-Ereignisse. Telegram-Gateway, UI und Premium-Funktionen bearbeiten Nutzereingaben.

Supabase `sources` und `source_connectors` sind die produktive Quellenkonfiguration. K1/K2/K3 und Live/Shadow sind getrennt. Je Quelle sind höchstens ein Primärconnector und zwei Fallbacks aktiviert.

## Tests

Node 24 vorausgesetzt:

```sh
npm ci --ignore-scripts
npm test
```

Die Tests verwenden synthetische Daten und führen keinen Telegram-Versand aus. Die SQL-Suite verwendet PGlite mit einem vereinfachten PGMQ-Modell. `node scripts/check-runtime.mjs` prüft die vollständigen Function-Bundles gegen die aufgezeichneten Deployment-Hashes sowie die kanonischen Migrationen. Aktuelle Ergebnisse und Grenzen stehen im Architekturbericht.

## Deployment-Status

Die Sicherheits-/Lifecycle-Migrationen und Runtime-Änderungen wurden produktiv ausgerollt. Die Migrationsdateien sind nach dem tatsächlichen Produktionsregister abgeglichen; historische SQL-Inhalte wurden nicht blind erneut ausgeführt. Die Runtime-Snapshots dokumentieren die aus Supabase gelesenen Versionen.

Nur aktivierte Live-Quellen werden regulär abgearbeitet. Vorschauen enthalten höchstens ein Bild; Bezirk und Stadtteil erscheinen nur bei vorhandenen expliziten Quelldaten. Vollständige externe Coverage ist nicht zugesichert; konkrete offene Blocker stehen im Quellenbericht.

`supabase/seed.sql` dient nur einem leeren Register und bricht bei vorhandener Konfiguration ab. Neue Quellen starten deaktiviert/shadow. Historische Reparatur-SQLs sind keine automatische Deployment-Reihenfolge.
