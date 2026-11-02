# Housing Core – Scope, Cleanup und Zielarchitektur

**Stand:** 02.11.2026  
**Status:** Read-only-Bestandsaufnahme und Umsetzungsvorschlag  
**Geltungsbereich:** Traumwohnung Hamburg / Schleswig-Holstein, Telegram-Wohnungssuche und optionale Auto-Bewerbung  
**Wichtig:** Dieses Dokument ändert weder Produktionscode noch Datenbank, Secrets, Provider-Konfiguration oder Cloudflare-Ressourcen.

---

## 1. Architekturentscheidung

Eine vollständige Migration von Supabase nach Cloudflare ist für den Housing Core nicht sinnvoll und wird nicht empfohlen.

**Zielbild:**
- Supabase bleibt Datenbank, Authentifizierungs- und Geschäftslogik-Plattform.
- Cloudflare bleibt selektive Execution-Schicht für bereits vorhandene Provider-Sessions und zentrale ImmoScout-Credentials.
- Die Wohnungssuche, Source-Verarbeitung, Matching, Telegram-Zustellung und Bewerbungsorchestrierung bleiben eng an PostgreSQL gebunden.
- Job Search / Indeed MCP wird aus dem Housing-Produkt entfernt, sofern keine separate Fortführung beschlossen wird.
- Coach-Portal und Premium/Billing bleiben getrennte Module. Sie sind nicht Teil des öffentlichen Housing Core, werden aber nicht ohne gesonderte Geschäftsentscheidung gelöscht.

**Nicht durchführen:**
- PostgreSQL nach D1 kopieren.
- 207 SQL-Funktionen pauschal portieren.
- Source Worker oder Notification Dispatcher ohne Ersatz ihrer atomaren Datenbanklogik nach Cloudflare verschieben.
- Alle deaktivierten Quellen oder Shadow-Connectoren löschen.
- Historische Migrationen umschreiben oder entfernen.

## 2. Verifizierter Produktionsbestand

### Supabase

| Bereich | Bestand |
|---|---:|
| Datenbankgröße | ca. 308 MB |
| Tabellen | 68 (54 public, 14 app_private) |
| SQL-/PLpgSQL-Routinen | 207 |
| PL/pgSQL-Routinen | 153 |
| SQL-Routinen | 54 |
| SECURITY DEFINER-Routinen | 66 |
| Trigger-Funktionen | 42 |
| Trigger-Instanzen | 44 |
| Cron-Jobs | 13 (10 aktiv, 3 inaktiv) |
| PGMQ-Queues | 1: source_jobs |
| Erweiterungen | 11 |
| Tabellen mit RLS | 68 |
| Explizite RLS-Policies | 6 |

Die 62 Tabellen ohne eigene Policy sind nicht automatisch öffentlich. Vor Änderungen müssen Grants, Service-Role-Zugriffe und API-Pfade gemeinsam geprüft werden.

### Housing-Quellen und Connectoren

| Bestand | Anzahl |
|---|---:|
| Registrierte Wohnungsquellen | 73 |
| Aktivierte Quellen | 38 |
| Deaktivierte Quellen | 35 |
| Connector-Konfigurationen | 196 |
| Aktivierte Connectoren | 134 |
| Shadow-only-Connectoren | 124 |
| Enumerable Connectoren | 47 |

Shadow-only und enabled sind keine gegenseitig ausschließenden Kategorien.

**Entscheidung:** Alle verifizierten Housing-Quellen für Hamburg und Schleswig-Holstein bleiben grundsätzlich erhalten. Deaktivierte Quellen bleiben zunächst als Katalog-/Reaktivierungsdaten bestehen. Nur aktive, belegte Connector-Pfade werden produktiv ausgeführt. Die Anzahl der Quellen wird nicht künstlich auf vier Portale reduziert.

Die vier zentralen Plattformen bleiben:
- ImmoScout24
- Immowelt
- Kleinanzeigen
- WG-Gesucht

Immomio bleibt als Provider-Authentifizierungs- und Bewerbungsintegration erhalten. Es ist nicht mit einem eigenständigen öffentlichen Listing-Portal gleichzusetzen.

### Cloudflare

