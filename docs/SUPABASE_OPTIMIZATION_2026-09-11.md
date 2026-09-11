# Supabase-Optimierung – 11. September 2026

Projekt `telegram_bot` (`dpmohkrwdlicexwcrqfy`), Repository `arash-tawakoli/telegram_bot`. Die Änderungen sind produktiv ausgerollt. Dieser Durchlauf baut auf dem Audit vom 10. September auf; dessen bereits umgesetzte Verbesserungen werden hier nicht erneut als neue Arbeit gezählt.

## Ergebnis

| Bereich | Umgesetzt | Nachweis |
| --- | --- | --- |
| Listing-Schreiblast | Fünf B-Tree-Indizes mit dem ständig veränderten `last_seen_at` durch drei gezielte Teilindizes ersetzt; Fillfactor 85 ermöglicht HOT-Updates. Zeitstempel werden nicht gerundet oder seltener geschrieben. | Indexbedarf 71.96 → 7.94 MiB, −89.0 %. Neue Indizes werden im Live-Betrieb benutzt. |
| Wiederholte Beobachtungen | Identische oder ältere Beobachtungen erzeugen keine neue Row-Version. `touched` behält seinen bisherigen Rückgabewert für unveränderte Eingabezeilen. | Physische Row-Version, monotone Zeitstempel, Fingerprint und Berechtigungen getestet. |
| Änderungserkennung | Produktänderungs-Trigger läuft nur, wenn sich relevante Werte tatsächlich ändern. Die Bedingung sieht auch Änderungen durch vorherige Trigger. | Direkte und abgeleitete Preisänderungen erzeugen weiterhin Ereignisse. |
| Deduplizierung | Aktive Quellen sowie URL- und Adressabgleich gezielt indiziert. Matching-Regeln bleiben erhalten. | Bestehende Unique-/FK-Indizes erhalten; neue Indizes live verwendet. |
| Edge-Aufrufe | Zehn Provider-Handler laufen direkt im Source-Worker. Auch `noncoop-new-feed` ruft seinen Basis-Handler direkt auf. Die HTTP-Endpunkte bleiben als kompatible Wrapper erhalten. | Elf aktive Quellen nutzen diese Adapter einschließlich Kleinanzeigen; Routing, Fremd-Domains, Parameter und Abbrüche getestet. Keine pauschale tägliche Kosteneinsparung behauptet. |
| Kleinanzeigen | Auch der authentifizierte Transport wird im Worker direkt verwendet; URL-Prüfung, 12-Sekunden-Zeitlimit, Pausen und Retries bleiben erhalten. Der kompatible HTTP-Endpunkt prüft weiterhin sein Secret. | Bei sieben Bezirksseiten plus einer Bestandsseite entfallen acht Edge-Aufrufe und neun Secret-RPCs pro Durchlauf; tatsächliche Einsparung hängt von Seiten und Retries ab. |
| Datenbank-Roundtrips | Quelle und Connector-Konfiguration werden pro Job gemeinsam geladen. | Eine Abfrage statt zwei; deaktivierte Connectoren und Prioritäten unverändert berücksichtigt. |
| Queue-Wachstum | Erfolgreiche PGMQ-Nachrichten werden gelöscht statt zusätzlich archiviert. Die Payload enthält nur bereits gespeicherte Job-/Quellen-/Worker-Identität. Fehlgeschlagene Nachrichten bleiben im Archiv. | Echter PGMQ-Test mit Rücknahme: veralteter Versuch abgewiesen, erfolgreicher Abschluss idempotent, Fehler archiviert. |
| Wartung | Zwei tägliche Timer durch eine stündliche Wartung ersetzt. Maximal 5.000 abgelaufene Datensätze je Tabelle und Lauf; drei kleine BRIN-Indizes unterstützen die Aufbewahrung. | Gleiche Aufbewahrungsfristen, Begrenzung und Schutz laufender Arbeit getestet. Produktiver Aufruf erfolgreich. |
| Bereinigung | Elf unerreichbare SQL-Routinen entfernt, deren Tabellen bereits gelöscht waren. Der ungenutzte Wunderflats-Probe-Endpunkt führt keine externen Anfragen mehr aus. | Keine aktuellen Aufrufer oder Datenbank-Abhängigkeiten; kein `CASCADE`. Diagnose-Endpunkt liefert 410. |
| Reproduzierbare Deployments | Temporären privaten GitHub-Codeimport der Telegram-UI durch vollständig enthaltene Module ersetzt. Veraltete Deployment-Metadaten und sieben fehlende Migrationseinträge abgeglichen. | UI-Bundles vor Umstellung nach Minifizierung identisch. Alle 28 Bundles bytegenau gegen Supabase und 163 Migrationen gegen das Register geprüft. Neuer Test blockiert Zugangsdaten in Codeimport-URLs. |
| Suchqualität | Meravis-Variable umbenannt, die den URL-Konstruktor verdeckte und absolute Angebots-/Bildlinks verwarf. | Regressionstest prüft beide Links und den Mietpreis. |

