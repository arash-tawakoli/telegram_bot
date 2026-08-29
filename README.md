# Traumwohnung Hamburg Bot

Backend für `@traumwohnunghamburgbot`: globale Wohnungssuche in Hamburg über 65 konfigurierte Quellen, Deduplizierung, genau ein Suchprofil pro Nutzer und Telegram-Push.

## Zielarchitektur v3

```text
pg_cron
  -> source_jobs (PGMQ)
  -> source-worker (max. 3 Source-Jobs parallel)
  -> Coverage Adapter
  -> listings
  -> listing_dedupe_groups
  -> SQL Matching
  -> delivery_events
  -> notification-dispatcher
  -> Telegram
```

Es gibt keine userabhängigen Portal-Suchen. Eine Quelle wird global gecrawlt; neue oder geänderte Listings werden anschließend intern gegen die Suchprofile gematcht.

## Runtime

- **Supabase Postgres** – 14 Public-Kerntabellen für Quellen, Listings, Nutzer, Matching-/Delivery-State und Hamburg-Geografie.
- **Supabase PGMQ** – genau eine produktive Queue: `source_jobs`.
- **Supabase Edge Functions** – drei produktive Kernbereiche: `source-worker`, `notification-dispatcher`, `telegram-ui`.
- **`telegram-fallback-logo`** – kleiner UI-Helfer für bestehende gespeicherte Listing-Karten; kein Source-Worker und kein eigener Scheduling-Pfad.
- **Supabase Cron + pg_net** – Source-Scheduler jede Minute, Source-Worker jede Minute, Notification-Dispatcher jede Minute und tägliche Maintenance.
- **Supabase Vault** – Bot-Token und interne Secrets; keine Secrets im Repository.

## Quellenmodell

Die fachliche Quellenkategorie und die technische Runtime sind bewusst getrennt:

- `tier` = K1/K2/K3 aus der verbindlichen 65-Quellen-Mastertabelle. Diese Kategorisierung wird nicht aus Connector-Qualität abgeleitet.
- `runtime_mode` = `live` oder `shadow`.
- `crawl_priority` = Reihenfolge gleichzeitig fälliger Quellen.
- `poll_interval_minutes` = tatsächliche Abruffrequenz; unabhängig von K1/K2/K3.
- `coverage_strategy` = `adaptive_partition`, `district_pagination`, `tenant_api`, `pagination`, `full_page`, `availability` oder `generic`.
- P1/P2/P3 in `source_connectors` = Primärconnector, Fallback 1, Fallback 2.

Aktueller Betriebszustand: **65 Quellen im Katalog, davon 56 live und 9 shadow**.

### Spezielle Coverage-Strategien

- **ImmoScout24**: 7 Hamburger Bezirke -> adaptive Preispartitionierung über MCP -> Stadtteil-Fallback bei nicht weiter teilbaren gesättigten Preis-Leaves.
- **Kleinanzeigen**: 7 Hamburger Bezirke -> vollständige Pagination mit persistentem Coverage-State.
- **ImmoMio / ImmoSolve-HPM / strukturierte APIs**: vollständige Tenant-/API-Enumeration.
- Kleine Angebotsseiten: Full-Page-Scan.

Login-Schranken, CAPTCHAs und Anti-Bot-Schutz werden nicht umgangen. Ein HTTP-401/403-/Netzwerkfehler bleibt als Fehler sichtbar und verwendet kontrolliertes Backoff.

## Scheduling

Vier produktive Cron-Jobs:

1. `source-scheduler-every-minute` – reiht alle fälligen Live-Quellen in `source_jobs` ein.
2. `source-worker-every-minute` – ruft ausschließlich den kanonischen `source-worker` auf; dieser verarbeitet höchstens drei Source-Jobs gleichzeitig und zieht innerhalb seiner Laufzeit weitere Jobs nach.
3. `notification-dispatcher-every-minute` – verarbeitet `delivery_events` und sendet passende Listings an Telegram.
4. `architecture-maintenance-daily` – räumt technische Historie nach der definierten Retention auf.

Fehler erhöhen das Backoff. Shadow-Quellen werden nicht in die normale Source Queue eingereiht.

## Baseline und Zustellung

Eine Quelle darf vorhandenen Altbestand beim ersten vollständigen Coverage-Lauf nicht als neue Telegram-Treffer ausliefern. `baseline_completed_at` trennt Baseline von Live-Zustellung.

Nach erfolgreicher Baseline gilt:

```text
neues primäres Listing
  -> SQL Matching
  -> delivery_events
  -> notification-dispatcher
  -> Telegram
```

Es gibt keine separaten Runtime-Tabellen `matches`, `notification_outbox`, `canonical_listings` oder `listing_occurrences` mehr.

## Suchprofile

Es gilt **genau ein Suchprofil pro Nutzer**. Die Datenbank erzwingt dies über einen Unique Index auf `search_profiles(user_id)`.

## Repository

```text
.github/workflows/
  architecture-check.yml

docs/
  ARCHITECTURE.md
  MIGRATION_RECONCILIATION.md
  source-connectors.md

supabase/
  functions/
    source-worker/
    notification-dispatcher/
    telegram-ui/
    telegram-fallback-logo/
  migrations/
  seed.sql
```

Die Source-Adapter sind Module innerhalb von `source-worker`; sie sind keine eigenen deployten Source-Edge-Functions mehr. Historische Migrationen bleiben als Migrationshistorie erhalten, auch wenn sie alte Architekturgenerationen beschreiben.

## GitOps

- Supabase `sources` und `source_connectors` sind die Runtime-Source-of-Truth.
- Architekturänderungen werden über Migrationen versioniert.
- `docs/ARCHITECTURE.md` beschreibt den aktuellen Ziel- und Produktionsstand.
- `.github/workflows/architecture-check.yml` verhindert das erneute Einführen der entfernten Legacy-Runtime-Pfade.

## Telegram Commands

- `/start`
- `/suche`
- `/profile`
- `/gespeichert`
- `/einstellungen`
- `/pause`
- `/resume`
- `/status`
- `/hilfe`
