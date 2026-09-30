# Architekturprüfung vom 30.09.2026

## Ergebnis und Umfang

Bestätigte Codefehler wurden mit gezielten Änderungen behoben und die betroffenen Supabase-Funktionen produktiv aktualisiert. Grundlage: telegram_bot/main aa1c8983efadec9d5bb643a56f5a5fdc5f975bfe und website_traumwohnung/main 5cd4fded4ab98139a45f6c2f592ebde509157139, Projekt dpmohkrwdlicexwcrqfy.

Geprüft wurden beide Repository-Strukturen, die 290 registrierten Migrationen, die aktuellen Datenbankroutinen und Berechtigungsgrenzen, alle 111 bereitgestellten Edge-Function-Bundles sowie die produktiven Queues, Cron-Aufrufe, Crawl-, Zustell- und Bewerbungsdaten. Bei den zusätzlich bereitgestellten Diagnosefunktionen lag der Schwerpunkt auf Authentifizierung, deaktivierten Endpunkten und statisch nachweisbaren Laufzeitfehlern. Dies ist kein vollständiger externer Last-, Restore- oder Browser-End-to-End-Test aller 68 Quellen.

| Bereich | Prüfung |
| --- | --- |
| Quellen | Konfiguration, Adapter, Kategorie-Streams, Fastlane/Coverage, Baselines, Claims und Bestätigungen |
| Listings und Zustellung | Neuheitsnachweis, Matching, Deduplizierung, Verfügbarkeit, Zustell-Leases und unbestätigte Ausgänge |
| Bewerbungen | Premium-/Opt-in-Gates, Provider-Mapping, Vorbereitung, Versuchszähler, Sendefreigaben und unsichere Versandausgänge |
| Coach-Portal und Login | zentrale Teilnehmer-UUID, Rollen-/Besitzprüfung, private Dokumente, Login-Tickets und PKCE |
| Billing | Webhook-Authentifizierung, Idempotenz und Übereinstimmung der Premium-Texte |
| Datenbank | private Schema-Grenze, RLS, SECURITY DEFINER, Wartung, Advisor-Hinweise und Cron-Zustand |
| Deployment | tatsächlicher Supabase-Code gegen GitHub; lokale und zurückgelesene Bundle-Prüfsummen |

## Einzelne Korrekturen

| Fehler | Minimale Korrektur | Nachweis |
| --- | --- | --- |
| Kleinanzeigen-Haus-/Zimmer-Streams rufen nicht vorhandene fetchKlein/parseKleinHtml auf | Vorhandene fetchListingPage/parsePage verwenden; Upstream-Status prüfen | Beide Streams nach Deployment erfolgreich, jeweils 307 Fehler auf 0 |
| Mehrere große Portal-Crawls teilen das knappe CPU-Budget eines Worker-Aufrufs | Ein Job je Claim; nach großem Portal den Aufruf abschließen; für kleine Quellen bleibt das bestehende 50-Sekunden-Fenster erhalten | ImmobilienScout24 und Kleinanzeigen schließen wieder Jobs ab; Zeitbudget-/Durchsatztests |
| Immowelt normalisiert denselben langen Inseratstext für jeden Provider-Alias erneut | Text einmal je Kandidat normalisieren | Lokaler Vergleich: 16 Seiten, 448 Kandidaten; CPU 1167 ms auf 378 ms, ca. 67 % weniger; Live-Crawl wieder erfolgreich |
| Immowelt-Hostname-Prüfung enthält doppelt maskierte Punkte | Zwei reguläre Ausdrücke korrekt maskieren | Weitergeleitete Suche mit anderer Quell-ID nutzt den richtigen Parser |
| Login-Broker überschreibt den globalen URL-Konstruktor mit einer Zeichenkette | Konfigurationsvariable SUPABASE_URL nennen | Login-URLs aller drei Provider einschließlich State und PKCE getestet |
| Drei Diagnose-Endpunkte überschreiben ebenfalls den URL-Konstruktor | Nur die betreffende Konfigurations-/Zielvariable umbenennen | APK-Linkauflösung, absolute Script-URLs und erfolgreicher Upload-Abschluss getestet |
| Allgemeiner Bewerbungs-Worker zählt temporäre Vorbereitungsausfälle nicht | Bei erneut eingeplanter Vorbereitung attempts erhöhen; Provider-State erhalten | Wiederholungen enden am bestehenden Limit |
| Kleinanzeigen-Bewerbungs-Worker hat denselben Fehler | Dieselbe kleine Korrektur auf dem tatsächlichen produktiven Quellstand | Wiederholungs- und State-Erhaltungstest |
| Immomio zählt temporäre Fehler vor Sendefreigabe nicht | Versuch bei erneut eingeplanter Vorbereitung erhöhen; nach Freigabe nicht doppelt zählen | Wiederholungen enden am bestehenden Limit |
| Premium-/Stripe-Bestätigung nennt drei statt vier Suchprofile | Zwei Texte auf vier Suchprofile und bestehende Auto-Bewerbung abstimmen | Fachliche Limits und Zahlungslogik bleiben unverändert |
| Meravis-User-Agent enthält einen Domain-Tippfehler | Domain korrigieren und gemeinsam eingebettete Handler abgleichen | Standalone-, Source-Worker- und Shadow-Code stimmen überein |
| GitHub enthält ältere Kleinanzeigen-Mappings und einen älteren ImmoScout-Canary | Bereits produktive Verbesserungen exakt übernehmen | Kein Rückschritt bei kategorisierten Nachrichten, Profil-Mapping oder optionalen Telefonnummern |
| Deployment-Register erfasst aktive Funktionen unvollständig und enthält veraltete Versionen | Tatsächlich gelesene Bundles, Versionen und Hashes eintragen | 47 registrierte Bundles: 41 produktive/supportbezogene Bundles und sechs deaktivierte Kompatibilitäts-Bundles |
| Architektur-Dokumentation nennt veraltete Quellen-/Cron-/Bundle-Zahlen | Nur betroffene Bestandsangaben berichtigen | Abgleich mit aktueller Datenbank und Function-Inventar |