## Messung

Der kontrollierte SQL-Test aktualisiert ausschließlich `last_seen_at` von 99 bestehenden Spacest-Inseraten um eine Mikrosekunde. Jede Transaktion wurde zurückgerollt. Es entstanden keine echten neuen Inserate oder Testnachrichten. Rücknahmen erzeugen selbst WAL.

| Median aus drei Proben | Vorher | Späterer stabiler Zustand |
| --- | ---: | ---: |
| WAL-Bytes | 371,037 | 157,905 |
| WAL-Records | 1,504 | 326 |
| Buffer-Hits | 4,441 | 1,069 |
| SQL-Laufzeit | 15.556 ms | 12.474 ms |

Die WAL-Bytes liegen in diesen Proben um 57.4 % niedriger, die WAL-Records um 78.3 %. Checkpoints, Full-Page-Images, Heap-Belegung und Cache-Zustand unterscheiden sich. Zwischen den Messphasen liefen regulärer Betrieb und ein normales `VACUUM (ANALYZE)`; kein `VACUUM FULL`. Das belegt keine gleich große Senkung der gesamten Projektkosten oder der täglichen WAL-Menge.

Im separaten Zählerfenster vom ersten Audit-Snapshot am 10. September bis 11. September 03:27 UTC waren 94,786 von 104,111 Listing-Updates HOT-Updates (91.0 %). Das Fenster enthält auch Verkehr vor dem Cutover und die zurückgerollten Proben. Die Rohmesswerte stehen in `optimization-metrics-2026-09-11.json`.

## Verifikation und Betriebsgrenzen

