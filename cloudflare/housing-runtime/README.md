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

## Übergangsgrenzen

- Telegram Gateway/UI bleibt vorübergehend die bestehende Supabase-Funktion, damit die sichtbare Telegram-Oberfläche unverändert bleibt.
- Provider-Login-Flows bleiben vorübergehend über den bestehenden Login-Vertrag erreichbar.
- ImmoScout24 und Immowelt haben Cloudflare-native Bewerbungsadapter. ImmoMio bleibt bis zur verifizierten nativen Formularübertragung `manual_required`.

## Prüfung

```sh
npm run check
npm test
```

Der aktuelle Housing Runtime-Stand besteht 41 Runtime-Tests; die vollständige Backend-Suite besteht 371 Tests. `/edge/ready` muss `role: cloudflare-d1`, 20 Tabellen und `dataImported: true` melden.
