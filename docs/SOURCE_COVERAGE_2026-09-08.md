# Quellen-Coverage und Admin-Shadow-Test — 08.09.2026

## Umfang und Minimalplan

Ziel: belegte Verluste zwischen Quelle, Parser, Datenbank und Telegram korrigieren. Alle 65 registrierten Quellen einzeln bewerten; funktionierende Anbindungen und Geschäftsregeln erhalten. Keine Massen-Nachzustellung von Altbestand, keine Lockerung von Hamburg-/Objekttyp-/Frischefiltern und kein zusätzlicher Queue-Dienst.

Geprüft: Konfiguration, aktuelle produktive Läufe, 24-Stunden-Verlauf, aktive/neue Inserate, aktuelles SQL-Profilmatching und Zustellstatus. Zusätzlich 65 HTTP-Zielproben (58 HTTP 200, sieben Fehler), 16 echte native Immomio-/ImmoSolve-Proben und gezielte Originalantworten für auffällige Quellen. Sechs anfängliche lokale Native-Timeouts waren bei gezielter Wiederholung erfolgreich. HTTP 200 oder JavaScript-Shell allein gelten nicht als bestandener Inventartest; GET 406 am MCP-Endpunkt ist kein fehlgeschlagener MCP-Protokolltest.

**Jede Quelle hat eine eigene Zeile:** [65 Einzelbefunde und Entscheidungen](SOURCE_COVERAGE_2026-09-08.csv). Ausgangsmengen stammen von etwa 20:06–20:13 UTC; spätere Änderungen des Anbieterbestands sind möglich.

## Bestätigte Fehler und Korrekturen

| Quelle / Bereich | Ursache und Änderung | Produktiver Nachweis |
|---|---|---|
| immobilien.de, 15 | Alte lr-card-/block-Struktur durch native Next.js-Daten und page-Pagination ersetzt. IDs, Mietart und vollständige Mengen geprüft. Überholten Zusatzparser auf Diagnose gesetzt; verhindert Feldüberschreibung und unberechtigte Blockade der Ein-Connector-Frischeprüfung | HTTP 200, 38/38 Rohobjekte auf zwei Seiten, 37 Hamburg-Wohnungen, alle mit expliziter Mietart; Worker bestätigt complete_snapshot |
| City-Wohnen, 17 | Ausgeschaltete AJAX-Pagination aktiviert; Raw-DEFLATE mit zusätzlichen Serverbytes dekodiert. Seitennummer und Gesamtzahl validiert | 79 eindeutige Rohobjekte, 75 passende Kandidaten, **58 zuvor fehlende Datenbankzeilen**. Vollständige Baseline ohne Versand dieses Erstbestands |
| Tauschwohnung, 21 | Neue /expose/ID-Links in Parser und Persistenzfilter unterstützt. Bei fehlendem HTML-Canonical native canonicalPath=/hamburg geprüft; exakte Objekt-ID, Ort und PLZ bleiben Pflicht | 33 gelesene Seiten, 328 Kandidaten, 14 neue Zeilen, keine Coverage-Fehler; Cursor läuft über die frühere Blockade auf Seite 578 hinaus |
| KAIFU, 33 | Veralteten 404-Endpunkt durch offiziell eingebundene Mietangebote-Filter-API ersetzt; neues result/filters-Envelope und bisheriges Schema unterstützt | Erfolgreicher Lauf mit verifiziertem Leerbestand. Positives neues Wohnungsformat anhand Frontend-Code abgesichert, mangels aktueller Wohnung noch nicht live positiv getestet |
| Wichern, 52 | Genau eine entfernte Wohnung und einen fälschlich erfassten Stellplatz deaktiviert. Stellplatz-/Garagen-URLs dieser Quelle vor Persistenz ausgeschlossen | Wohnungsdetail HTTP 404; aktuelle Vermietungsseite verlinkt nur Stellplatz. Negativer Regressionstest |
| Bildauswahl / City-Wohnen | Homepage-URL verdrängte das echte Wohnungsfoto. Homepage-/Listing-URLs auch in zwischengespeicherten Bildlisten ausgeschlossen | Echter Shadow-Versuch zunächst HTTP 400; nach Fix dasselbe Listing mit Foto erfolgreich zugestellt |

Erste produktive Nachläufe: 20:28 UTC. Deployment: **immobilien-de-transport v13, source-worker v61, notification-dispatcher v65**. Nicht betroffene Live-Dateien wurden erhalten. Die hochgeladenen Dateien wurden nach Deployment erneut abgerufen und verglichen.

Änderungen liegen in vorhandenen Transport-, Katalog-, Kandidatenfilter- und Vorschau-Dateien. Konfiguration: [angewendetes SQL](../scripts/fix-verified-source-coverage-20260908.sql). Keine Schemaänderung.

## Zustellgründe und Grenzen

Die zehn Immomio-Tenants funktionieren. Einige liefern nur Stellplätze, Objekte außerhalb des zulässigen Gebiets, keinen aktuellen Bestand oder bereits bekannte Baseline-Angebote. Registrierungsportale, Wohnanlagenverzeichnisse, datumsabhängige Buchungssysteme und Suchindex-Spiegel sind keine vollständigen Wohnungsfeeds.