- 153 lokale Tests bestanden, einschließlich 17 neuer Regressionstests. 28 Deployment-Bundles und 163 Migrationen bestanden die strenge Hash-/Strukturprüfung.
- Source-Worker-Dry-Run: HTTP 200, `ok=true`. Der finale Kleinanzeigen-HTTP-Endpunkt lehnt einen fremden Zielhost nach erfolgreicher Authentifizierung mit HTTP 400 ab. Authentifizierte leere Telegram-Anfrage: HTTP 200, `ignored=true`; kein Nutzer wurde angeschrieben.
- Nach dem finalen Kleinanzeigen-Deployment verarbeitete ein regulärer Lauf am 11. September 08:22 UTC 158 Angebote und erkannte zwei neue Inserate; kein Fehler.
- Nach dem Haupt-Rollout wurde ein vollständiger regulärer Durchlauf aller 51 Live-Quellen beobachtet: 49 erfolgreich. SAGA meldet keinen verifizierbaren öffentlichen Bestand; Nestpick meldet wechselnden Bestand während der Pagination. Beide Fehler traten schon vor dem Rollout auf. Die Frische-/Vollständigkeitsprüfungen wurden nicht gelockert.
- Die seit dem Cutover ausgeführten Cron-Aufträge hatten keine SQL-Fehler. Die stündliche Wartung und die Shadow-Probes wurden anschließend jeweils fünfmal regulär erfolgreich ausgeführt. Keine Source-Jobs waren länger als zehn Minuten überfällig.
- Ein bereits bestehender Delivery-Fehler betrifft einen Nutzer, der den Bot blockiert hat. Fünf Versuche waren ausgeschöpft; kein erneuter Versand wurde erzwungen. Unklare Telegram-Ergebnisse werden weiterhin nicht blind wiederholt.
- Supabase-Advisors: keine WARN-/ERROR-Befunde. 30 Hinweise betreffen absichtlich service-exklusive RLS-Tabellen ohne Benutzer-Policies; sechs ungenutzte FK-Stützindizes bleiben erhalten. Alle 42 privaten Routinen sperren Client-Rollen und erlauben den Servicezugriff.
- Realtime hat keine veröffentlichten Tabellen, es existieren keine Replikationsslots mit zurückgehaltenem WAL. Storage enthält einen öffentlichen Bot-Asset-Bucket mit einem Objekt. Es wurden keine Nutzer- oder Rechnungsdaten gelöscht und keine bezahlten Transaktionen, echten Bewerbungen oder künstlichen Telegram-Zustellungen ausgelöst.
- Die bisherigen fünfminütigen Live-Abfragen, Frischefreigaben, Miet-/Flächenfilter, Quellenprioritäten, Stripe-Entitlements und Signaturprüfungen bleiben erhalten. Der bereits in GitHub vorhandene Wunderflats-Header-/Parallelitätsstand wurde im aktuellen Source-Worker mit ausgerollt.

Kein Lasttest mit großen Nutzerzahlen, keine vollständige Wiederherstellungsprobe und keine neue Stripe-Zahlung wurden durchgeführt. Anbieter können weiterhin vorübergehend blockieren oder unvollständige Bestände liefern. Ein erfolgreicher Crawl beweist keine vollständige externe Marktabdeckung.

## Aufbewahrung und Rücknahme

Erfolgreiche Source-Jobs/Crawls: 7 Tage; fehlgeschlagene: 30 Tage. Fehler-/Altarchiv der Queue: 14 Tage. Gesendete/übersprungene Delivery-Events: 90 Tage. Shadow-Historie und abgeschlossene Telegram-Effekte: 30 Tage. Cron-Erfolg: 7 Tage; Cron-Fehler: 30 Tage. Laufende oder noch relevante Arbeit fällt nicht unter die Löschbedingungen. Bereits belegte historische Heap-Dateien können weiterhin Platz belegen, bis PostgreSQL ihn wiederverwendet.

Der erste begrenzte Wartungsaufruf entfernte 5.000 alte Source-Jobs, 5.000 alte Crawls, 1.423 alte Queue-Archiveinträge und 4.144 alte Cron-Protokolle. Keine Listing-, Nutzer-, Abonnement- oder Rechnungszeilen wurden dabei gelöscht.

Neue produktive Migrationen:

1. `20260910202123_listing_hot_updates_and_bounded_maintenance.sql`
2. `20260911031814_bounded_operational_retention.sql`
3. `20260911032650_retire_orphaned_inventory_routines.sql`

`scripts/rollback-efficiency-2026-09-11.sql` stellt bei Bedarf die bisherigen Index-/Ingestion-/Queue-/Wartungsregeln wieder her. Es stellt gelöschte abgelaufene Protokolle nicht wieder her. Die entfernten kaputten Altroutinen und temporären Remote-Codeimporte sollen nicht erneut aktiviert werden. Runtime-Rücknahmen müssen vollständige zusammengehörige Bundles verwenden; nie einzelne gemeinsame Module aus älteren Versionen mischen.

Referenzen: [Supabase PGMQ](https://supabase.com/docs/guides/queues/pgmq), [PostgreSQL HOT](https://www.postgresql.org/docs/17/storage-hot.html), [RLS-Hinweise](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [Index-Hinweise](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