Aktuell sind vier Worker vorhanden:

| Worker | Entscheidung | Begründung |
|---|---|---|
| traumwohnung-platform-connect | Behalten | Browser Binding und Durable Object für Kleinanzeigen-Login-Sessions |
| immoscout-central-token-staging | Behalten | Zentraler ImmoScout OAuth-/Credential-Flow mit EU-D1 |
| traumwohnung-coach-portal | Separat behalten | Internes Housing-Coach-Portal |
| traumwohnung-coach-portal-bridge | Separat behalten | Service-Binding zum Coach Portal |

Der zentrale ImmoScout-Worker verwendet D1 mit den Anwendungstabellen central_credentials, audit_events und oauth_flows. Die vorhandenen Worker-Bindings und Secrets bleiben unverändert.

Cloudflare R2 ist derzeit nicht aktiviert; Cloudflare Queues sind nicht angelegt. Für die vorgeschlagene Minimalarchitektur werden beide nicht benötigt. Supabase Storage und PGMQ bleiben bestehen.

## 3. Housing Core – behalten

### 3.1 Wohnungssuche und Source-Ingestion

Behalten:
- Source Registry und Connector-Konfiguration
- Source Scheduler und Source Jobs
- PGMQ-Queue source_jobs
- Source Worker und alle verifizierten Provider-Adapter
- Crawl Runs, Coverage, Category Streams und Regional-Geografie
- Listing-Normalisierung, Qualitätsprüfung und Deduplizierung
- Search Profiles, Matching und Neuheitsprüfung
- Saved Listings und Telegram-Delivery

Kritische Tabellen:
- public.sources
- public.source_connectors
- public.source_jobs
- public.crawl_runs
- public.listings
- public.listing_changes
- public.listing_dedupe_groups
- public.source_coverage_state
- public.geo_areas
- public.geo_area_aliases
- public.geo_area_postal_codes
- public.hamburg_boroughs
- public.hamburg_neighborhoods
- public.cooperative_provider_registry
- app_private.source_category_streams
- app_private.source_neighborhood_coverage
- app_private.hamburg_neighborhood_aliases
- app_private.coop_provider_index_requests

Die Schleswig-Holstein-Abdeckung, regionale Kategorie-Streams und die Source-Coverage-Daten sind produktrelevant und dürfen nicht als unnötige Diagnose-Daten entfernt werden.

**Wichtige Namensabgrenzung:** public.source_jobs ist die Queue für Wohnungsquellen. Sie ist nicht Teil der Job Search und muss erhalten bleiben.

### 3.2 Telegram und Zustellung

Behalten:
- Telegram Gateway, Fast Path und kanonische UI
- Inbox Claims und Retry-/Recovery-Mechanismen
- Notification Dispatcher
- Delivery Events und Idempotenz
- Saved Listings
- Suchprofil- und Standortauswahl
- Telegram-Linking und erforderliche UI-Aktionen

Kritische Tabellen:
- public.bot_users
- public.bot_events
- public.search_profiles
- public.delivery_events
- public.saved_listings
- public.user_destinations
- public.notification_preferences
- public.telegram_announcements
- public.user_engagement_notifications
- app_private.dispatch_control
- app_private.telegram_effects
- app_private.telegram_link_tokens
- app_private.ui_action_jobs

### 3.3 Auto-Bewerbung und Plattformverbindungen

Die Auto-Bewerbung bleibt Bestandteil des Housing Core.

Behalten:
- Bewerberprofil und Pflichtfeldprüfung
- Private Bewerbungsdokumente und Dokumentpakete
- Application Queue, Claims, Leases und Idempotenz
- Provider-Verbindungen und Re-Authentifizierung
- ImmoScout24-, Immowelt-, Kleinanzeigen-, Immomio- und WG-Gesucht-Integrationen
- Bewerbungsereignisse und Statusabgleich

Kritische Tabellen:
- public.applicant_profiles
- public.applicant_documents
- public.application_preferences
- public.applications
- public.application_events
- public.application_document_packages
- public.application_document_package_items
- public.application_document_transfers
- public.platform_connections
- public.platform_auth_flows
- public.platform_sessions
- public.platform_reauth_notifications
- app_private.application_platforms
- app_private.application_send_keys

