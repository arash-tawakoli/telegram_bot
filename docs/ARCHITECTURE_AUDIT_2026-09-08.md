# Architektur-, Betriebs- und Qualitätsprüfung – 8. September 2026

## Umfang und Ausgangspunkt

Projekt: Telegram-Wohnungsbot, Repository `arash-tawakoli/telegram_bot`, Supabase `dpmohkrwdlicexwcrqfy`. Ausgangscommit `f438175702e9ef94603a4a1c63cd0ecb8a614503`. Geprüft wurden Repository-Struktur und Abhängigkeiten, die 23 tatsächlich bereitgestellten Edge Functions, Quellen-/Connector-Konfiguration, Source-Jobs, zehn Cron-Jobs, Zustellungen, SQL-Berechtigungen/RLS, Tabellenstatistiken, kumulative Abfragestatistiken, CI und Migrationsexporte. Keine AGENTS.md im aktuellen GitHub-Baum gefunden; kleine Änderungen und bestehende Geschäftsregeln wurden beibehalten.

Der Kernfluss bleibt Scheduler → Source-Jobs → Worker/Adapter → Listings → SQL-Qualitätsprüfung/Deduplizierung/Matching → Delivery-Ereignisse → Telegram-Dispatcher. Telegram-Gateway/Fast/UI und Stripe-Webhooks bilden separate Eingänge. Die Landingpage gehört nicht zu diesem Repository und wurde nicht geprüft.

Aktuelle Vorgaben bleiben erhalten: ein Bild pro Listing, vorhandene Quellfakten, direkte Tenant-Angebotslinks bzw. verifizierte Registrierungsziele, Premium-Regeln, globale Versandabstände sowie Schutz gegen doppelte Zustellung bei unklarem Ausgang.

## Beobachtungen und Prioritäten

| Befund | Beleg | Nutzen / Aufwand / Risiko | Entscheidung |
|---|---|---|---|
| Telegram-Bilddownloadfehler erreichen den bestehenden Binary-Upload-Fallback nicht | Sechs fehlgeschlagene Zustellungen mit `failed to get HTTP URL content`, drei mit `WEBPAGE_CURL_FAILED`, jeweils fünf Versuche; bisherige Fehlererkennung erfasst diese Texte nicht | Hoch / klein / niedrig | Fehlerklassifikation korrigiert, gezielt getestet und live |
| Leere Dispatcher-Durchläufe laden unnötig Bot-Token und alle Abonnements | Instrumentierter vollständiger Handler: beide Lesezugriffe auch ohne Ereignisse | Mittel / klein / niedrig | Erst nach erfolgreichem Ereignisabruf und nur bei vorhandenen Ereignissen laden |
| Unerreichbarer alter Stripe-Gutschriftenpfad | `qualifyReferral` wird nirgends aufgerufen; dessen alleinige Helfer `processReferralReward`, `stripePost`, `optionalSecret` und API-Versionskonstante sind ebenfalls unerreichbar. Keine Exporte, dynamischen Aufrufe oder Referenzen aus anderen Runtime-Modulen | Mittel / klein / niedrig | 108 Zeilen entfernt; bestehende aktive Empfehlungs-/Premium-Abläufe erhalten |
| Ungenutzte Dispatcher-Hilfsfunktion | `absolute` kommt nur als nicht exportierte Definition vor | Klein / klein / niedrig | Entfernt |
| CI-Integritätsprüfung scheitert bereits vor der Änderung | 83 Tests bestanden, `check-runtime.mjs` meldet Dispatcher-Drift; zwei Migrationen fehlen im Register und tragen abweichende Versionsnummern | Hoch / klein / niedrig | Register aktualisiert, SQL-Dateinamen an produktive Migrationen angepasst, Live- und Repository-Hashes getrennt sichtbar gemacht |
| KAIFU dauerhaft HTTP 404 | 253 tote Jobs im 24h-Fenster; 517 aufeinanderfolgende Fehler am Prüfzeitpunkt. Aktueller API-Aufruf erneut 404; neue offizielle Mietangebotsseite HTTP 200 | Hoch / neuer Adapter erforderlich / mittel | Offen; keine ungeprüfte Ersatz-URL eingetragen |
| SAGA intermittierende Quellenfehler | 100 Jobs ohne verifizierte Hamburger Mietwohnungen, 28 HTTP-401-Fehler im 24h-Fenster; zwischenzeitlich erfolgreiche Abrufe | Mittel / weitere Upstream-Diagnose / mittel | Offen; Schutz vor falscher Vollständigkeit bzw. Leerbestand bleibt bestehen |
| Weitere Unterschiede zwischen GitHub und Produktion | 19 Dateihashes unterscheiden sich nach diesem Rollout; darunter reine Formatierung sowie noch nicht abschließend semantisch abgeglichene Adapter | Mittel / gesonderter Funktionsvergleich / mittel | Explizit dokumentiert; keine pauschale Überschreibung einer Seite |

