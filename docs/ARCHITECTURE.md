# Architektur und Betrieb
Stand: 30.09.2026. [Produktive Optimierung und Messwerte](SUPABASE_OPTIMIZATION_2026-09-11.md) · [Effizienz-Audit und Messwerte](SUPABASE_EFFICIENCY_2026-09-10.md) · [Vorherige Bereinigung](ARCHITECTURE_CLEANUP_2026-09-09.md) · [Einzelaudit aller Quellen](SOURCE_DELIVERY_AUDIT_2026-09-09.md)

## Datenfluss und Verantwortlichkeiten

Cron plant fällige Quellen in `source_jobs`/PGMQ ein. Ein zentraler `source-worker` reserviert Jobs und ruft spezialisierte Adapter auf. Zehn anbieterabhängige Transport-/Feed-Handler werden direkt im Worker aufgerufen; ihre HTTP-Endpunkte bleiben kompatible Wrapper. Auch der Noncoop-Feed ruft seinen Basis-Handler direkt auf. Kleinanzeigen verwendet denselben URL-geprüften Fetch-Helper wie sein authentifizierter HTTP-Endpunkt; interne Seitenabrufe benötigen keinen weiteren Secret-RPC. Quelle und Connector-Konfiguration werden pro Job gemeinsam geladen. `sources` und `source_connectors` in Supabase sind die produktive Konfiguration.

Ein gemeinsamer minutengenauer Scheduler plant Jobs und ruft den Worker nur bei sichtbaren Queue-Nachrichten auf. `ingest_listing_batch` verarbeitet höchstens 100 Angebote atomar pro RPC. Unveränderte normalisierte Quelldaten aktualisieren nur einen neueren `last_seen_at`-Wert; identische/ältere Beobachtungen schreiben keine neue Row-Version. Kein B-Tree indiziert diesen Zeitstempel; drei gezielte Teilindizes unterstützen aktive Quellen und Dubletten.  Neue/geänderte Daten durchlaufen weiterhin die vorhandenen Trigger. Ein separater Fingerprint beschreibt den Connector-Input, nicht nachträglich angereicherte Daten. Externe Änderungen an Quellfeldern invalidieren diesen Cache. Änderungen an Enrichment-Regeln müssen ebenfalls eine gezielte Cache-Invalidierung vorsehen.

SQL übernimmt Qualitätsprüfung, Dubletten, Profil-Matching und den zentralen Neuheitsnachweis. Neue Telegram-Zustellungen müssen zusätzlich `app_private.delivery_newness_qualified(...)` bestehen: `first_seen_at` darf höchstens 24 Stunden zurückliegen, die Quell-Baseline muss initialisiert sein und der Source-Worker muss den Fund als zustellfähigen Neu-Fund klassifiziert haben. Kleinanzeigen darf nur aus `lane=fast` mit einem von der Quelle belegten Alter von höchstens 24 Stunden zustellen; `coverage` ist reine Bestandsbeobachtung. ImmoScout darf nur aus `fresh_global`/`fresh_borough` zustellen; `coverage` ist ebenfalls ausgeschlossen. Bei anderen Quellen dient `fresh_delivery_eligible` nur als quellspezifischer Neuheitsnachweis zusammen mit Baseline und 24-Stunden-Fenster, nicht mehr als eigenständiges globales Gate. Der Dispatcher prüft vor Telegram erneut; liefert die Detailseite ein Veröffentlichungsdatum, werden nicht nachweislich höchstens 24 Stunden alte Angebote verworfen. `enrichment_delivery_eligible` bleibt reine Qualitäts-/Telemetrieinformation.

Telegram-Eingaben laufen über Gateway/Fast-Pfad zur UI beziehungsweise Premium-Verarbeitung. Inbox-Claims und Versuchsnummern schützen vor doppelter Verarbeitung. Stripe-Webhooks und Billing-Maintenance verwalten Abonnements getrennt von der Wohnungszustellung.

Das Telegram-Bewerberprofil besitzt einen kanonischen Button-Grid-Renderer in Gateway und Core. Unvollständige Profile werden als leere Draft-Zeilen angelegt; dadurch gibt es für bestehende und neue Nutzer keinen separaten Bulk-Setup-Pfad mehr. Globale Basisangaben sind Vorname, Nachname und E-Mail-Adresse; die Auto-Bewerbung bleibt bis zu deren Vollständigkeit gesperrt. Weitere Pflichtfelder werden weiterhin portalspezifisch geprüft.

