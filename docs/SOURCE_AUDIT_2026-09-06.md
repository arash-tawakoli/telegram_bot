# Einzelprüfung der 65 Quellen – 6. September 2026

Alle 65 Quellen und ihre konfigurierten Connector-Slots wurden erfasst und einzeln bewertet. Die Prüfung belegt **nicht**, dass 65 unabhängige, vollständig zugängliche Wohnungsfeeds existieren. Registrierungsseiten, Suchindex-Spiegel und HTTP-200-Leerseiten werden nicht als vollständiger Angebotsbestand gewertet.

## Durchgeführte Prüfung

- 104 unterschiedliche konfigurierte HTTP-Ziele, jeweils zwei GET-Proben; 16 zusätzliche native Immomio-/ImmoSolve-Protokollprüfungen mit jeweils zwei Versuchen. Netzwerkfehler einzelner Zusatzproben sind separat erfasst und werden nicht pauschal als Anbieter-Ausfall gewertet.
- Erfolgreiche HTTP-Antworten wurden mit den tatsächlich verwendeten Parsern ausgewertet: 168 Connector-/Antwortkombinationen. Das ist keine Aussage über 168 funktionierende Anbindungen.
- Produktionshistorie der letzten 24 Stunden; Abschlussmessung etwa 11:03 UTC / 13:03 MESZ. Laufzahlen können zusätzliche Crawl-Lanes und Codeversionen vor/nach der Umstellung enthalten. p50/p95 messen komplette protokollierte Läufe, keine isolierten Connector-Benchmarks.
- Neue native Parser zusätzlich gegen echte öffentliche Antwort-Snapshots und synthetische Fehlerfälle geprüft. Keine Zugangssperren umgangen und keine Bewerbungen oder Nachrichten an Anbieter gesendet.

Die CSV [Connector-Einzeltests](CONNECTOR_TESTS_2026-09-06.csv) enthält **jeden vorhandenen Slot** einschließlich HTTP-Ergebnissen, Messzeiten, Parserergebnis, Native-Protokollprüfung und finalem Betriebsstatus. [Quellenbewertung als CSV](SOURCE_AUDIT_2026-09-06.csv) enthält zusätzlich p50/p95, Modus und Einschränkungen. Dort stehen für umkonfigurierte Slots ausdrücklich die ursprünglich getestete Route und die neue Entscheidung nebeneinander.

## Umgesetzt

- Sechs echte Immomio-Wiederauflösungs-Fallbacks über offizielle Anbieterseiten aktiviert. Tenant-Identität, vollständige Pagination und eindeutige Objekt-IDs werden geprüft; Datenbankfehler lösen keinen unkontrollierten zweiten Schreibversuch aus. Der Wrapper hilft bei geänderter Einbettung, ist **kein unabhängiger Ersatz für einen kompletten Immomio-Ausfall**.
- City-Wohnen, Wunderflats und Tauschwohnung verwenden native Katalogdaten statt vermischter Textblöcke. Korrekte Hamburger Routen und rollierende Pagination; erstmalige Bestände werden erst nach vollständiger Routenbaseline für spätere Neufunde freigegeben.
- Tauschwohnung: vollständige erste Baseline erreicht, anschließend vier echte neue Angebote nachweislich per Telegram zugestellt. Eine laufende Teilrunde wird weiterhin als teilweise gelesen ausgewiesen.
- KAIFU und Finkenwärder verwenden typisierte öffentliche APIs; Stellplätze und Objekte außerhalb Hamburgs werden ausgeschlossen. BVE darf nur ein ausdrücklich erwartetes leeres Array als verifizierten Leerbestand werten.
- Schein-Fallbacks als Diagnose markiert. Smartments-Standortkarten und das Buchdrucker-Registrierungsportal sind im Shadow-Modus; falsche alte Katalog-/Standortkandidaten wurden deaktiviert und verifizierte Katalogobjekte regulär erneut eingelesen.
- Grand City Property behält die offizielle Suche, den Scout-Spiegel und die geprüfte Empfehlungsseite. Der letzte Lauf bestätigte zwei geeignete eindeutige Objekte. Bereits bekannte Bestandsangebote werden nicht erneut als neu versendet.
- Bestehende neuere Telegram-Optimierungen erhalten; Runtime-Manifest auf 23 Funktionen und Migrationsregister auf 148 angewendete Migrationen abgeglichen.

## Zustellung und Grenzen

