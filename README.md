# Traumwohnung Hamburg Bot

Backend für `@traumwohnunghamburgbot`: automatische Wohnungssuche in Hamburg über 65 konfigurierte Quellen, Suchprofil-Matching und Telegram-Push.

## Stack

- **Telegram Bot API** – Menü, Onboarding und Inserat-Push
- **Supabase Postgres** – Nutzer, Suchprofile, Quellen, Listings, Deduplizierung und Logs
- **Supabase Edge Functions** – Telegram-Webhook und Source-Adapter
- **Supabase Cron + pg_net** – zeitgesteuertes Crawling
- **Supabase Vault** – Bot-Token und interne Secrets; keine Secrets im Repository

## Quellenlogik

Die Mastertabelle wird auf höchstens drei Connector-Stufen abgebildet:

- P1 = Primär
- P2 = Fallback 1
- P3 = Fallback 2

K1/K2/K3 laufen aktuell alle 15/30/60 Minuten. Quelle 64 bleibt deaktiviert, da kein bestätigter digitaler Listing-Connector vorliegt. Die vollständige Registry steht in `docs/source-connectors.md`.

## Telegram Commands

- `/start`
- `/suche`
- `/profile`
- `/pause`
- `/resume`
- `/status`
- `/delete`
- `/hilfe`

Während eines Workflows steht zusätzlich `/abbrechen` zur Verfügung.

## Onboarding

`/suche` fragt bewusst nur die wichtigsten Kriterien ab:

1. maximale Warmmiete
2. Mindestzimmer
3. Mindestfläche
4. Stadtteile oder ganz Hamburg
5. nur WBS: ja/nein

Pro Telegram-Nutzer sind maximal drei Suchprofile vorgesehen.

## Datenfluss

1. Cron wählt fällige Quellen anhand ihres K1/K2/K3-Intervalls aus.
2. `source-engine` probiert P1 und danach höchstens P2/P3.
3. Immowelt nutzt zusätzlich den spezialisierten Adapter `source-immowelt`.
4. Inserate werden normalisiert und je Quelle dedupliziert; zusätzlich wird ein Cross-Source-Hash gebildet.
5. Der erste erfolgreiche Lauf einer Quelle ist ein Warm-up und versendet keine historischen Inserate.
6. Danach werden nur neue Inserate gegen aktive Suchprofile gematcht und per Telegram verschickt.
7. Crawls und Zustellungen werden protokolliert.

## Repository

```text
supabase/
  functions/
    telegram-webhook/
    source-engine/
    source-immowelt/
  migrations/
    202608260001_core_schema.sql
  seed.sql
docs/
  source-connectors.md
```

## Secrets

Erforderliche Vault-Namen:

- `telegram_bot_token`
- `telegram_webhook_secret`
- `internal_worker_secret`

Die Secret-Werte gehören ausschließlich in Supabase Vault und dürfen niemals committed werden.

## Betriebshinweis

Der Crawler verwendet ausschließlich öffentlich erreichbare Anbindungen. Login-Schranken, CAPTCHAs oder Anti-Bot-Schutz werden nicht umgangen. Quellen, die serverseitig mit 401/403 oder TLS-/Netzwerkfehlern antworten, bleiben im Monitoring sichtbar und werden nicht durch unsichere Workarounds umgangen.
