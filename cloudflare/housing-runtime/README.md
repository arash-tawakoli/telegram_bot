# Traumwohnung Housing Runtime

Cloudflare Worker für den Housing-Kern von TraumWohnungHamburg.

## Zielarchitektur

- Worker: API, Auth/Session, Quellen, Matching, Zustellungen und Bewerbungsstatus.
- D1: primäre Housing-Datenbank `traumwohnung-housing-core`.
- R2: Teilnehmerdokumente im Bucket `traumwohnung-applicant-documents`.
- Cron: eine Allowlist-Quelle pro Minute, frische Zustellungen und ein frischer Bewerbungs-Claim.
- Telegram: bestehender Gateway/UI-Vertrag bleibt unverändert; Cloudflare validiert und dedupliziert den WebHook davor.

Hyperdrive und ein externer PostgreSQL-Host gehören nicht mehr zum Zielbetrieb.

## Datenumfang

Gespeichert werden nur Teilnehmer, Portalmitglieder, Zuweisungen, Suchprofile, Bewerberprofile, Quellenverknüpfungen, Providerstatus, Dokumentreferenzen, minimale Angebotsidentitäten, Zustellungen, Bewerbungen, Events, Jobs und Auditdaten.

Vollständige Anzeigentexte werden nicht gespeichert. Zustellungen und Bewerbungen haben eindeutige Idempotenzschlüssel. Abgelaufene Angebotsfakten werden in begrenzten Batches gelöscht.

## Quellen

Aktiv sind neun Quellen: ImmoScout24 Hamburg/Schleswig-Holstein, Immowelt Hamburg/Schleswig-Holstein und fünf funktionierende Tenant.immoMio-Quellen. Nicht allowlistete Quellen werden im Worker abgewiesen.

## D1-Setup

```sh
npx wrangler d1 execute traumwohnung-housing-core --remote --file schema/d1/0001_housing_core.sql
npm run target:d1-verify
```

Der Snapshot-Import wurde bereits remote ausgeführt. Der erste Portal-Admin wird nach dem Import mit einem kurzen Token eingerichtet:

```sh
BOOTSTRAP_TOKEN_FILE=/secure/bootstrap-token.txt npm run bootstrap:d1-token
```

Für D1 wird der Token in der D1-Tabelle angelegt; `TARGET_DATABASE_URL` ist in diesem Zielpfad nicht erforderlich.

## Aktueller Stand

- Telegram und Coach-Portal laufen über diesen Worker und D1; die bestehende Telegram-Oberfläche bleibt unverändert.
- Provider-Login-Flows laufen über den Cloudflare-Login-Worker und verschlüsselte D1-Verbindungen.
- ImmoScout24 und Immowelt haben Cloudflare-native Bewerbungsadapter. Immomio bleibt bei einer nicht bestätigten Formularübertragung bewusst `manual_required`; CAPTCHA- oder externe Sicherheitsprüfungen werden nicht automatisiert umgangen.

## Prüfung

```sh
npm run check
npm test
```

`/edge/ready` muss `role: cloudflare-d1`, 22 Housing-Tabellen, die drei zentralen ImmoScout-D1-Tabellen und `dataImported: true` melden. Die öffentliche Antwort bestätigt nur Schema und Importstatus und enthält keine Teilnehmer-, Angebots-, Zustell- oder Bewerbungszeilenzahlen.

## Stripe Premium – Cloudflare-D1-Cutover (vorbereitet)

- Neuer Worker-Endpunkt: `POST /edge/stripe/webhook` (direkt an die Housing Runtime richten).
- Verifizierung: Stripe `Stripe-Signature` mit 5-Minuten-Zeitfenster und dem **Cloudflare Worker Secret** `STRIPE_WEBHOOK_SIGNING_SECRET`.
- D1-Migration: `schema/d1/0007_stripe_webhook_events.sql` **einmalig** nach Sicherung anwenden.
- Der Webhook aktualisiert `user_subscriptions` atomar mit einem D1-Ereignisprotokoll; alte Stripe-Ereignisse überschreiben keine neueren Entitlements.
- Stripe-Endpunkt im Stripe-Dashboard **erst nach erfolgreichen Smoke-Tests** auf die Cloudflare-Adresse umstellen, und das Supabase-Webhook erst danach deaktivieren.
- Vor der Umstellung das vorhandene Stripe-Webhook-Signing-Secret vertraulich als Worker Secret setzen; keine Secrets in Git oder Logs eintragen.
- Benötigte Ereignisse: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
- Der neue Handler aktualisiert noch **keine Telegram-Zahlungsbenachrichtigungen**; diese müssen vor vollständiger Funktionsparität ergänzt und getestet werden.
- Dies ist **keine** Migration gespeicherter Bewerbungen oder Bewerbungsereignisse.