In den sechs Stunden vor der Abschlussmessung sind 99 Zustellungen bestätigt: Scout 2, Kleinanzeigen 52, Immowelt 41, Tauschwohnung 4. Die p95-Wartezeit zwischen Queue-Erzeugung und bestätigtem Versand lag je liefernder Quelle bei 77–146 Sekunden. Dies misst **nicht** die Zeit seit Veröffentlichung beim Anbieter und nicht ausschließlich den persönlichen Chat eines einzelnen Nutzers.

Ein älterer Versuch vom 5. September hat nach einem Transportabbruch keinen eindeutig bestätigten Telegram-Ausgang. Er bleibt als unklar markiert; automatisches Wiederholen könnte doppelt zustellen. Normale neue Queue-Einträge laufen weiter. Filter, Berechtigungen, Dubletten und die Neufund-Baseline bleiben wirksam; eine kostenlose bzw. registrierungspflichtige Quelle kann keinen nicht zugänglichen Bestand liefern.

Wunderflats liefert auf Folgeseiten HTTP 403. City-Wohnens native AJAX-Antwort ließ sich in der Produktionsumgebung nicht zuverlässig dekodieren. Bei beiden bleibt der erste Seitenbestand sichtbar, aber eine vollständige Baseline und sichere neue Zustellung sind derzeit nicht belegt. Es gibt hierfür im Prüfstand keinen qualifizierten unabhängigen zweiten oder dritten Zugang. Für geschlossene Anbieterportale wäre ein autorisierter Anbieterfeed bzw. eine freigegebene Integration erforderlich.

## Entscheidung pro Quelle

„—“ bedeutet: kein weiterer geeigneter Zugang nachgewiesen. Es werden keine zwei Platzhalter-Fallbacks erfunden. Leere Bestände können korrekt funktionieren; die positive Wohnungsantwort ist dann nur soweit angegeben geprüft. Quoten sind technische Lauf-Erfolgsquoten, **keine Coverage-Prozente**.