Der Bewerbungsbereich arbeitet ausschließlich als Auto-Bewerbung: private Dokumente und Plattform-Sessions, eigene Claims und ein bedarfsgesteuerter `application-worker`. Neue Bewerbungen werden nur durch den qualifizierten `new_listing`-Delivery-Trigger für Nutzer mit aktivierter Auto-Bewerbung erzeugt. Ein manueller Listing-spezifischer Ein-Klick-/Schnellbewerbungs-Pfad existiert nicht; der Preview-Button „Auto-Bewerbung“ öffnet ausschließlich die Auto-Bewerbungsverwaltung. Seine Browser-Integration wurde bei diesem Audit nicht mit echten Bewerbungen getestet oder verändert.

## Zuverlässigkeitsgrenzen

- Source-Jobs und Delivery-Events haben atomare Claims und versuchsgebundene Bestätigungen. Ein alter Worker darf einen neueren Versuch nicht abschließen.
- Mehrdeutige Telegram-Ausgänge werden nicht automatisch erneut gesendet. Exactly-once kann über einen externen Telegram-Aufruf nicht garantiert werden.
- Ein persistierter Versandabstand begrenzt reguläre Listing-Zustellungen. Button-Bestätigungen verwenden ihren eigenen schnellen Pfad.
- Zustellungen werden nur für aktive, qualitätsgeprüfte Primär-Listings aus aktivierten Live-Quellen erzeugt. `new_listing` benötigt zusätzlich einen <=24h-Neuheitsnachweis. Coverage/Backfill und alte Reaktivierungen erzeugen keine neue Zustellung; ein vorhandenes Quell-Veröffentlichungsdatum wird im Dispatcher nochmals geprüft. `listing_changed` bleibt von der Neuheitsprüfung getrennt, unterliegt aber Aktivitäts-, Qualitäts-, Dedupe- und Live-Guards.
- Vorschauen enthalten höchstens ein Foto und alle verfügbaren Textdaten. Bilddaten werden unabhängig vom MIME-Header erkannt; bestätigte unbrauchbare Fotos erlauben Textfallback. Bezirk/Stadtteil nur aus expliziten Quellfeldern.
- GCP nutzt den tatsächlich betriebenen Primärconnector. Detailfehler erscheinen in den Crawl-Metadaten; scheitern alle Details, gilt der Lauf als Fehler. Vollständigkeit wird nicht vorgetäuscht.

## Aktueller Bestand

47 versionierte Function-Bundles einschließlich sechs stillgelegter Diagnose-/Kompatibilitäts-Endpunkte (Abgleich vom 30.09.2026). Insgesamt sind 111 Endpunkte bereitgestellt; zusätzliche Diagnose-/Test-Endpunkte sind nicht Teil des regulären Produktpfads. Details: [Audit vom 30.09.2026](ARCHITECTURE_AUDIT_2026-09-30.md). Die Telegram-UI enthält sämtliche Module direkt im Deployment; credential-behaftete Remote-Codeimporte werden von der Runtime-Prüfung abgewiesen. Aktuelle Codepfade sind unter `supabase/functions`, erhaltene Support-Endpunkte unter `supabase/deployed-support` abgelegt.

68 registrierte Quellen: beim Abgleich vom 30.09.2026 55 aktiviert/live, eine aktiviert/shadow, elf deaktiviert/shadow und eine deaktiviert/live. Historische Quellen bleiben für Zuordnung, Diagnose und spätere verifizierte Reparaturen erhalten. Registrierungspfade beweisen kein Wohnungsinventar.

Neun Cron-Einträge, davon sieben aktiv (die beiden Provider-Index-Aufgaben sind deaktiviert): gemeinsamer Source-Scheduler/Worker-Start, Dispatcher, stündliche gemeinsame Wartung, Ablauf von Admin-Premium-Ausnahmen, zwei Provider-Index-Aufgaben, Inbox-Recovery, stündliche Shadow-Probes und Bewerbungs-Worker. Der separate Source-Worker-Timer wurde entfernt. Dispatcher-Aufrufe erfordern fällige Events oder abgelaufene Leases; der Queue-Guard entfernt außerdem `new_listing`-Events, deren <=24h-Neuheit nicht mehr belegt ist, sowie Events für inzwischen inaktive/abgelehnte/nicht primäre Listings oder nicht mehr live geschaltete Quellen.