Die neuen Dateien unter deployed-support dokumentieren den bestehenden produktiven Diagnosecode mit der jeweiligen kleinen Variablenkorrektur. Die umfangreichere, bisher nicht produktive APK-Utility unter functions wurde dabei nicht ersetzt.

## Validierung

- 316 tatsächlich ausgeführte Backend-Testfälle in 64 Testdateien: alle erfolgreich.
- Strikte Runtime-Prüfung: 47 Bundles und 290 Migrationen erfolgreich.
- Cloudflare-Login-Worker: elf Tests erfolgreich; Coach-Portal baut erfolgreich, geänderte Integrationspfade und vorhandene Skripte geprüft.
- Alle aktualisierten Deployments wurden aus Supabase zurückgelesen und dateiweise gegen den beabsichtigten Code verglichen.
- Authentifizierte Health-/Dry-run-Aufrufe für Source-Worker und drei Bewerbungs-Worker erfolgreich; ungültige Login-Tickets und Diagnoseaktionen korrekt abgewiesen.
- Live-Nachweis nach Korrektur: ImmobilienScout24 und Kleinanzeigen laufen weiter erfolgreich; Immowelt letzter bestätigter erfolgreicher Crawl 30.09.2026 05:11:07 UTC. Beide reparierten Kleinanzeigen-Kategorien haben Fehlerzähler 0.
- Der lokale CPU-Vergleich ist ein reproduzierbarer Parservergleich auf einer aktuellen öffentlichen Immowelt-Antwort. Er ist keine Messung der gesamten Supabase-Rechnung oder aller Provider-Latenzen.

## Betrieb und verbleibende Grenzen

Aktueller Bestand: 68 Quellen; 55 aktiviert/live, eine aktiviert/shadow, elf deaktiviert/shadow und eine deaktiviert/live. Neun Cron-Einträge, davon sieben aktiv; bei der Bestandsprüfung kein fehlgeschlagener Cron-Lauf in den vorherigen 24 Stunden. Es bestehen 111 bereitgestellte Endpunkte. Supabase ACTIVE bedeutet nicht, dass ein Endpunkt fachlich aktiviert ist: zahlreiche historische Endpunkte liefern bewusst 410/Deaktivierung oder sind intern authentifizierte Diagnosewerkzeuge.

Die 64 weiteren Diagnose-/Test-Endpunkte werden durch diese Prüfung nicht zu produktiven Komponenten erklärt. Ihr geprüfter Bestand bleibt erhalten; pauschales Löschen hätte keinen belegten Betriebsnutzen und könnte vorhandene Diagnosemöglichkeiten entfernen.

Provider-Antworten wie plus_required, fehlende bestätigte Formulardaten, nicht verfügbare Anzeigen und Captchas werden weiterhin als tatsächliche Anbieterbedingungen behandelt. Mehrdeutige Versandausgänge bleiben manuell zu prüfen; automatische Wiederholung nach möglichem Versand würde doppelte Bewerbungen riskieren. Der Audit löste keine neuen Testbewerbungen oder Teilnehmernachrichten aus.

RLS ohne Benutzer-Policies ist bei Service-only-Tabellen beabsichtigt. Private Tabellen/Routinen sind über die private Schema-Grenze gegen anon/authenticated abgeschirmt; öffentlich exponierte privilegierte Routinen wurden auf effektive Ausführungsrechte geprüft. Advisor-Hinweise auf ungenutzte Indizes oder fehlende FK-Indizes rechtfertigen ohne konkreten Abfrage-/Lastnachweis keine pauschale Änderung. Der Hinweis zur deaktivierten Prüfung geleakter Auth-Passwörter bleibt eine Konfigurationsempfehlung, kein hier behobener Codefehler.

Es erfolgten keine Schema-Refactorings, Änderung der Zustell-Neuheitsregel, Aufweichung von Premium-/Sendefreigaben oder Änderung der Zahlungslogik. Für eine Rücknahme sollten nur die einzelnen Codekorrekturen zurückgenommen und die betreffenden Bundles erneut verglichen werden; ein vollständiges Deployment des älteren GitHub-Standes würde produktive Profil-/Provider-Korrekturen verlieren.