Kritische Routinen:
- application_user_eligible
- authorize_application_send
- claim_application
- claim_immomio_application
- claim_kleinanzeigen_application
- claim_platform_connect_flow
- complete_platform_connect_flow
- validate_immomio_application_send
- consume_immomio_application_send
- record_platform_connection_refresh
- applicant_profile_complete
- application_provider_ready
- application_target_ready

### 3.4 Housing-Geografie

Behalten:
- Hamburg-Bezirke und Stadtteile
- Schleswig-Holstein-Kreise, Städte und Gemeinden
- Geo-Aliase und Postleitzahl-Zuordnungen
- Neighborhood-Normalisierung
- Coverage- und Evidence-Daten

Diese Daten sind für die Suchprofile und die regionale Source-Abdeckung erforderlich.

## 4. Separat behalten – nicht Teil des öffentlichen Housing Core

### 4.1 Interne Coach-Funktionen

Das Coach-Portal bleibt als eigenständiges internes Modul bestehen, solange NexaLabs die Teilnehmerbetreuung für Wohnungssuche und Bewerbungen benötigt.

Behalten, aber klar vom öffentlichen Housing Core trennen:
- coaching_workspaces
- coaching_members
- coaching_participants
- coaching_audit_events
- coaching_request_keys
- app_private.coach_bootstrap_tokens
- app_private.coaching_super_admin_allowlist
- coach-api für Housing-Teilnehmer, Bewerbungsübersichten, Dokumente, Suchprofile und Source Health

Der Coach API Worker ist gemischt: Er enthält Housing-Funktionen und Job-Search-Routen. Der gesamte Worker darf deshalb nicht gelöscht werden. Nur die Job-spezifischen Routen werden separat entfernt.

### 4.2 Premium, Stripe und Referral

Diese Funktionen sind nicht zwingend für die technische Wohnungssuche erforderlich, gehören aber zum bestehenden Produkt- und Geschäftsmodell.

Zunächst behalten:
- public.user_subscriptions
- public.stripe_webhook_events
- public.referral_codes
- public.referrals
- telegram-premium
- stripe-webhook
- billing-maintenance
- Premium-Benachrichtigungen

Eine spätere Abschaltung ist eine Produkt-/Geschäftsentscheidung und keine technische Voraussetzung für den Housing Core.

## 5. Job Search / Indeed MCP – aus dem Housing Scope entfernen

Der Job-Search-Pilot ist fachlich vom Housing Core getrennt. Er ist der erste klare Kandidat für eine kontrollierte Entfernung.

### 5.1 Job-spezifische Tabellen

| Tabelle | Aktuelle Zeilen | Entscheidung |
|---|---:|---|
| job_search_profiles | 1 | Exportieren, dann entfernen |
| jobseeker_profiles | 0 | Entfernen |
| job_application_preferences | 0 | Entfernen |
| job_applications | 0 | Entfernen |
| coaching_indeed_mcp_auth_flows | 1 | Abgelaufenen Flow sichern, dann entfernen |
| coaching_indeed_mcp_connections | 0 | Entfernen |
| coach_resume_drafts | 0 | Entfernen, falls CV-/Job-Workflow ebenfalls beendet wird |

Die eine vorhandene Job-Suchprofil-Zeile wird vor einer Löschung gesichert. Der Inhalt wurde bei dieser Bestandsaufnahme nicht ausgelesen.

### 5.2 Job-spezifische Funktionen und Routen

Entfernungskandidaten:
- indeed-mcp-bridge (live Version 9)
- Indeed OAuth-Zweige in auth-facade-broker
- Indeed-Provider-Zweig in coach-api
- coach-api Aktionen jobseekers und jobseeker
- coach-api CRUD-Routen für coach_resume_drafts, sofern CV-Drafts nicht separat benötigt werden
- public.set_indeed_partner_credentials
- Indeed-spezifische Provider-Erweiterung in coach_issue_platform_connect_flow

Die Funktionen auth-facade-broker und coach-api bleiben bestehen. Nur die Indeed-/Job-Routen werden entfernt.

### 5.3 Gemeinsame Tabellen nicht löschen

