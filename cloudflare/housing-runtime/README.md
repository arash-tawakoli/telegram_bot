# Traumwohnung Housing Runtime

Cloudflare Worker für den Housing-Kern von TraumWohnungHamburg.

## Zielarchitektur

- Worker: API, Auth/Session, Quellen, Matching, Zustellungen und Bewerbungsstatus.
- D1: primäre Housing-Datenbank `traumwohnung-housing-core`.
- R2: Teilnehmerdokumente im Bucket `traumwohnung-applicant-documents`.
- Cron: eine Allowlist-Quelle pro Minute, frische Zustellungen und ein frischer Bewerbungs-Claim.
- Telegram: bestehender Gateway/UI-Vertrag bleibt unverändert; Cloudflare validiert und dedupliziert den WebHook davor.

Hyperdrive und ein externer PostgreSQL-Host gehören nicht mehr zum Zielbetrieb.

## ImmoScout24 MCP (nur Deutschland)

Der Housing-Worker nutzt den ImmoScout24-MCP-Server `https://app.chatgpt.immobilienscout24.de/v2/mcp` über JSON-RPC 2.0 (Protokoll `2025-06-18`). Vor dem ersten `tools/call` führt der gemeinsame Cloudflare-Client `initialize` und `notifications/initialized` aus. Er nutzt das bestätigte Protokoll und eine optionale `Mcp-Session-Id`, teilt die initialisierte Verbindung im Worker und erneuert eine abgelaufene Session (HTTP 404) einmalig. Bei fehlgeschlagener Initialisierung erfolgt kein Toolaufruf.

| MCP-Tool | Einsatz |
| --- | --- |
| `property_search_de` | Suche im gemeinsamen HH-/SH-Abruf und read-only Coach-Suche |
| `property_map_de` | Ergänzt beim automatischen Abruf Warmmiete, Nebenkosten und Koordinaten; on-demand Kartenabfrage bleibt read-only |

Österreichische MCP-Tools (`property_search_at`, `property_map_at`) sind nicht integriert.

**Authentifizierter Portal-API-Zugriff:** `POST /edge/coach` mit dem bestehenden Portal-Access-Token, dem Feld `action` und `sourceId` (nur `1` für Hamburg oder `69` für Schleswig-Holstein).

- `action: "immoscout_search"` ruft `property_search_de` auf und liefert maximal 25 normalisierte Angebote als `entries`.
- `action: "immoscout_map"` ruft `property_map_de` auf und liefert maximal 200 Positionen mit `latitude`/`longitude` als `points`.
- Optionale Eingaben: `query` (regionale Suchkriterien als Freitext, maximal 180 Zeichen), `limit` (1–25 bzw. 1–200).
- Die Region und Deutschland werden serverseitig vorangestellt. Nicht erlaubte Quell-IDs und österreichische Ortsanfragen werden abgewiesen.
- Beide API-Aktionen sind rein lesend. Der Kartenaufruf erstellt keine Zustellungen, Bewerbungen oder Datenbankeinträge. Ein Frontend kann die Geo-Daten für seine eigene Kartenansicht verwenden; die ChatGPT-MCP-Widget-Oberfläche wird nicht übernommen.

**Gemeinsamer ImmoScout24-Workflow für Hamburg und Schleswig-Holstein:** Beide Quell-IDs (1 und 69) verwenden dieselbe Pipeline und denselben 10-Minuten-Takt. Aus aktiven Suchprofilen werden regionale Suchbegriffe (Bundesland, Hamburger Bezirke/Stadtteile, Schleswig-Holsteiner Gemeinden/Kreise) und Wohnformen abgeleitet. Pro Quellenlauf erfolgt **eine gezielte** `property_search_de`-Abfrage und **eine** ergänzende `property_map_de`-Abfrage mit identischem Suchbegriff. Treffer werden anhand der ImmoScout24-ID dedupliziert; Karteninformationen ergänzen fehlende Daten der Suche. Maximal 15 zusätzliche Kartentreffer werden je Lauf verarbeitet. Schlägt die Karte fehl, bleiben Suchtreffer nutzbar.

Die normale MCP-Suche liefert `price.value` (Grund-/Kaltmiete); nur `totalRent` gilt als bestätigte Warmmiete. Angebote ohne bestätigte Warmmiete werden **nicht als Treffer innerhalb eines Warmmietlimits** zugestellt. Die bestehenden Bewerbungsfreigaben und Idempotenzschlüssel bleiben unverändert; Bewerbungen verwenden weiterhin die getrennte ImmoScout24-REST-Kontaktschnittstelle. Zusätzliche MCP-Ressourcen oder ein ChatGPT-Widget sind nicht Teil des Housing-Workers. Ein direkter Live-Protokolltest vom 15.11.2026 bestätigte `initialize` (HTTP 200), `notifications/initialized` (HTTP 202), `tools/list` (HTTP 200) und beide deutschen Tools. Der Server gab keine Session-ID zurück; der Client unterstützt sie dennoch für zukünftige Stateful-Transporte. Die Nutzungsberechtigung wurde vom Betreiber separat geklärt.

## Datenumfang

Gespeichert werden nur Teilnehmer, Portalmitglieder, Zuweisungen, Suchprofile, Bewerberprofile, Quellenverknüpfungen, Providerstatus, Dokumentreferenzen, minimale Angebotsidentitäten, Zustellungen, Bewerbungen, Events, Jobs und Auditdaten.

Vollständige Anzeigentexte werden nicht gespeichert. Zustellungen und Bewerbungen haben eindeutige Idempotenzschlüssel. Abgelaufene Angebotsfakten werden in begrenzten Batches gelöscht.

## Quellen

Produktiv sind **sieben Quellen**: ImmoScout24 Hamburg/Schleswig-Holstein, Immowelt Hamburg sowie vier Immomio-Baugenossenschaften mit nachgewiesener Angebotszustellung: **Hamburger Wohnen (23), VHW (29), Walddörfer (35), GEWOBA Nord (66)**. Qualifikation: erfolgreicher Immomio-Homepage-GraphQL-Abruf, mindestens ein Angebot mit gültigem `tenant.immomio.com/apply/<uuid>`-Link sowie mindestens eine erfolgreiche Telegram-Zustellung.\n\nAndere genossenschaftliche Quellen werden nicht verarbeitet. Die früheren IDs 30, 32, 34, 36, 39 sind im D1-Cleanup `0024_prune_non_delivering_cooperatives.sql` entfernt; historische Quellenaudits und Migrationen bleiben als Nachweis erhalten. Immowelt Schleswig-Holstein (71) bleibt separat deaktiviert und wird hier nicht verändert. Nicht allowlistete Quellen werden im Worker abgewiesen.

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
