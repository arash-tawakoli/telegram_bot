# Architektur-Bereinigung 09.09.2026

## Priorisierung und umgesetzt

| Befund | Nachweis | Maßnahme | Nutzen / Risiko |
|---|---|---|---|
| GitHub und Live-Worker unterscheiden sich | Alle 23 Edge-Bundles abgefragt; Worker-/Shadow-Abweichungen gegen Dateien verglichen | Gemeinsamer kanonischer Stand, Shared-Code in Source-Worker und Source-Shadow gleich deployt | Verhindert Rückschritte beim nächsten Deploy; vollständige Regressionstests |
| GCP testet nicht betriebene Fallback-/Mirror-Pfade | Live-v62 ruft nur Primär-Discovery auf; DB-Prioritäten 2/3 bereits deaktiviert/shadow | Repo auf produktiven Primärpfad reduziert, nicht aufgerufene Hilfsfunktionen entfernt; Verhaltenstests auf tatsächlichen Pfad ausgerichtet | Weniger irreführender Code; keine neuen Bestandsfreigaben |
| GCP konnte alle fehlgeschlagenen Detailabrufe als erfolgreichen Leerbestand verbuchen | `discover.errors` wurde ignoriert | Totalausfall meldet Fehler; Teilfehler als Metadaten, gültige Teilmenge bleibt erhalten | Ehrlicher Betriebsstatus; kein vollständiger Snapshot behauptet |
| UI enthält ungenutzte Elemente | Definitionen ohne Aufrufer/Imports in sämtlichen Runtime-Modulen | `ensureUser`, `textFor`, leeres `PREMIUM_PREVIEW_B64` entfernt | Nutzervorbereitung über bestehenden RPC, Lokalisierung über verwendete Funktionen erhalten |
| Doppelter CI-Testlauf | Separater Wunderflats-Workflow führt Test aus, der bereits in npm test enthalten ist | Workflow entfernt; Listing-Key-Tests bleiben | Ein Workflow weniger pro Push/PR |
| Runtime-Abweichungen waren nur Warnungen | Vorheriger Check warnte bei deployed_sha256-Differenzen | Harte Prüfung der aufgezeichneten Hashes plus relativer Bundle-Abhängigkeiten | Beugt inkonsistenten Releases vor; kein automatischer Online-Driftmonitor |
| Bootstrap überschreibt aktives Register | Seed löschte Connectoren, setzte Baselines zurück und überschrieb Live-Modi | Transaktion, Vorab-Abbruch bei vorhandenem Register, redundantes Löschen entfernt, Neuregister deaktiviert/shadow | Verhindert versehentliche Rücksetzung; keine Ausführung auf Produktion |
| Betriebsdokumentation veraltet | README nannte 28 Tests, 22 Functions und ältere Versionen | Aktuelle zentrale Architektur und Verweise | Klare Trennung von aktuellem Betrieb und historischen Befunden |

## Supabase-Prüfung

23 Bundles aus Produktion gelesen. Source-Worker v63, Source-Shadow v7 und Telegram-UI v70 deployt und vollständig zurückgelesen. Alle 23 Bundles passen anschließend zum lokalen Code und Manifest. Dispatcher v73 enthält unverändert die vorherige Ein-Bild-, MIME- und Standortkorrektur.

Sources/Connectoren, zehn Cron-Jobs, Retention-Routine, Tabellenstatistiken, Indizes und öffentliche Rechte geprüft. 0 öffentliche SECURITY-DEFINER-Funktionen für anon/authenticated ausführbar; keine direkten Grants auf die geprüften Bot-/Listing-/Profil-/Merkliste-Tabellen. Security Advisor: ausschließlich 26 INFO-Meldungen zu RLS ohne Policies; Performance Advisor: vier INFO-Indexhinweise. Diese Service-only-/Fremdschlüssel-Befunde sind kein Anlass, Schutzmechanismen zu entfernen.

Größte geprüfte Tabellen: listings ca. 90 MB, crawl_runs ca. 74 MB, source_jobs ca. 31 MB. Bestehende Retention vorhanden; diese Größen belegen keinen Performanceengpass. Kein ungeprüftes Löschen, VACUUM FULL oder Entfernen von Fremdschlüsselindizes.

## Verifikation

- Gesamte lokale Suite: 121 Tests bestanden, 0 fehlgeschlagen (abschließender Lauf).
- Runtime-Gate: 23 Bundles und 151 Migrationen; jede lokale Datei entspricht dem aufgezeichneten Live-Inhalt.
- Authentifizierter Worker-Probe 170690: HTTP 200, dry_run true.
- Shadow-Probe 170691: HTTP 200, drei Diagnosepfade für GCP. Gefundene generische Kandidaten werden ausdrücklich nicht als verifiziertes Inventar gezählt. Keine Listing-Schreibzugriffe/Telegram-Nachrichten.
- UI-Probe 170694: HTTP 200, ignoriertes leeres Update; keine Nachricht erzeugt.
- Worker ohne Secret 170695: HTTP 401.
- Regulärer GCP-Crawl 13:25:22 UTC nach Deployment: erfolgreich, Strategie gcp_primary, 4 Detail-URLs entdeckt, 1 relevantes Angebot, keine Detailfehler; complete bleibt false.
- Betriebsabfrage 13:22 UTC: 0 offene HTTP-Requests, 0 queued/processing Source-Jobs; neue Crawl- und HTTP-Antworten vorhanden.
- Kein Benchmark-Versprechen: kleinere Codefläche und ein redundanter CI-Lauf weniger sind nachweisbar; schnellere Telegram-Reaktionen oder prozentuale Geschwindigkeitsgewinne wurden nicht gemessen.

## Bewusst erhalten und Grenzen

Zwei HTTP-410-Kompatibilitätsendpunkte und `noop` bleiben erhalten: externe Aufrufer können anhand reiner Repository-Referenzen nicht ausgeschlossen werden; das verfügbare Connector-Werkzeug bietet keine Edge-Function-Löschung. Historische Migrationen/Quellen/Reparaturbelege sind keine aktive Doppelarchitektur und wurden nicht entfernt. Die außerhalb dieses Auftrags lokal abweichende historische Coverage-CSV wurde nicht veröffentlicht.

Offene quellspezifische Funktions-/Coverage-Probleme stehen im [Quellenaudit](SOURCE_DELIVERY_AUDIT_2026-09-09.md). Diese Bereinigung ist kein Nachweis vollständiger Versorgung durch alle 65 Quellen. Nutzerfilter, Tauschwohnung-Sperre, Deduplizierung und unsichere Versandzustände bleiben erhalten.

Rücknahme: Commit zurücksetzen und die drei betroffenen Edge-Bundles mit sämtlichen manifestierten Dateien deployen. Produktive Daten wurden durch diese Bereinigung nicht migriert oder gelöscht.