public.platform_auth_flows wird von Housing-Providern und Indeed gemeinsam verwendet. Die Tabelle bleibt bestehen.

Produktionsbefund:
- 3 Indeed-Einträge in public.platform_auth_flows; alle drei sind abgelaufen.
- Keine Indeed-Zeile in public.platform_connections.
- 1 abgelaufener Eintrag in coaching_indeed_mcp_auth_flows.
- 0 Einträge in coaching_indeed_mcp_connections.
- Keine Indeed-Secrets in vault.secrets gefunden.

Die Provider-Constraints werden später so angepasst, dass ImmoScout24, Immowelt, Kleinanzeigen, Immomio und WG-Gesucht weiterhin funktionieren, Indeed aber nicht mehr akzeptiert wird.

### 5.4 Wichtige Abgrenzung: JOBSEEKER im Bewerberprofil behalten

Der Wert JOBSEEKER in application-profile-adapters.ts und im Telegram-Bewerberprofil beschreibt den Beschäftigungsstatus eines Wohnungsbewerbers. Er ist für die Mietbewerbung relevant und darf nicht zusammen mit dem Job-Search-Modul entfernt werden.

Ebenso dürfen public.applications und public.search_profiles nicht mit public.job_applications und public.job_search_profiles verwechselt werden.

## 6. Weitere Bereinigungskandidaten

### 6.1 Starke Kandidaten – nach abschließendem Dependency Check entfernen

| Tabelle | Zeilen | Befund |
|---|---:|---|
| route_cache | 0 | Im aktuellen Repository keine aktiven Code-Verwendungen gefunden; nur historische Schema-/Indexreferenz |
| neighborhood_facts | 0 | Keine aktive Code-Verwendung im aktuellen Repository gefunden |
| user_destinations | 0 | Keine aktive Code-Verwendung im aktuellen Repository gefunden |

Vor dem Drop müssen SQL-Funktionsdefinitionen, Trigger, dynamisches SQL, externe API-Clients und Runtime-Archive erneut geprüft werden. Die Tabellen werden nicht in dieser Vorbereitungsphase gelöscht.

### 6.2 Behalten, bis die Diagnose-/Shadow-Funktion abgeschlossen ist

| Tabelle | Zeilen | Entscheidung |
|---|---:|---|
| app_private.source_shadow_runs | ca. 2.295 | Retention und Shadow-Run-Abhängigkeiten prüfen |
| app_private.performance_snapshots | ca. 203 | Kompakte Performance-Historie behalten |
| app_private.coop_provider_index_requests | ca. 584 | Queue-/Backlog-Status prüfen; zugehörige Cron-Jobs sind inaktiv |
| public.immomio_object_resolution_shadow | ca. 51 | Bis zum Abschluss der Immomio-Shadow-Auswertung behalten |
| public.notification_preferences | 0 | Wird noch in Delivery-/Cleanup-SQL referenziert; nicht blind löschen |

### 6.3 Connectoren

124 Connectoren sind als shadow_only markiert. Diese sind nicht automatisch überflüssig.

Vorgehen:
1. Primary- und Fallback-Connectoren mit K1/K2-Evidence behalten.
2. Monitoring-/Shadow-Connectoren ohne aktuelle Aufrufer und ohne neuen Evidence-Wert archivieren.
3. Doppelte HTML-/DOM- und Discovery-Connectoren erst nach Vergleich der Ergebnisse entfernen.
4. Keine Quelle allein deshalb löschen, weil sie derzeit deaktiviert ist.

## 7. Edge Functions – vollständiger Live-Scope

Die aktuelle Live-Abfrage liefert 115 Edge Functions. Der Produktionsabgleich auf dem Branch sync/production-runtime-2026-11-02 ordnet alle 115 Live-Slugs zu.

**Wichtig:** Die Manifestbereiche functions und archived_functions sind Source-/Archivbereiche. Ein archivierter Source-Bundle-Eintrag bedeutet nicht, dass die Funktion in Produktion inaktiv ist.

### 7.1 Housing-/Produktionskern – behalten

- application-package
- application-worker
- immomio-application-worker
- kleinanzeigen-application-worker
- notification-dispatcher
- source-worker
- telegram-fast
- telegram-gateway
- telegram-premium
- telegram-ui