## Sicherheit und Datenpflege

Bot-/Listing-Tabellen sind für anon/authenticated nicht direkt freigegeben. Die geprüften öffentlichen SECURITY-DEFINER-Routinen sind für diese Rollen nicht ausführbar. `verify_jwt=false` bei Webhooks/internal Functions verlangt die vorhandene anwendungsseitige Authentifizierung; diese bleibt erhalten.

Service-only-Tabellen haben absichtlich RLS ohne Benutzer-Policies. Der Zugriff auf das private Schema bleibt dem Backend-Service vorbehalten; anon/authenticated haben dort keine USAGE-Berechtigung. Auch die private Provider-Index-Queue hat RLS. Kein Index wurde allein wegen `idx_scan=0` entfernt.

Die stündliche Wartung entfernt höchstens 5.000 abgelaufene Datensätze je Tabelle und Lauf: erfolgreiche Jobs/Crawls 7 Tage, fehlgeschlagene 30 Tage, Queue-Archiv 14 Tage, versandte/übersprungene Events 90 Tage, Shadow-Historie und abgeschlossene Telegram-Effekte 30 Tage, Cron-Erfolg 7 Tage und Cron-Fehler 30 Tage. Erfolgreiche Queue-Payloads werden nach versuchsgebundener Bestätigung gelöscht; die Job-Metadaten bleiben erhalten. Fehler-Payloads werden weiter archiviert. Fachliche Daten und Dokumente fallen nicht unter die neue Log-Bereinigung. Elf unerreichbare Routinen mit bereits gelöschten Tabellen wurden ohne CASCADE entfernt.

## Entwicklung, Deployment und Wiederherstellung

```sh
npm ci --ignore-scripts
npm test
node scripts/check-runtime.mjs
```

Node 24, gepinnte Abhängigkeiten und Lockfile. Ein CI-Workflow führt Tests und Architekturprüfungen aus. Das Runtime-Manifest erfasst pro Bundle sämtliche Dateien einschließlich gemeinsam importierter Module sowie deren beobachtete Deployment-Hashes.

Die Prüfung lehnt fehlende relative Abhängigkeiten, doppelte Bundle-Namen, abweichenden Dateicode und Abweichungen vom **zuletzt aufgezeichneten** Deployment ab. Sie fragt Supabase nicht online ab. Nach jedem Deployment muss das Bundle aus Supabase zurückgelesen, verglichen und das Manifest aktualisiert werden; bloßes Ändern eines Hashes ist kein Deployment-Nachweis.

`seed.sql` ist ausschließlich für ein leeres Register. Es lehnt vorhandene Quellen/Connectoren vor Schreibzugriffen ab. Bootstrap-URLs starten deaktiviert/shadow und müssen gegen ihre tatsächlichen Schnittstellen getestet werden, bevor ein neuer Standort live gehen kann. Historische Reparatur-SQLs unter `scripts` sind keine Replay-Reihenfolge; nie pauschal auf Produktion anwenden.

Die versionierten Migrationen bleiben als abgeglichene Historie erhalten. Historische Reviews und Quellenberichte sind zeitbezogene Belege, keine aktive Konfiguration. Den spezifischen Rücknahmeweg der Effizienzänderungen beschreibt der aktuelle Auditbericht; ein pauschales Deployment des alten Commits würde neuere Bewerbungsfunktionen überschreiben.

## Bekannte offene Grenzen

Vollständige externe Coverage und permanente Erreichbarkeit aller Anbieter sind nicht belegt. Unter anderem bleiben Vonovia-/WG-Gesucht-Verifikation, SAGA-Indexstabilität, Wunderflats-Zugriff und City-Wohnen-Preiszuordnung im Quellenbericht offen. Diese Probleme werden nicht durch die vereinfachte Delivery-Policy überdeckt; Quellenverfügbarkeit, Qualitätsfilter, Deduplizierung und Suchprofil-Matching bleiben verbindlich.

Kein vollständiger Lasttest, keine gemessene Verbesserung der Telegram-Latenz und kein Restore-Test des gesamten Supabase-Projekts in dieser Bereinigung. Der Nachweis umfasst Codegleichheit, Verhaltenstests, Zugriffsprüfungen und begrenzte Liveproben.
