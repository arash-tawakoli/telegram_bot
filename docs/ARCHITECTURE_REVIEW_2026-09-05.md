# Architektur-Review: Telegram-Wohnungsbot

Historischer Vor-Rollout-Befund. Aktueller Umsetzungsstand, einschließlich Versandstörung und v30-Korrektur: [Rollout](ROLLOUT_2026-09-05.md). Die nachfolgenden offenen Punkte beschreiben den ursprünglichen Review-Zeitpunkt. Die separat geprüften externen Quellen und verbleibenden Zugangsvoraussetzungen stehen in der [65-Quellen-Liste](SOURCE_AUDIT_2026-09-05.md).

Stand: 5. September 2026, UTC. Repository-Basis: `36708e9e2f073d7b3835cfd28b8222446e23c0ff`. Supabase-Projekt: `dpmohkrwdlicexwcrqfy`.

## Ergebnis

Die zentrale Pipeline aus Quellen-Queue, Source-Worker, Inseraten, SQL-Matching und separater Zustellung ist sinnvoll. Ein weiterer kompletter Architekturwechsel würde derzeit mehr Betriebsrisiko als Nutzen bringen. Vorrang haben Zugriffsschutz, verlässliche Zustandsübergänge und die Übereinstimmung von GitHub und Produktion.

Der Review umfasst die Kernpfade für Crawling, Zustellung, Telegram-Eingang und Prämien sowie live abgefragte Funktionen, Berechtigungen, Cron-Jobs, Tabellenübersichten und Migrationsmetadaten. Er ist kein vollständiger Test aller 65 externen Connectoren und kein Lasttest. Produktive Nachrichten wurden nicht ausgelöst.

## Befunde und Umsetzung

| Priorität | Befund | Auswirkung | Behandlung in diesem PR |
|---|---|---|---|
| P1 | `complete_referral_reward(uuid)` ist als SECURITY DEFINER für `anon` und `authenticated` ausführbar. Die Funktion prüft kein Suchprofil. | Mit Kenntnis einer passenden Benutzer-ID können registrierte Empfehlungen vorzeitig belohnt werden. Kein Missbrauch nachgewiesen. | EXECUTE nur für Service Role; Profilvoraussetzung in SQL; Tests für Berechtigungen und einmalige Vergabe. |
| P1 | Produktiver Dispatcher v27 liest pending/failed und sendet ohne atomare Reservierung. | Überlappende Aufrufe können dasselbe Ereignis senden. Kein tatsächlicher Doppelversand nachgewiesen. | Live-Implementierung in GitHub übernommen; Compare-and-set-Reservierung, Versuchsnummer und Zeitstempel als Besitznachweis. |
| P1 | `claim_source_jobs` akzeptiert ausschließlich enqueued/retry. Abgestürzte processing-Jobs werden nicht zurückgewonnen. | Ein solcher Job kann seine Quelle dauerhaft von der nächsten Einplanung ausschließen. Beim Snapshot gab es keinen festhängenden aktiven Job. | Abgelaufene Jobs nach zehn Minuten erneut reservieren; alte Versuche dürfen neue nicht abschließen; nach fünf abgebrochenen Versuchen Job archivieren, damit die Quelle erneut eingeplant werden kann. |
| P1 | Worker ignoriert Fehler der Abschluss-RPC; gemeinsame Funktionen ignorieren mehrere DB-Lese-/Schreibfehler. | Fehlgeschlagene Persistierung kann als erfolgreiche Verarbeitung erscheinen. | Geprüfte Ergebnisse; Abschluss genau einmal; HTTP-Fehler bei fehlgeschlagener Bestätigung. |
| P1 | GitHub und Produktion weichen bei Dispatcher und Migrationen ab. | Ein normaler Deploy könnte Live-Verhalten durch älteren Code ersetzen oder Migrationen falsch wiederholen. | Dispatcher auf Live-Basis abgeglichen; Abweichungen dokumentiert; Rollout bleibt von der Klärung der Historie abhängig. |
| P2 | Telegram-UI schreibt `bot_events` vor der Verarbeitung; Wiederholungen gelten anschließend als Duplikat. | Ein Fehler nach dem Insert kann ein Update dauerhaft verlieren. | Offener Folgepunkt: verarbeitbare Inbox mit Status und Wiederaufnahme, inklusive idempotenter Nebenwirkungen. |
| P2 | Polling, Backoff und Versandabstand entsprechen nicht den früher genannten 5 Minuten / 15 Sekunden / ohne Source-Backoff. | Die dokumentierte Betriebsanforderung und die aktuelle Konfiguration unterscheiden sich. | Abweichung explizit festgehalten; dieser Sicherheits-/Zuverlässigkeits-PR stellt die produktive Scheduling-Policy nicht um. |
| P2 | Erfolgreicher Telegram-Versand und DB-Bestätigung sind keine gemeinsame Transaktion. | Bei verlorener Antwort oder Absturz bleibt das Versandresultat unklar; Wiederholung kann duplizieren. | Bestätigung außerhalb des Sendefehlerpfads; abgelaufene Reservierungen kennzeichnen Unsicherheit. Keine Exactly-once-Garantie behauptet. |
| P2 | CI-Prüfung nach Legacy-Namen durchsucht ihre eigene Regex. | Der Architekturcheck kann sich selbst als Verstoß erkennen. | Eigene Workflowdatei aus dieser Textprüfung ausgeschlossen; Verhaltenstests hinzugefügt. |