## Änderungen und Validierung

- `notification-dispatcher` Version 60: bekannte HTTP-400-Downloadfehler erlauben den vorhandenen Datei-Upload; unklare Transportausgänge erlauben weiterhin keine automatische Wiederholung. Ein leeres Ereignisergebnis beendet den Lauf nach Lease-Recovery und gibt die Sperre im `finally` frei. Token- und Abonnementabfragen entfallen dabei.
- `stripe-webhook` Version 30: ausschließlich unerreichbare interne Funktionen und deren Konstante entfernt. Signaturprüfung, Event-Claims und aktive Zahlungslogik bleiben bestehen.
- Deployment basiert auf den zuvor aus Supabase gelesenen Dateien; andere produktive Änderungen wurden nicht durch die GitHub-Variante ersetzt. Die betroffenen Repository-Stellen wurden entsprechend korrigiert.
- Vorher 83 bestehende Tests erfolgreich; nachher 85 Tests erfolgreich. Der neue Idle-Test war vor der Korrektur rot (zwei unnötige Zugriffe) und danach grün (null). Beide vollständigen Handler-Tests wurden zusätzlich gegen die tatsächlich zum Deployment verwendete Dispatcher-Datei ausgeführt.
- Stripe-Datei syntaktisch mit Node geprüft. Kein echter Kauf, keine Gutschrift und keine Testnachricht ausgelöst.
- Produktive HTTP-Prüfung: authentifizierter Dispatcher-Dry-Run 200 (`ok:true`), Dispatcher ohne internen Schlüssel 401, Stripe ohne gültige Signatur 400 (`bad signature`). Supabase-HTTP-Request-IDs: 165193–165195.
- Repository-Integritätsprüfung erfolgreich: 23 Function-Manifeste und 151 Migrationsexporte. Die bestehende SHA-Prüfung der Dateien bleibt aktiv.

## Messbarer Effekt

Ein leerer Dispatcher-Durchlauf führt zwei Datenbankzugriffe weniger aus: Token-RPC und Abonnementabfrage. Dies wurde unter denselben Mock-Bedingungen im vollständigen Handler vor/nach der Änderung gezählt. Bei einem Aufruf pro Minute wären bei ausschließlich leeren Läufen bis zu 2.880 Zugriffe pro Tag vermeidbar; das ist eine Hochrechnung, keine gemessene Tagesersparnis. Keine belastbare Aussage über Millisekunden, Kosten oder Gesamtdurchsatz.

108 entfernte Stripe-Codezeilen bzw. 3.654 Bytes wurden direkt verglichen. Das ist eine Größenreduktion, kein nachgewiesener Laufzeitgewinn.

## Betriebs- und Sicherheitsbewertung

Momentaufnahme des rollierenden 24h-Fensters am Prüfstart: 65 Quellen insgesamt, 52 aktiviert/live; 559 gesendete, neun fehlgeschlagene und zwölf übersprungene Zustellungen. 12.758 erledigte und 398 tote Source-Jobs. Keine ausstehenden oder abgelaufenen processing-Jobs bei der ergänzenden Abfrage. Alle zehn Cron-Jobs meldeten ausschließlich erfolgreiche SQL-Ausführungen; das beweist nicht den Erfolg der von ihnen gestarteten HTTP-Arbeit.

