# Quellen- und Zustellaudit – 09.09.2026

## Umfang und Aussagegrenzen

Read-only-Auswertung aller 65 Quellen gegen Supabase-Produktion, Fenster letzte 24 Stunden um 12:57 UTC. Crawl-Zähler, letzter Fundbestand, neue IDs, Frischeflags, Matching mit dem tatsächlichen SQL-Prädikat, Delivery-Events und Fehler wurden getrennt geprüft. Zahlen sind zeitbezogene Momentaufnahmen, keine Coverage-Prozentwerte. „Complete“ ist eine Connector-Aussage, keine unabhängige Vollständigkeitszertifizierung. Bei deaktivierten Quellen wurde keine neue externe Vollinventur durchgeführt.

## Kernbefund

Es gibt keinen belegten globalen Queue- oder Routing-Ausfall. Wiedergefundene Angebote sind nicht neue Angebote. Vonovia/GCP hatten keine neuen IDs in 24 Stunden. Tauschwohnung ist nach dem Altanzeigen-Incident bewusst gesperrt. City-Wohnen hat neue IDs, aber keinen dem Budgetfilter zugeordneten Warm-/Kaltmietwert. Weitere konkrete Verluste entstehen nach dem Matching: Verfügbarkeit unbekannt (WG-Gesucht), inaktive Inserate (altoba/Urban), unklarer Telegram-Ausgang (Scout) und ein fälschlich abgelehntes Bild (VHW).

## Kleinster implementierter Fix

- Gültige JPEG/PNG/GIF/WebP-Bildsignaturen werden auch bei falschem MIME-Header erkannt. Bisher wurden VHW-S3-JPEGs mit application/octet-stream abgelehnt.
- Nur nach bestätigtem Foto-Fehler und bestätigtem unbrauchbarem Upload wird Text mit Angebotsbuttons zugestellt. Unklare Telegram-Ausgänge werden niemals als Anlass für einen zweiten Versand benutzt.
- Genau ein Foto pro Vorschau; sämtliche Textinformationen bleiben erhalten. Fortsetzungen alter Galerien senden keine weiteren Fotos nach bereits bestätigtem Bildschritt.
- Bezirk und Stadtteil werden aus expliziten strukturierten Feldern oder beschrifteten HTML-Feldern angezeigt. Keine Ableitung aus Beschreibung oder Kontaktadresse. Fehlende Felder bleiben unsichtbar; kein erfundener Bezirk.
- Keine Änderung an Matching, Preisfiltern, Deduplizierung, Queue, Frischeflags, Cron oder Quellenfreigaben in diesem Audit. Keine Massenfreigabe alter Inserate, kein Refactoring der Worker.

## Shadow-Live-Nachweis

Reales VHW-Angebot: 73c01441-47b4-429d-abf9-41ef62b15693. Zwei Produktions-Events hatten den Fehler „Source image returned non-image content“. Dieselbe erste Bild-URL antwortete mit HTTP 200, application/octet-stream. Authentifizierte Liveprobe der neuen Upload-Prüfung (net request 170616): image/jpeg, 69085 Bytes, Angebot online, Operation sendPhoto. Der alte Header-Guard würde diese Antwort ablehnen; der neue Guard akzeptiert die tatsächliche JPEG-Signatur. Keine Telegram-Nachricht im Shadow-Test gesendet; eine erneute reale Zustellung dieser ausgeschöpften Events wurde nicht behauptet oder erzwungen.

Weitere echte Detail-Dry-Runs: Vonovia (170608) unknown; GCP (170609) online/sendPhoto; Tauschwohnung (170610) online/sendMessage, bleibt durch Quellenstatus vom Versand ausgeschlossen; VHW (170611) online/sendPhoto. Ein Dry-Run plant Darstellung, beweist allein aber keinen Profilmatch oder Telegram-Empfang.