billing-maintenance und coach-api bleiben als getrennte optionale Module bestehen.

### 7.2 Housing-interne Adapter und Provider – behalten, sofern aufgerufen

- covivio-feed
- immobilie1-transport
- immobilien-de-transport
- immomio-auth-bridge
- immoscout-auth-bridge
- immowelt-auth-bridge
- kleinanzeigen-callback-bridge
- kleinanzeigen-transport
- meravis-feed
- noncoop-feed
- noncoop-new-feed
- platform-connect-broker-v2
- platform-session-reminder
- spacest-feed
- source-shadow (bis Shadow-Abschluss)
- telegram-oauth-bridge
- vonovia-transport
- wg-gesucht-auth-bridge
- wunderflats-transport

Der source-worker ruft neun spezialisierte Feed-/Transport-Funktionen direkt auf. Diese sind deshalb keine beliebigen Zusatz-Worker, sondern Teil des Housing-Ingestion-Flows.

### 7.3 Gemischte Funktionen – gezielt verschlanken

- coach-api: Housing-Coach-Funktionen behalten; Jobseeker- und Resume-Draft-Routen entfernen, sofern nicht separat benötigt.
- auth-facade-broker: Housing-OAuth-Flows behalten; Indeed OAuth entfernen.
- application-worker: Housing-Auto-Bewerbung behalten. JOBSEEKER bleibt als Employment-Status im Bewerberprofil erhalten.
- platform-session-reminder: behalten; unterstützt ImmoScout24, Immowelt, Immomio, Kleinanzeigen und WG-Gesucht.

### 7.4 Job-Search-Funktion – entfernen

- indeed-mcp-bridge

Erst entfernen, nachdem die Job-Search-Daten exportiert und die Indeed-OAuth-Flows deaktiviert/abgelaufen sind.

### 7.5 Diagnose-/Canary-/Retired-Funktionen – Review- und Deaktivierungskandidaten

Die folgenden Funktionen sind im Runtime-Manifest entsprechend klassifiziert. Diese Klassifizierung ist noch keine Löschfreigabe.

**Diagnostic (45):**
application-package-selftest, auth-contract-diag, immomio-auth-debug, immomio-bundle-snippet, immomio-chunk-inspect, immomio-contract-inspect, immomio-device-probe, immomio-mutation-contract-probe, immomio-profile-probe, immomio-question-field-probe, immomio-question-inspect, immomio-schema-inspect, immomio-upload-probe, immoscout-contact-inspect, immoscout-contract-inspect-v2, immoscout-official-api-probe, immoscout-payload-probe, immoscout-plus-scan, immowelt-diagnostic-readonly, kleinanzeigen-ad-inspect, kleinanzeigen-apk-direct-stage, kleinanzeigen-apk-inspect, kleinanzeigen-apk-r2-inspect, kleinanzeigen-apk-stage, kleinanzeigen-apkcombo-stage, kleinanzeigen-apkcombo-url, kleinanzeigen-contact-inspect, kleinanzeigen-contract-check, kleinanzeigen-contract-probe, kleinanzeigen-conversation-readback, kleinanzeigen-dex-class, kleinanzeigen-dex-contract, kleinanzeigen-dex-method, kleinanzeigen-dex-xref, kleinanzeigen-dex-xref-any, kleinanzeigen-js-inspect, kleinanzeigen-mobile-probe-v2, kleinanzeigen-re-seeker-probe, kleinanzeigen-seeker-inspect, kleinanzeigen-send-probe, kleinanzeigen-static-analysis, kleinanzeigen-structure-probe, kleinanzeigen-web-contract-probe, kleinanzeigen-xcf-diagnostic-send, noop_probe.

**Canary (12):**
immoscout-official-send-canary, immoscout-send-canary, kleinanzeigen-first-contact-canary, kleinanzeigen-two-step-canary, notification-dispatcher-preview-canary, telegram-db-latency-canary, telegram-gateway-autoapply-canary, telegram-gateway-preview-canary, telegram-gateway-v3-canary, telegram-gateway-v4-canary, telegram-ui-autoapply-canary, telegram-ui-preview-canary.