Supabase-Security-Advisors: 26 INFO-Hinweise auf RLS ohne Policies, keine WARN/ERROR-Meldungen. Bei den ausschließlich über Service Role verwendeten Bot-Tabellen ist die Sperre für normale Clients beabsichtigt. Zusätzliche Berechtigungsabfrage ergab drei ausführbare SECURITY-DEFINER-Triggerfunktionen im privaten Schema, keine entsprechend ausführbaren öffentlichen SECURITY-DEFINER-RPCs. Keine Berechtigungen erweitert.

Performance-Advisors: vier INFO-Hinweise zu bislang ungenutzten Indizes. Nicht entfernt: Statistik allein beweist keine Entbehrlichkeit für seltene Abfragen oder Fremdschlüsseloperationen. Siehe [Unused-index-Prüfung](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) und [RLS-ohne-Policy-Prüfung](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Größte beobachtete Tabellen: Listings 84 MB, Crawl-Historie 74 MB, Source-Jobs 30 MB. Keine produktiven Daten gelöscht. Kumulative `pg_stat_statements` enthält auch historische, inzwischen stillgelegte Abläufe; diese Werte wurden nicht als aktueller Engpass ausgegeben. Kein Index- oder Schemaumbau ohne belastbaren aktuellen Ausführungsplan.

## Manifest und Migrationen

`runtime-manifest.json` erfasst nun ausdrücklich Repository-Dateihashes (`sha256`) und separat die am Prüftag beobachteten produktiven Dateihashes (`deployed_sha256`). Versionen beziehen sich auf beobachtete Deployments. Ein erfolgreicher CI-Lauf bestätigt Repository-Integrität, keine vollständige Übereinstimmung mit Produktion. Abweichungen werden sichtbar ausgegeben; sie werden nicht als behoben bezeichnet.

Noch abweichend sind drei Dispatcher-Dateien (`index.ts`, `source-facts.ts`, `delivery-lease.ts`) und 16 Source-Worker-Dateien einschließlich `deno.json`. Ein Hashunterschied kann schon durch Formatierung entstehen. Für die größeren Adapterunterschiede, insbesondere GCP und Generic, ist vor einer Vereinheitlichung ein gesonderter semantischer Vergleich nötig. Deshalb wurde keine Komplettbereitstellung des Repository-Workers vorgenommen.

Die beiden Warmmietenmigrationen wurden anhand der tatsächlich gespeicherten SQL-Statements geprüft und von `20260908110000` nach `20260908110928` sowie von `20260908111200` nach `20260908111004` umbenannt. SQL-Inhalt und produktive Historie bleiben unverändert. Keine neue Datenbankmigration ausgeführt.

## Offene Punkte und Prüfgrenzen

- KAIFU benötigt eine belegte, maschinell lesbare neue Angebotsquelle und einen passenden Adapter-Smoke-Test. HTTP 200 der Website reicht dafür nicht.
- SAGA benötigt weitere gezielte Prüfung der Provider-Index-Antworten und 401-Ursachen. Keine Umdeutung ungeklärter Antworten in leere, vollständige Bestände.
- Neun ausgeschöpfte Zustellungen wurden nicht zurückgesetzt oder erneut versendet. Der Fix verbessert neue/noch zulässige Versuche; ein nachträglicher Versand benötigt einen gesonderten Versandauftrag.
- Die 19 verbleibenden Repository/Deployment-Hashabweichungen sind dokumentiert, aber nicht vollständig semantisch aufgelöst.
- Keine flächendeckenden neuen Smoke-Tests aller 65 externen Anbieter, kein Lasttest, kein vollständiger Penetrationstest, keine externen Stripe-Zahlungstests und kein visueller Test sämtlicher Telegram-Sprachen/Bedienpfade. Die vorhandenen Adapter-/Datenbank-/Zustelltests wurden vollständig ausgeführt.
- Die stillgelegten Mini-App-Endpunkte mit HTTP 410 bleiben als Kompatibilitätsantwort für externe Aufrufer bestehen. Fehlende interne Referenzen allein reichen nicht für ihre Löschung.