## Beobachteter Betrieb

- 65 Quellen, davon 54 live und 11 shadow; 185 Connectoren insgesamt. Keine Quelle überschreitet drei aktivierte Connectoren.
- 23 Public-Tabellen mit aktiviertem RLS; 21 deployte Edge Functions einschließlich Hilfs- und verbliebener Mini-App-Funktionen. Deployment-Präsenz allein belegt keine Nutzung.
- Sieben aktive Cron-Jobs: Source-Scheduler, Source-Worker, Dispatcher, tägliche Maintenance, Ablauf administrativer Premium-Rechte und zwei Provider-Index-Jobs.
- Source-Polling live: 2 Quellen jede Minute, 2 alle zwei Minuten, 18 alle fünf Minuten, 24 alle zehn Minuten, 8 alle 30 Minuten. Der Scheduler erhöht bei Fehlern zusätzlich auf mindestens 10/30/60 Minuten. Die Jobwiederholung verwendet 60/300/900 Sekunden.
- Der untersuchte Live-Dispatcher enthält keinen 15-Sekunden-Abstand. Die Reservierung dieses PR verhindert konkurrierende Verarbeitung desselben Ereignisses; sie ist kein globaler Versandtaktgeber.
- Im abgefragten 24-Stunden-Fenster: 12.512 erfolgreiche und 90 fehlgeschlagene Crawl-Läufe; 11.193 abgeschlossene und 8 tote Source-Jobs; 471 als gesendet gespeicherte Delivery-Ereignisse. Diese Zähler messen unterschiedliche Einheiten und beweisen weder vollständige Quellenabdeckung noch Telegram-Zustellung beim Empfänger.
- Security Advisor: zwei WARN-Befunde für dieselbe Prämienfunktion. RLS-ohne-Policy-Hinweise sind beim serverseitigen Service-Role-Modell allein kein Grund, öffentliche Policies zu öffnen. Performance Advisor enthielt keine WARN/ERROR-Befunde; ungenutzte Indizes wurden nicht allein deshalb entfernt.

## Drift und Rollout

Vor diesem PR: 125 Migrationsdateien in GitHub, 139 Einträge im produktiven Register. Für 62 Repository-Versionen existiert kein identischer Versionsschlüssel im Live-Register. Einige Änderungen haben offenbar andere Zeitstempel; die Zahl allein belegt keine 62 fehlenden Schemaänderungen.