60 gezielte Tests bestanden (Vorschau, MIME, Textfallback, unbekannter Ausgang, Leases, Dispatcher, Verfügbarkeit, Katalog-Baselines, Worker, Immomio-Fallback, Coverage-Regressionen). Produktionscode v72 nach Deployment bytegenau zurückgelesen. Betriebssnapshot danach: {"crawls_failed_last15":2,"crawls_ok_last15":157,"jobs_open":0,"sent_last15":10,"stale_deliveries":0}. Zwei externe Crawlfehler bleiben sichtbar; keine perfekte Quellenstabilität behauptet. Eine ausstehende ältere lokale Architektur-Bereinigung ist nicht Bestandteil dieses minimalen Commits; kein vollständiger Gesamtsuite-Nachweis dafür.

## Jede Quelle einzeln

Crawl = erfolgreich/fehlgeschlagen in 24 h. Fund = letzter Lauf, inklusive ggf. negativem/älterem Lauf bei stillgelegten Quellen. Neu/frisch = neue DB-IDs/mit Frischeflag in 24 h. Match = aktuell aktive frische Primär-Listings mit mindestens einem aktiven Profilmatch, ohne Quellenstatusfreigabe; deshalb sind Tauschwohnung-Matches nicht versandberechtigt. Events/gesendet zählt Empfängerzustellungen, nicht unterschiedliche Wohnungen.