**Retired (15):**
auth-admin-repair, deploy-merge-test, html-render-test, immomio-introspection-probe, immomio-probe, immomio-tenant-inspect, ka-gateway-egress-probe, kleinanzeigen-direct-login-probe, kleinanzeigen-mobile-canary, kleinanzeigen-refresh-probe, mini-app, mini-app-publisher, platform-connect, telegram-webhook-region-switch, wunder-probe.

**Support Review (6):**
coach-bootstrap, immomio-account, immoscout-native-handoff, kleinanzeigen-method-raw, kleinanzeigen-send-once-v3, noop.

Die 45 Diagnostic-, 12 Canary- und 15 Retired-Funktionen ergeben 72 konkrete Review-Kandidaten. Nicht alle dürfen sofort gelöscht werden: insbesondere Send-Canaries, Provider-Handoff-Funktionen und Immomio-/Kleinanzeigen-Adapter müssen auf tatsächliche Aufrufer und mögliche reale Aktionen geprüft werden.

Die beiden Public Assets telegram-fallback-logo und telegram-premium-image bleiben, solange UI-Referenzen bestehen. stripe-webhook bleibt, solange Stripe/Premium aktiv ist.

## 8. PostgreSQL-Routinen, Trigger und Cron

### Housing-kritische Routinen – behalten

- enqueue_due_source_jobs
- claim_source_jobs
- finish_source_job
- finish_source_job_attempt
- claim_source_category_streams
- finish_source_category_stream
- ingest_listing_batch_v3
- record_crawl_result
- record_connector_lane_result
- record_source_neighborhood_coverage
- deactivate_missing_source_listings
- classify_listing_category
- matches_property_filters
- matches_property_category
- assign_listing_dedupe
- refresh_listing_dedupe_group
- user_listing_matches_active_search
- category_delivery_qualified
- delivery_newness_qualified
- claim_telegram_update
- finish_telegram_update
- prepare_telegram_update
- toggle_saved_once
- acquire_dispatcher
- dispatcher_slot
- release_dispatcher
- claim_application
- authorize_application_send
- claim_immomio_application
- claim_kleinanzeigen_application
- claim_platform_connect_flow
- complete_platform_connect_flow
- get_bot_secret

**Job-spezifische Routine:** public.set_indeed_partner_credentials. Sie wird nach Entfernung der Indeed-Integration entfernt. Die generische Secret-Funktion public.get_bot_secret bleibt.

### Trigger

44 Trigger-Instanzen sind registriert. Die Trigger auf listings, delivery_events, applications, bot_users, search_profiles, saved_listings und platform_connections sichern Qualitätsprüfung, Deduplizierung, Matching, Idempotenz und Zustellung.

Sie bleiben erhalten, bis ihre jeweilige Geschäftslogik explizit in einen getesteten Ersatz überführt wurde. Coaching-Trigger bleiben separat, solange das interne Housing-Coach-Portal genutzt wird.

### Cron

**Aktive, Housing-relevante Jobs:**
- source-scheduler-every-minute
- source-dead-letter-retry-every-5-minutes
- notification-dispatcher-every-minute
- platform-applications
- platform-session-reminder
- telegram-inbox-recovery
- backend-maintenance-hourly
- cron-history-retention-daily

**Optional / separates Modul:**
- expire-admin-premium-overrides
- telegram-engagement-hourly

**Derzeit inaktiv:**
- coop-provider-index-enqueue
- coop-provider-index-process
- source-shadow-probes

Inaktive Jobs erst entfernen, nachdem die zugehörigen Tabellen, Backlogs und manuellen Admin-Aufrufe geprüft wurden.

### Erweiterungen

Für die aktuelle Architektur bleiben pg_cron, pg_net, pgmq, pg_trgm, pgcrypto, supabase_vault, uuid-ossp und plpgsql erforderlich bzw. direkt mit den bestehenden Abläufen verbunden.

hypopg, index_advisor und pg_stat_statements sind Diagnose-/Performance-Werkzeuge. Ihre Entfernung bringt für den Housing Core keinen relevanten Architekturgewinn und ist nicht Teil der ersten Bereinigung.