1. Die 62 Versionen nach Namen und tatsächlichem SQL abgleichen. Keine historischen Migrationen blind neu ausführen oder pauschal als angewendet markieren.
2. Die neue Migration in einer isolierten Supabase-Testumgebung mit echter PGMQ-Erweiterung anwenden und Integrationsverhalten prüfen. Die lokalen SQL-Tests verwenden PGlite mit einem ausdrücklich vereinfachten PGMQ-Testmodell.
3. Die additive Migration zuerst ausrollen. Danach `source-worker` mit `job-runner.ts` und `checked.ts` deployen. Der neue Worker benötigt `finish_source_job_attempt`.
4. Alten Dispatcher vollständig auslaufen lassen, bevor die Version mit Reservierungen startet: Der alte Code respektiert processing-Besitz nicht. Bei der Umstellung eingehende Cron-Aufrufe kontrollieren; keine echten Testnachrichten an Nutzer senden.
5. Security Advisor, Jobalter, Dead Jobs, Queue-Größe und DB-Fehler kontrollieren. Cron-Erfolg alleine beweist keinen erfolgreichen Edge-Aufruf.
6. Rollback: Die additive SQL-Funktion kann bestehen bleiben; Prämienrechte geschlossen lassen. Worker nur koordiniert zurückrollen. Beim Dispatcher ebenfalls laufende Aufrufe auslaufen lassen.

Dieser PR deployt nichts und verändert keine Live-Daten. Vor einer späteren Freigabe muss die Entwicklung seit dem genannten Basis-Commit erneut abgeglichen werden.

## Tests und Grenzen

`npm ci --ignore-scripts && npm test` auf Node 24: 16 Tests, alle erfolgreich. Abgedeckt sind SQL-Qualifikation und ACL, wiederholte Bestätigung, abgelaufene Source-Versuche, Crash-Limit, parallele Delivery-Claims, veraltete Delivery-Bestätigungen und sichtbare DB-Fehler.

Die Tests prüfen PostgreSQL-Funktionen mit synthetischen Tabellen und einem PGMQ-Interface-Testmodell sowie TypeScript-Module mit DB-Testdoubles. Ein deployter Deno-End-to-End-Test, echte PGMQ-Parallelität und externe Connector-Last wurden nicht geprüft. Die 50-Sekunden-Grenze verhindert das Starten weiterer Arbeit; ein bereits gestarteter Adapter bzw. Versand kann länger laufen.

## Nächste Architekturentscheidungen

- Verbindliche Scheduling-Policy wiederherstellen: 5-Minuten-Suche ohne automatische Source-Sperren; 15-Sekunden-Versand über einen persistenten, instanzübergreifenden Taktgeber. Nicht über unkoordinierte Sleeps je Function lösen. Die erhöhte Quellenlast vorher gegen Laufzeiten und Queue-Kapazität prüfen.
- K3-Shadow-Prüfungen mit eigener nachweisbarer Auswertung und klaren Kriterien für K1/K2 verbinden. Aus der vorhandenen Cron-Liste lässt sich kein separater K3-Bericht belegen; externe Automationen wurden nicht geprüft.
- Telegram-UI von rund 160 KB Quelltext in Profil-, Prämien-, Verwaltungs- und Darstellungsbereiche zerlegen, nachdem Inbox-Wiederaufnahme getestet ist.
- Vollständige Runtime-Synchronisierung einschließlich verbliebener Hilfsfunktionen und reproduzierbarer Deployment-Manifeste. Unbenutzte Deployments erst nach Nutzungsprüfung entfernen.

## Technische Referenzen

- [Supabase: Function-Berechtigungen](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase: öffentlich ausführbare SECURITY DEFINER-Funktionen](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Supabase: Edge-Function-Limits](https://supabase.com/docs/guides/functions/limits): aktuell maximal 150 Sekunden Free / 400 Sekunden Paid; die Wiederaufnahmegrenze von 600 Sekunden liegt darüber.
- [Supabase: Queues und Visibility Window](https://supabase.com/docs/guides/queues)
