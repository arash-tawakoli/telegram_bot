# Traumwohnung Hamburg Bot

Backend für `@traumwohnunghamburgbot`: automatische Wohnungssuche in Hamburg über 65 konfigurierte Quellen, kanonische Deduplizierung, Suchprofil-Matching und Telegram-Push.

## Stack

- **Telegram Bot API** – Button-Onboarding, Einstellungen, gespeicherte Listings und Foto-Inseratkarten
- **Supabase Postgres** – Nutzer, Suchprofile, Quellen, kanonische Listings, Source-Vorkommen, Matching, Outbox und Logs
- **Supabase PGMQ** – persistente Source-Job-Queue
- **Supabase Edge Functions** – Telegram-Komponenten, Source-Job-Runner und bestehende Source-Adapter
- **Supabase Cron + pg_net** – Enqueue, Worker-Dispatch, Availability und Notification-Dispatch
- **Supabase Vault** – Bot-Token und interne Secrets; keine Secrets im Repository

## Quellenlogik

P1/P2/P3 bleiben Connector-Prioritäten:

- P1 = Primär
- P2 = Fallback 1
- P3 = Fallback 2

Polling und Evidenz sind getrennt:

- Poll-Tier K1/K2/K3 = 15/30/60 Minuten
- Evidence-Tier K1/K2/K3 = technische Vertrauensstufe des Connectors
- `enumerable=true` = Connector kann den vollständigen aktuellen Bestand zuverlässig enumerieren
- `shadow_only=true` = keine Verfügbarkeitsentscheidung aus dieser Evidenz

Die Connector-Registry steht in `docs/source-connectors.md`. Die stabile Orchestrierungsregistry steht maschinenlesbar in `data/source_catalog.json`.

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

Mehrere aktive Suchprofile bleiben unterstützt. Empfängerbasierte Deduplizierung verhindert doppelte Telegram-Zustellungen desselben Treffers.

## Datenfluss

1. Cron ermittelt fällige Sources und schreibt Jobs in PGMQ `source_jobs`.
2. `source-job-runner` claimt Jobs und ruft den bereits bestehenden Worker auf.
3. Source-Routing: `source-immoscout`, `source-kleinanzeigen`, `source-immowelt`, `source-immomio` oder `source-engine`.
4. Bestehende Adapter schreiben unverändert in `listings`.
5. DB-Trigger erzeugen `listing_occurrences` und `canonical_listings`.
6. Passende Profile werden als `matches` gespeichert.
7. `notification_outbox` erzeugt kompatible `delivery_events`.
8. Der bestehende `notification-dispatcher` prüft das Profil nochmals und sendet die Telegram-Karte.
9. Versandstatus wird zurück in die Outbox gespiegelt.
10. Verfügbarkeit wird nur nach drei erfolgreichen, vollständigen Crawls eines tatsächlich verwendeten `enumerable`-Connectors herabgestuft.

## Architektur

Die vollständigen Invarianten und das Diagramm stehen in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository

```text
.github/workflows/
  architecture-check.yml

data/
  source_catalog.json

docs/
  ARCHITECTURE.md
  source-connectors.md

supabase/
  functions/
    telegram-ui/
    telegram-webhook/
    notification-dispatcher/
    source-job-runner/
    source-engine/
    source-immoscout/
    source-kleinanzeigen/
    source-immowelt/
    source-immomio/
  migrations/
  seed.sql
```

## Betrieb

Die funktionierenden Source-Adapter bleiben getrennt von der Orchestrierung. Architekturänderungen sollen deshalb bevorzugt Queue-, Datenmodell-, Matching-, Observability- oder GitOps-Schichten verändern, nicht funktionierende Provider-Adapter.

Login-Schranken, CAPTCHAs oder Anti-Bot-Schutz werden nicht umgangen. HTTP-401/403-, TLS- oder Netzwerkfehler bleiben im Monitoring sichtbar und verwenden kontrolliertes Backoff.

## Secrets

Secret-Werte liegen ausschließlich in Supabase. Produktionswerte dürfen niemals committed werden.