## 9. Zielarchitektur nach Bereinigung

### Supabase bleibt

- PostgreSQL und Auth
- Housing-Tabellen und Geschäftslogik
- Source Scheduler, PGMQ und Source Worker
- Listing-Normalisierung, Qualitätsprüfung, Deduplizierung und Matching
- Telegram Gateway/Fast/UI und Dispatcher
- Auto-Bewerbung und Dokumente
- Provider-Verbindungen und Re-Authentifizierung
- Cron, pg_net, Vault und Storage

### Cloudflare bleibt selektiv

- traumwohnung-platform-connect für Browser-/Login-Sessions
- immoscout-central-token-staging für zentrale ImmoScout-Credentials
- Coach-Portal und Bridge als getrennte interne Dienste

**Es wird kein weiteres Supabase-Backend nach D1 migriert.** Es werden keine neuen R2-Buckets, Cloudflare Queues oder Workflows nur für eine vermeintlich einheitliche Architektur angelegt.

## 10. Vereinfachung und Repository-Struktur

Die Supabase-Deployment-Slugs bleiben stabil. Eine vollständige Umbenennung der Function-Verzeichnisse wäre riskant und bringt keinen unmittelbaren Nutzen.

Ziel:
- Provider-Adapter innerhalb der bestehenden Worker klar gruppieren.
- Gemeinsame Auth-, Credential-, Retry- und HTTP-Helfer nur dort teilen, wo Verhalten und Sicherheitsgrenzen identisch sind.
- Housing- und Job-Search-Code nicht in denselben Modulen vermischen.
- Coach-API Housing-Routen und interne Administration klar von Job-Routen trennen.
- Keine doppelten Provider-Implementierungen.
- Diagnosecode aus produktiven Business-Flows herauslösen.
- Test-Fixtures, Runtime-Archive und Migration-Registry erhalten.
- Jede Löschung über einen neuen, reversiblen SQL-Migrationsschritt dokumentieren.
- Alte Migrationen und Runtime-Snapshots niemals nachträglich umschreiben.

## 11. Ponytail – strenge Review-Kriterien

Das bisher bekannte Ponytail-Setup ist ein lokaler Git-Hook unter ~/.config/git/hooks/ponytail-review. Es ist kein in diesem Chat verbundenes GitHub-Plugin. Ein separater „Ultra Mode“-Schalter ist in der bekannten Hook-Konfiguration nicht dokumentiert; die folgenden Kriterien definieren daher die strenge Review-Stufe.

Jeder Code-Änderungssatz muss:
1. ausschließlich den tatsächlichen staged diff prüfen;
2. Overengineering, Duplikate und unnötige Abstraktionen ablehnen;
3. tote Codepfade und ungenutzte Abhängigkeiten nachweisen;
4. alle DB-, Cron-, Trigger-, Worker- und externen Caller berücksichtigen;
5. Sicherheit, Idempotenz, Retry-Verhalten und Datenintegrität prüfen;
6. Tests für die betroffenen Housing-Provider und den End-to-End-Zustellpfad ausführen;
7. keine Tests nur deshalb ändern, damit eine Implementierung grün wird;
8. keine Secrets oder personenbezogenen Inhalte in Logs aufnehmen;
9. keine Produktionsänderung ohne explizite Freigabe ausführen.

Der lokale Ponytail-Hook wurde in dieser Vorbereitungsphase nicht ausgeführt.

## 12. Umsetzung in sicheren Phasen

### Phase 0 – Source-of-Truth herstellen
- PR #92 mit dem Live-Runtime-Abgleich abschließen.
- Die vier aktuell fehlgeschlagenen Architekturtests korrigieren.
- Erst nach grünem Runtime- und Migration-Check refaktorieren.

PR #92 ist derzeit offen. Der letzte geprüfte Lauf hatte 400 bestandene und 4 fehlgeschlagene Tests:
- disconnected account is rejected before provider access
- runtime manifest records both deployed personal test-mode functions
- runtime architecture has no legacy Schnellbewerbung/manual apply callback path
- all live function bundles have an explicit operational classification