| Quelle | Crawl OK/Fehler | Fund | Neu/frisch | Match | Events/gesendet | Befund / Coverage-Potenzial |
|---|---:|---:|---:|---:|---:|---|
| 1 ImmobilienScout24 Hamburg | 252/1 | 112 | 57/19 | 17 | 47/45 | Teildeckung: adaptive Suchsegmente; 2 Telegram-Ausgänge unklar, keine automatische Wiederholung. |
| 2 Kleinanzeigen Hamburg | 252/0 | 153 | 155/92 | 62 | 186/186 | Teildeckung: rotierende Bestandsseiten; 27 alte Treffer im letzten Fast-Lauf verworfen. Versand nachgewiesen. |
| 3 Immowelt Hamburg | 251/2 | 431 | 127/123 | 111 | 238/234 | Teildeckung: 184 Deep-Pages offen; bestehender Cursor arbeitet weiter. Versand nachgewiesen. |
| 4 SAGA | 145/108 | 0 | 3/0 | 0 | 0/0 | Provider-Index unzuverlässig; jüngster Lauf ohne verifizierte Treffer. 3 neue IDs ohne Frischefreigabe. Native Quelle verbessern. |
| 5 Vonovia Hamburg | 253/0 | 4 | 0/0 | 0 | 0/0 | 4 wiedergefundene Treffer, keine neue ID/24 h. Spiegel statt Vollbestand; Detail-Liveprobe unknown. Kein ungeprüfter Versand. |
| 6 WG-Gesucht Hamburg | 253/0 | 3 | 4/4 | 4 | 8/2 | 6 Events nach 5 Versuchen an Verfügbarkeitsprüfung gescheitert; 2 versandt. Verifikation der Originalseite verbessern. |
| 7 TAG Wohnen Hamburg | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 8 Grand City Property Hamburg | 250/2 | 1 | 0/0 | 0 | 0/0 | Primärpfad liefert 1 aktuellen Treffer; keine neue ID/24 h. Liveprobe online. Vollständigkeit weiterhin unbewiesen. |
| 9 HousingAnywhere Hamburg | 251/1 | 0 | 0/0 | 0 | 0/0 | Feed mit 0 Treffern, leeres Ergebnis unbestätigt; native Bestandsenumeration prüfen. |
| 10 Wunderflats Hamburg | 252/0 | 22 | 0/0 | 0 | 0/0 | 22 Treffer, gemeldeter Bestand 1462; Seiten 2–5 HTTP 403. Baseline nicht abgeschlossen, Frischefreigabe gesperrt. |
| 11 Heimstaden Hamburg | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 12 Ohne-Makler.net Hamburg | 252/0 | 15 | 3/3 | 3 | 11/11 | Teildeckung; unabhängiger Gesamtbestand fehlt. Native Enumeration/Frischenachweis prüfen. |
| 13 Homelike / Spacest Hamburg | 252/0 | 99 | 0/0 | 0 | 0/0 | Connector meldet Vollbestand; keine zusätzliche Coverage-Lücke aus Telemetrie belegt. |
| 14 meinestadt.de Hamburg | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 15 immobilien.de Hamburg | 321/0 | 38 | 4/2 | 1 | 1/1 | Connector meldet Vollbestand; keine zusätzliche Coverage-Lücke aus Telemetrie belegt. |
| 16 immobilie1 Hamburg | 251/1 | 116 | 6/6 | 4 | 10/10 | Connector meldet Vollbestand; keine zusätzliche Coverage-Lücke aus Telemetrie belegt. |
| 17 City-Wohnen Hamburg | 252/0 | 83 | 67/9 | 0 | 0/0 | 9 frische aktive Primär-IDs, 0 Profilmatches: Warm-/Kaltmiete NULL. Alle 13 aktiven Profile haben Preislimit. Preissemantik vor Matching ergänzen, nicht ungeprüft umetikettieren. |
| 18 Studierendenwerk Hamburg | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 19 Nestpick Hamburg | 250/2 | 127 | 0/0 | 0 | 0/0 | API meldet 159, Enumeration 141, übernommen 127. Preisbestandteile unbestätigt; Scope/Filter und Pagination prüfen. |
| 20 Covivio Hamburg | 494/0 | 0 | 1/1 | 1 | 3/3 | Teildeckung; unabhängiger Gesamtbestand fehlt. Native Enumeration/Frischenachweis prüfen. |
| 21 Tauschwohnung.com Hamburg | 86/0 | 327 | 84/84 | 67 | 110/106 | Nach Altanzeigen-Incident deaktiviert/shadow. 106 historische Zustellungen/24 h, kein Beleg für neuen Versand nach Sperre. 7783/8146 enumeriert; Originaldatum statt entdeckter ID nötig. |
| 22 Wohnungsswap.de Hamburg | 494/0 | 10 | 2/0 | 0 | 0/0 | 2 neue IDs, 0 Frischefreigaben. Veröffentlichungsnachweis nötig. |
| 23 Hamburger Wohnen | 252/0 | 3 | 1/1 | 0 | 2/2 | Connector meldet Vollbestand; keine zusätzliche Coverage-Lücke aus Telemetrie belegt. |
| 24 Bergedorf-Bille | 251/1 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 25 BVE | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 26 altoba | 252/0 | 0 | 2/2 | 0 | 8/0 | 8 Events wegen mittlerweile inaktiver Listings übersprungen; keine Versandstörung nachgewiesen. |
| 27 HANSA | 251/1 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 28 BGFG | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 29 VHW | 252/0 | 4 | 2/2 | 2 | 8/6 | 2 von 8 Events am Bild-Header gescheitert: gültiges JPEG als octet-stream. Fix + Live-Bildprobe erfolgreich. |
| 30 HARABAU | 252/0 | 7 | 0/0 | 0 | 0/0 | Connector meldet Vollbestand; keine zusätzliche Coverage-Lücke aus Telemetrie belegt. |
| 31 GWG-Gruppe Hamburg | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 32 EBV Harburg | 252/0 | 3 | 0/0 | 0 | 0/0 | Connector meldet Vollbestand; keine zusätzliche Coverage-Lücke aus Telemetrie belegt. |
| 33 KAIFU-NORDLAND | 173/79 | 0 | 0/0 | 0 | 0/0 | 79 historische Fehler/24 h, jüngster Lauf erfolgreich und explizit leer; aktuellen Fix beibehalten. |
| 34 Bauverein Reiherstieg | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 35 Walddörfer | 252/0 | 1 | 0/0 | 0 | 0/0 | Connector meldet Vollbestand; keine zusätzliche Coverage-Lücke aus Telemetrie belegt. |
| 36 Fuhlsbüttel | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 37 Finkenwärder-Hoffnung | 252/0 | 1 | 0/0 | 0 | 0/0 | Connector meldet Vollbestand; keine zusätzliche Coverage-Lücke aus Telemetrie belegt. |
| 38 Hanseatische Baugenossenschaft | 252/0 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 39 mgf Gartenstadt Farmsen | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 40 Schiffszimmerer | 252/0 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 41 Süderelbe | 252/0 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 42 Lehrerbau | 252/0 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 43 Gartenstadt Wandsbek | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 44 Gartenstadt Hamburg | 252/0 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 45 FLUWOG-NORDMARK | 252/0 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 46 Wohnungsverein Hamburg von 1902 | 248/4 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 47 Wohnungsunternehmen Fiefstuecken | 250/2 | 2 | 0/0 | 0 | 0/0 | Connector meldet Vollbestand; keine zusätzliche Coverage-Lücke aus Telemetrie belegt. |
| 48 meravis Hamburg | 252/0 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 49 Smartments Hamburg | 0/0 | 1 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 50 Urban Living Hamburg | 247/5 | 0 | 1/1 | 0 | 1/0 | 1 Event wegen inaktivem Angebot übersprungen. |
| 51 Felixx student Hamburg | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 52 Wichern Baugesellschaft | 252/0 | 2 | 0/0 | 0 | 0/0 | 2 Kandidaten, 1 aktives Listing, unvollständige Quelle; keine neue ID/24 h. Präzisen Angebotsbestand verifizieren. |
| 53 KOLPING | 252/0 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 54 HSG Wohnen | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 55 WG von 1904 | 252/0 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 56 WHW 1897 | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 57 WGPV | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 58 Wohnreform eG | 251/1 | 0 | 0/0 | 0 | 0/0 | HTTP erreichbar, Leerbestand nicht bestätigt. Inventarschnittstelle/Registrierungsportal unterscheiden; Coverage offen. |
| 59 Wohnwarft eG | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 60 Baugenossenschaft der Buchdrucker | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 61 dhu | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |
| 62 DVG Immobilien | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 63 Wohnungsbörse.net Hamburg | 0/0 | 0 | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 64 Falkenried-Terrassen | 0/0 | – | 0/0 | 0 | 0/0 | Nicht live: Konfiguration absichtlich shadow/deaktiviert; keine End-to-End-Zustellung geprüft. Anbindung zunächst separat verifizieren. |
| 65 BDS Dennerstraße-Selbsthilfe | 252/0 | 0 | 0/0 | 0 | 0/0 | Connector meldet vollständigen leeren/relevanzgefilterten Bestand; kein fehlender Versand belegbar. |

## Offene Arbeit

- Für eine vollständige Coverage-Zertifizierung fehlt je Quelle eine unabhängige aktuelle Soll-Liste; reine HTTP-Erreichbarkeit reicht nicht.
- Vonovia-Detailverifikation, WG-Gesucht-Verfügbarkeitszugriff, SAGA-Indexstabilität, Wunderflats-403 und City-Wohnen-Preiszuordnung benötigen quellspezifische Nachweise. Keine Umgehung von Zugriffssperren oder Preisfiltern vorgenommen.
- Keine Behauptung, dass nun alle 65 Quellen zustellen. Der konkrete VHW-Bildblocker ist behoben und live überprüft, weitere Blocker oben bleiben offen.

Rollback: nur die drei Dispatcher-Quelldateien aus dem Elterncommit deployen; Manifest entsprechend aktualisieren. Datenmigration oder Datenrollback ist für diesen Fix nicht nötig. Der Elterncommit enthält noch die frühere Galeriepolitik; bei reinem Bildfix-Rollback Ein-Bild-Regel beibehalten.