Neue Datenbankzeilen sind nicht automatisch versendbare Neufunde. Die Frischemarkierung bleibt nach Ersterfassung unveränderlich. Suchprofile, Mietgrenzen, Objekttypen, Dubletten, Baseline, Verfügbarkeit und 24-Stunden-Grenze bleiben wirksam. Korrigierter Altbestand wird nicht pauschal nachgesendet.

City-Wohnen/Nestpick hatten im Ausgangsbestand keine Profilmatches: Monatspreise sind teils nicht eindeutig als Kalt-/Warmmiete qualifiziert. Die Vorschau zeigt den belegten Monatspreis; er wird nicht ohne Beleg als Warmmiete eingestuft. Coverage allein beseitigt diese Preisgrenze nicht.

Ein Immowelt-Inserat (`6852c803-d820-4724-b33c-e067988e576f`, Ersterfassung 04:47 UTC) passt heute zu zwei Profilen, hat aber kein Zustellereignis. Es gibt keine ausreichende historische Entscheidungsspur, um den ursprünglichen Ausschluss sicher einem Parser-, Matching- oder damaligen Dublettenstatus zuzuordnen. **Offen**, nicht als behoben deklariert; keine spekulative Triggeränderung oder historische Neuzustellung. Aktuelles Matching allein beweist keinen früheren Fehler.

Neun ältere fehlgeschlagene Bildzustellungen (acht immobilie1, eine Immowelt) wurden geprüft. Vorhandener Binärfallback nach bestätigter Telegram-Ablehnung bleibt erhalten. Unklare oder teilweise gesendete Ausgänge wurden nicht automatisch wiederholt.

## Shadow-Sendungen: ausschließlich Kawa

Empfänger über Admin-Allowlist und Datenbank verifiziert: aktiver Nutzer **Kawa**, Telegram-/Chat-ID `8538226539`. Jede Testsendung war zusätzlich auf genau dessen Datenbanknutzer, Namen und beide IDs beschränkt.

Die produktive dry_run-Vorschau erzeugte die Inhalte ohne Listing-/Zustellqueue-Schreibzugriff. Danach wurden sechs gekennzeichnete Karten einzeln über Telegram gesendet. Normale produktive Jobs liefen unabhängig weiter. Dies testet Quellenvorschau, Fotoabruf und Telegram-Annahme; kein künstlicher Durchlauf durch die normale Matching-Queue und kein Nachweis menschlicher Sichtprüfung.

| Quelle | Telegram-Message-ID | Ergebnis |
|---|---:|---|
| VHW / Tenant-Immomio | 11519 | Foto und Button bestätigt |
| Fiefstücken / ImmoSolve | 11520 | Foto und Button bestätigt |
| immobilien.de | 11521 | Foto und Button bestätigt |
| immobilie1 | 11522 | Foto und Button bestätigt |
| Tauschwohnung, neue Linkform | 11534 | Foto und Button bestätigt |
| City-Wohnen, nach Bildkorrektur | 11538 | Foto und Button bestätigt |

Alle sechs: HTTP 200, ok=true, Empfänger-ID 8538226539. Der erste City-Versuch war eindeutig mit HTTP 400 abgelehnt; erst nach korrigierter Vorschau wiederholt. Er zählt nicht als erfolgreiche Sendung. Keine Testsendung an andere Nutzer.

## Verifikation und wiederholbare Methodik

**97 Tests bestanden**: unter anderem neue/alte Tauschlinks, native Hamburg-Herkunft, Persistenzfilter, Raw-DEFLATE, falsche/abgeschnittene AJAX-Seiten, Next.js-Pagination, doppelte IDs sowie ungültige Bild-URLs in Cache und Rohdaten. Runtime-Prüfung: 23 Function-Manifeste und 151 Migrationen konsistent; 15 ausgewiesene Repository-vs.-Deployment-Dateiunterschiede verbleiben. Keine pauschale Synchronisation ungeprüfter Dateien.

[Read-only SQL-Diagnose](../scripts/audit-source-delivery.sql). Pro Quelle gilt dieselbe Reihenfolge:

1. Anbieteroberfläche und Konfiguration vergleichen; Wohnungsfeed von Registrierung/Verzeichnis unterscheiden.
2. Antwortschema, IDs, Seiten, Gesamtmengen und Hamburg-/Wohnungseignung prüfen. Fehler, unbestätigte Leerseite und verifizierten Nullbestand getrennt erfassen.
3. IDs mit Datenbank abgleichen; danach Frische, Matching, Dubletten und Zustellereignisse prüfen.
4. Belegten Fehler minimal korrigieren, Originalantwort und negativen Regressionstest prüfen, produktiven Nachlauf kontrollieren.
5. Klar markierte Beispiele nur an den autorisierten Admin schicken; technische Annahme und Sichtprüfung getrennt bewerten.

Offen bleiben insbesondere Wunderflats-Folgeseiten (403), SAGA-Direktzugriff (401) und unzuverlässiger Index, nicht erreichbare GWG-/WGPV-/Wohnwarft-Ziele sowie geschlossene Mitglieder-/Registrierungsbestände. Kein Nachweis vollständiger Marktabdeckung großer Portale oder Indexspiegel. Tauschwohnung liest wieder weiter, hat im Nachlauf aber noch keinen gesamten neuen Zyklus abgeschlossen. Details und Voraussetzungen stehen für jede Quelle in der CSV.

Die sechs Karten sind technisch zugestellt. Darstellung und Auswahl muss Kawa in Telegram beurteilen.