### Phase 1 – Job Search isolieren und entfernen
- Ein Job-Suchprofil exportieren.
- Abgelaufene Indeed-Auth-Flows sichern und entfernen.
- Indeed-MCP-Bridge und Indeed-OAuth-Pfade entfernen.
- Jobseeker-Routen aus coach-api entfernen.
- Job-Tabellen und set_indeed_partner_credentials in einer neuen Migration entfernen.
- Coach-Resume-Drafts nur entfernen, wenn die separate CV-Funktion ebenfalls beendet wird.
- Shared Housing Provider Auth, WG-Gesucht und JOBSEEKER als Bewerberstatus erhalten.

### Phase 2 – Dead Code und Datenbankkandidaten
- route_cache, neighborhood_facts und user_destinations abschließend auf DB-/API-Abhängigkeiten prüfen.
- Erst danach mit einer reversiblen Migration entfernen.
- 72 Diagnostic-/Canary-/Retired-Funktionen anhand von Logs und Callern einzeln deaktivieren und archivieren.
- Shadow-only Connectoren anhand ihrer Evidence und letzten Nutzung reduzieren.
- Shadow- und Performance-Daten nach definierter Retention archivieren.

### Phase 3 – Housing-Code vereinfachen
- Doppelte Provider-Logik konsolidieren.
- Tote Wrapper entfernen, sofern der Source Worker sie nicht mehr aufruft.
- Gemeinsame Module klein und fachlich eindeutig halten.
- Deploy-Slugs und API-Verträge stabil lassen.

### Phase 4 – Sicherheits- und Performanceprüfung
- Alle 77 Funktionen mit verify_jwt=false auf interne Authentifizierung prüfen.
- SECURITY DEFINER-Funktionen und Grants prüfen.
- RLS/Policies und Service-Role-Grenzen testen.
- Queue-, Dispatcher- und Bewerbungs-Idempotenz testen.
- Lasttests für Source Worker und Zustellung ausführen.

### Phase 5 – Abnahme
- Hamburg und Schleswig-Holstein: Source Crawl, Matching und Telegram-Zustellung.
- Provider-Login und Re-Authentifizierung.
- Auto-Bewerbung für die unterstützten Housing-Provider.
- Keine doppelten Zustellungen oder Bewerbungen.
- Keine verlorenen oder unzugeordneten Datensätze.
- Rollback und Runtime-Archive verifiziert.

## 13. Freigabegrenzen

Diese Scope-Datei ist keine Freigabe zur Löschung.

Vor jeder produktiven Löschung sind erforderlich:
- Datenexport/Backup und Zeilenzahlen
- Nachweis, dass keine aktiven Caller verbleiben
- Prüfung von SQL-Funktionen, Triggern, Cron, Queues und externen URLs
- neue Migration mit Rollback-Plan
- Staging- und Regressionstests
- explizite Produktionsfreigabe

**Aktueller Status: nur Dokumentation. Keine Produktionsdaten, Tabellen, Funktionen, Secrets, Worker oder Cloudflare-Ressourcen wurden verändert.**

## 14. Verwendete Quellen

- Supabase Production Project: dpmohkrwdlicexwcrqfy
- Live Edge Function Inventory: 115 Funktionen, abgeglichen mit PR #92
- Runtime-Reconciliation PR: https://github.com/arash-tawakoli/telegram_bot/pull/92
- Architekturübersicht: https://github.com/arash-tawakoli/telegram_bot/blob/main/docs/ARCHITECTURE.md
- Job-Search-Migration: https://github.com/arash-tawakoli/telegram_bot/blob/main/supabase/migrations/20261019224939_add_jobseeker_workspace.sql
- Indeed-OAuth-Migration: https://github.com/arash-tawakoli/telegram_bot/blob/main/supabase/migrations/20261025190000_add_indeed_oauth_connection.sql
- Coach Resume Drafts: https://github.com/arash-tawakoli/telegram_bot/blob/main/supabase/migrations/20261027222332_coach_resume_drafts.sql
- Coach API: https://github.com/arash-tawakoli/telegram_bot/blob/main/supabase/functions/coach-api/index.ts
- Auth Facade: https://github.com/arash-tawakoli/telegram_bot/blob/main/supabase/functions/auth-facade-broker/index.ts