| ID | Quelle / Primär | Fallback 1 | Fallback 2 | Läufe erfolgreich / gesamt | p50 / p95 ms | Coverage / Einschränkung |
|---:|---|---|---|---:|---:|---|
| 1 | ImmobilienScout24 Hamburg<br>MCP + adaptive Hamburger Teilabfragen | — | — | 254/254 | 10406 / 13839 | 7 Bezirke, Preispartitionen und rotierende Frische-Lanes. Index/Portal sind Diagnose, keine unabhängigen vollständigen Feeds. |
| 2 | Kleinanzeigen Hamburg<br>Kleinanzeigen Hybrid-Transport | — | — | 254/254 | 13493 / 18403 | Bezirksabfragen und schnelle Neufund-Lane. Transportabhängig; bisherige Zusatzslots waren keine getrennt ausgeführten Fallbacks. |
| 3 | Immowelt Hamburg<br>Immowelt öffentliche Suche + Sitemaps | — | — | 255/255 | 3631 / 5413 | 8 Gebiete, 6 Zimmersegmente, rotierende Stadtteilseiten. Eine interne Crawlstrategie; bisherige Zusatzslots nicht unabhängig. |
| 4 | SAGA<br>Öffentlicher SAGA-Suchindex | — | — | 194/254 | 0 / 516 | Teilabdeckung; zuletzt 6 Kandidaten. Direktzugriff eingeschränkt; Suchindex kann verspätet/unvollständig sein. |
| 5 | Vonovia Hamburg<br>Vonovia-Transport über öffentlichen Immowelt-Bestand | — | — | 254/254 | 1289 / 1700 | Öffentliche Spiegelangebote. Keine unabhängige native Vollbestands-API verifiziert. |
| 6 | WG-Gesucht Hamburg<br>WG-Gesucht öffentliche Suche | — | — | 254/254 | 990 / 1549 | Suchergebnisse und Pagination. JSON-LD derselben Seite ist kein unabhängiger Fallback; globale Vollständigkeit unbelegt. |
| 7 | TAG Wohnen Hamburg<br>TAG öffentliche JSON-Suche | — | — | 254/254 | 336 / 418 | Verifizierter Hamburg-Filter; derzeit 0 Wohnungen. Alternative /properties-Adressen sind nicht dieselbe funktionsfähige API. |
| 8 | Grand City Property Hamburg<br>GCP offizielle Suche | Scout-Spiegel über Quelle 1 (aktiv) | GCP-Empfehlungsseite (aktiv) | 254/254 | 860 / 4458 | 1 direkt + 2 Empfehlungen; 2 einzigartige geeignete Objekte im letzten Lauf. F1: Scout-Spiegel über Quelle 1; F2: GCP-Empfehlungen. Bestand ist nicht gleich neu zustellbar. |
| 9 | HousingAnywhere Hamburg<br>HousingAnywhere Neufund-Feed | — | — | 254/254 | 750 / 1381 | Native Neufund-Markierung; derzeit 0 neue Treffer. Kein vollständiger Marktbestand; Indexslots unqualifiziert. |
| 10 | Wunderflats Hamburg<br>Wunderflats nativer HTML-Katalog | — | — | 254/254 | 1476 / 2660 | 30 auf Seite 1 von rund 1473–1474 Treffern / 50 Seiten; 22 Hamburg-Wohnungen. Folgeseiten HTTP 403; vollständige Baseline und neue Zustellung deshalb gesperrt. |
| 11 | Heimstaden Hamburg<br>Heimstaden öffentliches Scout-Anbieterportal | — | — | 254/254 | 590 / 740 | Hamburg gefiltert; explizit 0 Treffer. Anbieterwebseite führt zum selben Portal, kein unabhängiger Feed. |
| 12 | Ohne-Makler.net Hamburg<br>Ohne-Makler Neufund-Transport | — | — | 254/254 | 3322 / 3879 | Monotone IDs nach geprüfter Ausgangsmarke. Kein unabhängiger zweiter Feed verifiziert. |
| 13 | Homelike / Spacest Hamburg<br>Spacest nativer Feed | — | — | 254/254 | 2638 / 3131 | Geprüfter API-Bestand, ungefähr 99 Kandidaten im Prüfstand. Homelike und Spacest sind nicht pauschal zwei unabhängige funktionsfähige Feeds. |
| 14 | meinestadt.de Hamburg<br>Kein qualifizierter Primärconnector; meinestadt Diagnose | — | — | 0/0 | None / None | 20 öffentliche Immowelt-Spiegelkarten gefunden. Keine verifizierte unabhängige Frische/zusätzliche Coverage; Shadow. |
| 15 | immobilien.de Hamburg<br>immobilien.de JSON-Transport | Öffentliche Suchseite (aktiv; Zusatzparser, Unabhängigkeit unbelegt) | — | 508/508 | 1968 / 3645 | 24 Kandidaten im Prüfstand. Öffentliche Suchseite zusätzlich angebunden; gleicher Bestand, Vollständigkeit nicht bewiesen. |
| 16 | immobilie1 Hamburg<br>immobilie1 JSON-Transport | — | — | 254/254 | 2131 / 2957 | 117 Kandidaten im Prüfstand. Alternative HTML-Slots nicht zusätzlich qualifiziert. |
| 17 | City-Wohnen Hamburg<br>City-Wohnen nativer Wohnungskatalog | — | — | 445/445 | 347 / 658 | 20 von 84 Objekten auf Seite 1; zuletzt 17 passende Hamburg-Wohnungen. Native AJAX-Antwort nicht zuverlässig dekodierbar; keine vollständige Baseline, Zustellung gesperrt. |
| 18 | Studierendenwerk Hamburg<br>Kein Angebotsfeed; Studierendenwerk-Verzeichnis | — | — | 0/0 | None / None | Wohnheime/Anmeldung statt aktueller freier Einzelwohnungen. Shadow; Zugang zu echtem Belegungsbestand fehlt. |
| 19 | Nestpick Hamburg<br>Nestpick öffentliche Such-API | — | — | 253/255 | 207 / 773 | 14 Seiten, 161 Rohpositionen / 139 eindeutige, 124 Hamburg-Kandidaten im Prüfstand. Doppelte Positionen explizit erkennbar; nur native neue Einträge nach Routenbaseline. |
| 20 | Covivio Hamburg<br>Covivio offizieller Sitemap-Feed | Indexfeed (aktiv; verzögert möglich) | — | 508/508 | 4822 / 7949 | Offizielle Detail-URLs und lastmod. Indexfeed als F1; kann verzögert sein. Nur belegte neue offizielle Zeitstempel freigegeben. |
| 21 | Tauschwohnung.com Hamburg<br>Tauschwohnung nativer Hamburg-Katalog | — | — | 254/254 | 2288 / 4572 | Rund 7806–7808 Angebote, 781 Seiten; erste vollständige Baseline erreicht. Rollierend bis 32 Folgeseiten je Lauf; 4 echte Telegram-Zustellungen nach Umstellung belegt. |
| 22 | Wohnungsswap.de Hamburg<br>Wohnungsswap nativer Feed | Indexfeed (aktiv; verzögert möglich) | — | 508/508 | 1112 / 1843 | Veröffentlichungszeitpunkt nach Baseline. Indexfeed als F1; kein dritter qualifizierter Zugang. |
| 23 | Hamburger Wohnen<br>Immomio Tenant-API | Offizielle Anbieterseite → derselbe Immomio-Tenant (aktiv) | — | 254/254 | 478 / 698 | 4 Rohangebote, 3 Hamburg-Wohnungen im Prüfstand. Offizielle Anbieterseite als verifizierter F1 für Tenant-Wiederauflösung. |
| 24 | Bergedorf-Bille<br>Bergedorf-Bille ImmoSolve/HPM | — | — | 254/254 | 1508 / 1689 | 9 Rohangebote; nur Stellplätze, 0 passende Wohnungen. Keine zweite unabhängige Bestandsanbindung verifiziert. |
| 25 | BVE<br>BVE öffentliche Umbraco-API | — | — | 254/254 | 226 / 276 | Explizites leeres JSON-Array als geprüfter Leerbestand. Positives Bestandsformat noch nicht anhand aktueller Wohnung überprüfbar. |
| 26 | altoba<br>altoba ImmoSolve/HPM | — | — | 254/254 | 133 / 239 | Verifizierter Leerbestand. Keine zweite unabhängige Bestandsanbindung verifiziert. |
| 27 | HANSA<br>HANSA ImmoSolve/HPM | — | — | 254/254 | 574 / 713 | Produktiv geprüfter Leerbestand. Lokale Zusatzproben mit Netzwerkfehler; Produktionshistorie separat bewertet. |
| 28 | BGFG<br>BGFG Immomio Tenant-API | — | — | 254/254 | 680 / 1027 | 6 Rohangebote; 0 passende Hamburg-Wohnungen. Anbieterportal kein zusätzlich verifizierter Fallback. |
| 29 | VHW<br>VHW Immomio Tenant-API | Offizielle Anbieterseite → derselbe Immomio-Tenant (aktiv) | — | 254/254 | 813 / 1103 | 7 Rohangebote, 4 Hamburg-Wohnungen. Offizielle Anbieterseite als verifizierter F1. |
| 30 | HARABAU<br>HARABAU Immomio Tenant-API | Offizielle Anbieterseite → derselbe Immomio-Tenant (aktiv) | — | 254/254 | 918 / 1248 | 8 Rohangebote, 6 Hamburg-Wohnungen. Offizielle Anbieterseite als verifizierter F1. |
| 31 | GWG-Gruppe Hamburg<br>Kein qualifizierter Primärconnector; GWG Diagnose | — | — | 0/0 | None / None | Öffentliche Route HTTP 502 im Prüfstand. Kein funktionierender unabhängiger Angebotsfeed belegt; Shadow. |
| 32 | EBV Harburg<br>EBV Immomio Tenant-API | — | — | 254/254 | 545 / 804 | 6 Rohangebote, 3 Hamburg-Wohnungen. Wrapper-Einbettung vorhanden, Wiederauflösung nicht vollständig verifiziert. |
| 33 | KAIFU-NORDLAND<br>KAIFU öffentliche Property-Supply-API | — | — | 445/445 | 530 / 633 | 2 Stellplätze, 0 Wohnungen. Typisierter Parser filtert Stellplätze und prüft wohnungseigene Mietfelder. |
| 34 | Bauverein Reiherstieg<br>Reiherstieg Immomio Tenant-API | Offizielle Anbieterseite → derselbe Immomio-Tenant (aktiv) | — | 254/254 | 88 / 135 | Verifizierter Leerbestand. Offizielle Anbieterseite als verifizierter F1. |
| 35 | Walddörfer<br>Walddörfer Immomio Tenant-API | — | — | 254/254 | 412 / 669 | 3 Rohangebote, 3 Hamburg-Wohnungen. Consent-Wrapper als Kandidat; kein zusätzlich vollständig verifizierter Fallback. |
| 36 | Fuhlsbüttel<br>Fuhlsbüttel Immomio Tenant-API | Offizielle Anbieterseite → derselbe Immomio-Tenant (aktiv) | — | 254/254 | 325 / 620 | 2 Rohangebote, 2 Hamburg-Wohnungen. Offizielle Anbieterseite als verifizierter F1. |
| 37 | Finkenwärder-Hoffnung<br>Finkenwärder öffentliche WordPress-Immo-API | — | — | 254/254 | 235 / 397 | 1 Wohnung in Seevetal, 0 in Hamburg. Typisierter Parser verhindert Übernahme fremder Orte. |
| 38 | Hanseatische Baugenossenschaft<br>Hanseatische öffentliche Angebotsseite | — | — | 254/254 | 276 / 337 | Explizite Leerstandsmeldung im Prüfstand. Positive Wohnungsantwort und unabhängiger Zweitzugang derzeit nicht prüfbar. |
| 39 | mgf Gartenstadt Farmsen<br>mgf Immomio Tenant-API | — | — | 254/254 | 316 / 457 | 4 Rohangebote, 0 passende Hamburg-Wohnungen. Keine zweite unabhängige Bestandsanbindung verifiziert. |
| 40 | Schiffszimmerer<br>Schiffszimmerer öffentliche Suche / verifizierte Spiegel | — | — | 253/253 | 196 / 216 | Öffentliche Anmeldung; Angebote ggf. über Quelle 1/3. Interne Bewerber-/Mitgliederangebote nicht als öffentlicher Feed verfügbar. |
| 41 | Süderelbe<br>Süderelbe öffentliche Angebotsseite | — | — | 254/254 | 311 / 395 | Explizit keine Angebote. Positiver Wohnungsfall und unabhängiger Zweitzugang derzeit nicht prüfbar. |
| 42 | Lehrerbau<br>Lehrerbau öffentliches Scout-Anbieterportal | — | — | 254/254 | 1056 / 1275 | Derzeit 0 Angebote. Positiver Parserfall nicht mit aktuellem Wohnungsobjekt belegt. |
| 43 | Gartenstadt Wandsbek<br>Gartenstadt Wandsbek ImmoSolve/HPM | — | — | 254/254 | 184 / 284 | Verifizierter Leerbestand. Legacy-Route, kein separat verifizierter Fallback. |
| 44 | Gartenstadt Hamburg<br>Gartenstadt Hamburg öffentliche Seite / Spiegel | — | — | 253/253 | 695 / 812 | Anmeldung; verifizierte Spiegel gegebenenfalls Quelle 1/3. Kein öffentlicher vollständiger Mitgliederbestand. |
| 45 | FLUWOG-NORDMARK<br>FLUWOG öffentliche Seite / Spiegel | — | — | 253/253 | 241 / 265 | Anmeldung; verifizierte Spiegel gegebenenfalls Quelle 1/3. Kein öffentlicher vollständiger Mitgliederbestand. |
| 46 | Wohnungsverein Hamburg von 1902<br>Wohnungsverein 1902 Angebotsseite | — | — | 252/254 | 551 / 641 | Explizit keine Angebote. Positiver Wohnungsfall und unabhängiger Zweitzugang derzeit nicht prüfbar. |
| 47 | Wohnungsunternehmen Fiefstuecken<br>Fiefstuecken ImmoSolve/HPM | — | — | 247/254 | 1006 / 1443 | 7 Rohangebote, 1 Hamburg-Wohnung. Zusätzliche HTML-Slots werden nicht als native Failover ausgeführt; als Diagnose korrigiert. |
| 48 | meravis Hamburg<br>meravis nativer Feed | — | — | 254/254 | 881 / 1083 | 1 unveränderter Kandidat im Prüfstand. Alte Wrapper/HTML-Slots nicht als unabhängiger Fallback qualifiziert. |
| 49 | Smartments Hamburg<br>Kein Verfügbarkeitsfeed; Smartments Standortseite | — | — | 191/191 | 2132 / 2672 | Standort-/Hotelkarten sind keine bestätigten verfügbaren Wohnungen. Falschen Bestandskandidaten deaktiviert; Shadow bis qualifizierter Verfügbarkeitsschnittstelle. |
| 50 | Urban Living Hamburg<br>Urban Living native Wohnungsstatus-Karten | — | — | 254/254 | 1617 / 1742 | 327 Einheiten: 321 vermietet, 6 reserviert, 0 frei. Nur explizit freie Einheiten werden Wohnungen; identische Mobilkarten dedupliziert. |
| 51 | Felixx student Hamburg<br>Kein Angebotsfeed; Felixx/StarRez Anmeldung | — | — | 0/0 | None / None | Standorte und Bewerberportal. Shadow; keine öffentliche aktuelle Einzelwohnungsverfügbarkeit verifiziert. |
| 52 | Wichern Baugesellschaft<br>Wichern öffentliche Vermietungsseite | — | — | 445/445 | 1007 / 2065 | 1 Tiefgaragenangebot, 0 Wohnungen. Positiver Wohnungsparser und unabhängiger Zweitzugang nicht belegt. |
| 53 | KOLPING<br>Kolping öffentliche Bestandsseite | — | — | 254/254 | 492 / 637 | Wohnungsbestand ohne verifizierte aktuelle Einzelangebote. Erreichbarkeit allein bestätigt keine freie Wohnung. |
| 54 | HSG Wohnen<br>Kein Angebotsfeed; HSG öffentliche Seiten | — | — | 0/0 | None / None | 9 WordPress-Seiten, keine verifizierte Angebots-API. Shadow; Wohnanlagen sind kein aktueller Einzelwohnungsbestand. |
| 55 | WG von 1904<br>WG 1904 öffentliche Suche / Spiegel | — | — | 253/253 | 548 / 683 | Registrierung; verifizierte Spiegel gegebenenfalls Quelle 1/3. Kein öffentlicher vollständiger Bewerberbestand. |
| 56 | WHW 1897<br>Kein Angebotsfeed; WHW öffentliche Seite | — | — | 0/0 | None / None | Registrierung/Interessenten. Shadow; doppelte HTML-Anbindungen sind keine Fallbacks. |
| 57 | WGPV<br>Kein Angebotsfeed; WGPV öffentliche Seite | — | — | 0/0 | None / None | Kein externer Mitgliederbestand. Shadow; kein qualifizierter Einzelwohnungszugang. |
| 58 | Wohnreform eG<br>Wohnreform öffentliche Seite | — | — | 254/254 | 318 / 440 | Explizit keine Wohnungsangebote. Positiver Wohnungsfall und unabhängiger Zweitzugang nicht belegt. |
| 59 | Wohnwarft eG<br>Kein qualifizierter Connector; Wohnwarft | — | — | 0/0 | None / None | HTTP 502 im Prüfstand. Shadow; kein bestätigter alternativer Angebotsfeed. |
| 60 | Baugenossenschaft der Buchdrucker<br>Kein Angebotsfeed; Buchdrucker Immomio-Anmeldung | — | — | 191/191 | 929 / 1638 | Registrierungsportal ohne verifizierten Bestand. Prioritäten bereinigt; falsche RSS/Atom-Annahme entfernt, Shadow. |
| 61 | dhu<br>dhu ImmoSolve/HPM | — | — | 254/254 | 284 / 359 | Verifizierter Leerbestand. Keine zweite unabhängige Bestandsanbindung verifiziert. |
| 62 | DVG Immobilien<br>Kein Angebotsfeed; DVG/Alco Login | — | — | 0/0 | None / None | Öffentlicher Zugang endet am Login. Shadow; keine Freigabe für Bewerber-/Verwalterdaten vorhanden. |
| 63 | Wohnungsbörse.net Hamburg<br>Kein unabhängiger Feed; Wohnungsbörse Weiterleitung | — | — | 0/0 | None / None | Weiterleitung zu Scout ohne eigenen verifizierten Bestand. Shadow; kein zusätzlicher Coverage-Gewinn belegt. |
| 64 | Falkenried-Terrassen<br>Kein unterstützter Connector; Falkenried | — | — | 0/0 | None / None | Öffentliche Information ohne Angebotsfeed. Shadow; keine funktionsfähige Bestandsanbindung nachgewiesen. |
| 65 | BDS Dennerstraße-Selbsthilfe<br>BDS Immomio Tenant-API | Offizielle Anbieterseite → derselbe Immomio-Tenant (aktiv) | — | 254/254 | 96 / 181 | Verifizierter Leerbestand. Offizielle Anbieterseite als verifizierter F1. |

## Reproduzierbare Implementierung

Konfiguration: `scripts/align-audited-connectors.sql` (bereits produktiv angewendet). Tests: `npm test`; Snapshot-Abgleich: `node scripts/check-runtime.mjs`. Öffentliche eingebettete Tenant-Tokens, personenbezogene Zustellempfänger und vollständige fremde HTML-Seiten sind absichtlich nicht in diesen Auditdateien enthalten.
