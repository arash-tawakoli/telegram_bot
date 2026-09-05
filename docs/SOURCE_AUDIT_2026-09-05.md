# Quellenprüfung: 65 Quellen und Telegram-Zustellung

Stand: 5. September 2026. Bestandsaufnahme ca. 07:55 UTC, Versandstörung nachgeprüft um 12:29–12:33 UTC. Dies ist ein Prüfbericht, keine Behauptung vollständiger Marktdeckung.

## Ergebnis

- 65 Quellen konfiguriert, 54 live und 11 shadow. Shadow-Quellen erzeugen keine regulären Zustellungen.
- Beim ersten 24h-Abgleich: 413 als gesendet bestätigte Ereignisse aus sieben Quellen; 372 davon (90 %) aus Kleinanzeigen, Immowelt und ImmoScout. Ereignisse zählen Empfänger/Profile, nicht einzigartige Wohnungen und nicht nur den anfragenden Nutzer.
- Um 12:29 UTC waren 91 Ereignisse pending; letzte Bestätigung 07:32 UTC. Ursache: `owner`-Variable des Profils überschattete die Dispatcher-Lease-UUID und löste vor dem Claim einen ReferenceError aus. Korrektur in Dispatcher v30; um 12:33 UTC fünf neue echte Versandbestätigungen, Queue 86. Ein vollständiger Handler-Regressionstest deckt den Fehler ab. Der Fehler wurde mit dem Architektur-Rollout eingeführt; ein Dry-run allein hatte ihn nicht erfasst.
- Erfolgreicher HTTP-Aufruf ist kein Beleg für vollständiges Inventar. Leere generische Parser, Parserfallbacks auf derselben URL und persönlich vermittelte Wohnungen müssen getrennt bewertet werden.
- Neue Datenbankzeilen sind nicht zwingend neue Inserate: 86 Spacest-Zeilen gehörten zur Baseline. Im späteren Vierstundenfenster keine neue Spacest-ID. Wohnungsswap-Fallback enthält Veröffentlichungen vor der Baseline. Solche Altbestände bleiben zu Recht von neuen Telegram-Meldungen ausgeschlossen.

## Prioritäten

1. Versand wiederherstellen und echte Telegram-message_id/DB-Bestätigung prüfen (v30 umgesetzt).
2. Registry und effektiven Codepfad angleichen: ImmoScout führt MCP statt Yahoo aus; spezielle ImmoMio/HPM-Adapter führen generische Fallbacks nicht automatisch aus.
3. Heimstaden, Nestpick, Smartments und Urban Living: `duplicate_target`-Fallbacks durch tatsächlich andere Transport-/Datenpfade ersetzen, sobald verifiziert.
4. TAG, Schiffszimmerer und weitere generische Leerquellen: strukturierte Daten bzw. legitime öffentliche Tenant-Feeds prüfen; Parserleerstand nicht als bestätigten Nullbestand melden.
5. Für SAGA/Immomio-Anbieter eine autorisierte, nutzergebundene Angebotsanbindung prüfen. Private Bewerberangebote niemals an sämtliche Bot-Nutzer verteilen.
6. Unabhängiger Eingang für eigene Suchauftrag-E-Mails als Fallback bei Kleinanzeigen/Immowelt. Benötigt gesonderte Freigabe, beschränktes Postfach/Label und passende Nutzungsrechte; wurde nicht eingerichtet.

## Quellenliste

Neu/24h = neu angelegte Datenbankzeilen in der ersten Abfrage, nicht zugesicherte frische Angebote. Fetched-Werte werden nicht als einzigartige Inventargröße verwendet. Die Empfehlung unterscheidet verifizierte Befunde von noch zu prüfenden Alternativen. Ein Webseitenlink belegt keine öffentliche API-Freigabe.

| ID | Quelle | Modus | Aktiver Primärpfad laut Registry | Neu/24h | Empfehlung |
|---:|---|---|---|---:|---|
| 1 | [ImmobilienScout24 Hamburg](https://www.immobilienscout24.de) | live | **Effektiv MCP; Registry veraltet** | 64 | MCP beibehalten; Registry auf den tatsächlich ausgeführten Adapter korrigieren. Autorisierte Search-API nur mit passender Freigabe; Yahoo/Bing sind derzeit keine ausgeführten Fallbacks. |
| 2 | [Kleinanzeigen Hamburg](https://www.kleinanzeigen.de) | live | Kleinanzeigen 7-district hybrid coverage | 183 | Bezirksadapter beibehalten; Fehlseiten pro Bezirk sichtbar machen. Eigene Suchauftrag-E-Mails als unabhängiger Fallback möglich, mit gesonderter Postfachfreigabe. |
| 3 | [Immowelt Hamburg](https://www.immowelt.de) | live | Public Search | 94 | Suchseiten/Sitemap beibehalten; Sättigung und Freshness zwischen Worker und SQL angleichen. Suchassistent-E-Mails als zweiter Transport, keine zusätzliche Anbieterquelle. |
| 4 | [SAGA](https://www.saga.hamburg) | live | SAGA filtered public provider index fallback | 1 | Hohe Priorität: Index ist lückenhaft, Direktprobe HTTP 401. Offiziellen öffentlichen Feed/Immomio-Zugang anfragen; persönliche Immomio-Angebote nur nutzergebunden importieren. Kein Schutz-Bypass. |
| 5 | [Vonovia Hamburg](https://www.vonovia.de) | live | Vonovia Immowelt Transport | 0 | Direkte Vonovia-Suche als Primärkandidat verifizieren; heutigen Immowelt-Spiegel als Fallback behalten. Fünf von sechs historischen Listings sind nicht primär: Mehr Spiegel bedeutet nicht mehr einzigartige Wohnungen. |
| 6 | [WG-Gesucht Hamburg](https://www.wg-gesucht.de) | live | Public Search | 6 | Beibehalten. Pagination und aktuelle Sortierung mit Seitenfixtures prüfen; die zwei JSON-LD-Fallbacks sind keine unabhängigen Datenquellen. |
| 7 | [TAG Wohnen Hamburg](https://tag-wohnen.de) | live | Hamburg City Bucket | 0 | Hohe Prüfpriorität: tenant_api heißt hier tatsächlich HTML, 139 leere erfolgreiche Läufe. Strukturierte Daten hinter offizieller Suche und Hamburg-Filter verifizieren; Freigabe für Feed anfragen. |
| 8 | [Grand City Property Hamburg](https://www.grandcityproperty.de) | live | GCP Hamburg official search (Primary) | 1 | Worker v50: neue, auf der Detailseite geprüfte Wohnungs-IDs aus Empfehlungen nach eigener Fallback-Baseline zustellbar. Bestehende IDs bleiben gesperrt; vermietete Objekte und Gewerbe werden weiterhin verworfen. Portalspiegel liefern unabhängig über Quelle 1. |
| 9 | [HousingAnywhere Hamburg](https://housinganywhere.com) | live | HousingAnywhere verified native-new feed (Primary) | 1 | Neue Detail-Feeds liefern derzeit keine neuen akzeptierten IDs. Freshness-Marker bis zur DB testen; keine alten indexierten Zeilen nachträglich zu neuen machen. Autorisierter Partnerfeed als Alternative zu HTML. |
| 10 | [Wunderflats Hamburg](https://wunderflats.com) | live | Öffentliche Hamburg-Suchseite | 11 | Beibehalten; Pagination-Detektor meldet nur eine Seite mit 32 Ergebnissen. Vollständigkeit über Cursor/Seitendaten testen. Mietpreis und Möblierungsfilter erklären mögliche Nichtzustellung. |
| 11 | [Heimstaden Hamburg](https://heimstaden.com/de/) | live | Offizielle Hamburg-Listingseite | 0 | Hohe Priorität: Beide Portal-Fallbacks sind duplicate_target derselben HTML-Seite. Tatsächliche getrennte Anbieter-Portal-URLs oder autorisierten Eigentümerfeed verwenden; leere HTML-Antwort nicht als Inventarbeweis werten. |
| 12 | [Ohne-Makler.net Hamburg](https://www.ohne-makler.net) | live | Ohne-Makler verified new-ID feed (Primary) | 4 | Detail-/New-ID-Feed beibehalten, vierseitiges Abruflimit und 25-Detail-Limit prüfen. ID-Schwelle beweist allein kein Veröffentlichungsdatum. Eigene HTML-Suche als getrennte Bestandslane, nicht alte Treffer aussenden. |
| 13 | [Homelike / Spacest Hamburg](https://www.thehomelike.com) | live | Spacest Hamburg public API feed (Primary) | 86 | Spacest-API beibehalten. 86 neue DB-Zeilen stammen aus Baseline; seither keine neuen IDs im geprüften Vierstundenfenster. Homelike separat auf zusätzliche eindeutige IDs prüfen; nicht identische Anbieterbestände doppelt zählen. |
| 14 | [meinestadt.de Hamburg](https://www.meinestadt.de) | shadow | meinestadt partner mirror monitor | 0 | Shadow belassen: Direkttransport nicht bestätigt. Partnerbestand mit Immowelt vergleichen; nur nachgewiesene zusätzliche private Listings rechtfertigen neuen Primäradapter. |
| 15 | [immobilien.de Hamburg](https://www.immobilien.de) | live | immobilien.de Full Snapshot Transport | 4 | Transport beibehalten; Fallback-Ausführung und unveränderliche Freshness erklären. Alte Zeilen nicht neu freischalten. Vollsnapshot vs. Pagination auf ID-Abdeckung vergleichen. |
| 16 | [immobilie1 Hamburg](https://www.immobilie1.de) | live | immobilie1 Full Snapshot Transport | 11 | Beibehalten: Tatsächliche Zustellungen vorhanden. Direkte öffentlich zugängliche Suchdaten als Transportfallback erst nach Paritätstest aktivieren. |
| 17 | [City-Wohnen Hamburg](https://www.city-wohnen.de/) | live | JSON-LD | 5 | Beibehalten; JSON-LD und HTML als Parserfallback dokumentieren. Preis/Möblierung und Profilabgleich prüfen, bevor Connector ersetzt wird. |
| 18 | [Studierendenwerk Hamburg](https://www.stwhh.de) | shadow | Wohnanlagen-Verzeichnis | 0 | Shadow: Verzeichnis/Bewerbung ist kein bestätigter Live-Angebotsfeed. Offiziellen Verfügbarkeitsfeed oder persönliche Angebotsbenachrichtigung nur mit Einwilligung anbinden. |
| 19 | [Nestpick Hamburg](https://www.nestpick.com) | live | Rendered Public Search | 0 | Hohe Prüfpriorität: Drei Renderer-Namen verwenden denselben HTML-Abruf; kein Browser-Rendering. Öffentliche strukturierte Suchdaten oder erlaubten Partnerfeed prüfen, tatsächlichen Zusatzbestand messen. |
| 20 | [Covivio Hamburg](https://www.covivio.immo) | live | Covivio official object sitemap (Primary) | 1 | Offizielle Sitemap bevorzugen; Indexfallback liefert gefundenes Altangebot ohne lastmod. Nur bestätigte neue Veröffentlichungen zustellen; lastmod allein kann auch Bearbeitung bedeuten. |
| 21 | [Tauschwohnung.com Hamburg](https://www.tauschwohnung.com/) | live | Public Hamburg Search | 0 | Pagination vorhanden, Freshness unverified. Veröffentlichungsdatum oder vollständigen stabilen Baseline-Vergleich implementieren; nur Suchprofile mit Wohnungstausch bedienen. |
| 22 | [Wohnungsswap.de Hamburg](https://wohnungsswap.de) | live | Wohnungsswap official normalized feed (Primary) | 15 | Feed findet alte Veröffentlichungen, nicht automatisch neue Angebote. Datumsprüfung beibehalten; aktuelle direkte Ergebnissuche als Primärkandidat prüfen, Index nur Discovery. |
| 23 | [Hamburger Wohnen](https://www.hamburgerwohnen.de) | live | Immomio Tenant GraphQL | 0 | Immomio beibehalten; öffentliche Angebote und persönliche Matches unterscheiden. HTML-Tenant-Frontend als Paritäts-/Fehlerdiagnose, nicht mehr Bestand versprechen. |
| 24 | [Bergedorf-Bille](https://www.bergedorf-bille.de) | live | ImmoSolve HPM REST | 0 | ImmoSolve beibehalten; letzter Lauf enumeriert neun Einträge, aber keine akzeptierte Wohnung. Objektart/Ort-Ausschlüsse prüfen; nicht pauschal Parserfehler behaupten. |
| 25 | [BVE](https://www.bve.de) | live | BVE Umbraco Wohnungsangebote API | 0 | BVE-Umbraco-API beibehalten; leere Antwort gegen offizielle Angebotsseite/Schema prüfen. Kein Ersatz ohne Gegenbeleg. |
| 26 | [altoba](https://www.altoba.de) | live | ImmoSolve HPM REST | 0 | ImmoSolve beibehalten: letzter Lauf enumeriert null. Öffentliche Angebotsseite als Kontrollprobe; persönliche Vergabe bleibt außerhalb des öffentlichen Feeds. |
| 27 | [HANSA](https://hansa-wohnen.de) | live | ImmoSolve HPM REST | 0 | ImmoSolve beibehalten: letzter Lauf enumeriert null. Öffentliche Angebotsseite als Kontrollprobe; keinen künstlichen Mehrbestand erzeugen. |
| 28 | [BGFG](https://www.bgfg.de) | live | Immomio Tenant GraphQL | 0 | Immomio beibehalten; sechs Rohobjekte, null akzeptierte Wohnungen: Ausschlussgründe für Typ/Ort/Mietdaten protokollieren. |
| 29 | [VHW](https://www.vhw-hamburg.de) | live | Immomio Tenant GraphQL | 0 | Immomio beibehalten; vier akzeptierte Angebote aus sieben Rohobjekten. Keine neuen IDs im 24h-Fenster. |
| 30 | [HARABAU](https://www.harabau.de) | live | Immomio Tenant GraphQL | 0 | Immomio beibehalten; sechs akzeptierte Angebote aus acht Rohobjekten. Kein belegter Bedarf für Connectorwechsel. |
| 31 | [GWG-Gruppe Hamburg](https://gwg-gruppe.de) | shadow | GWG provider portal monitor | 0 | Shadow: Transport/TLS nicht bestätigt. Offiziellen Anbieterfeed oder verifizierte Portalzuordnung prüfen; TLS-Prüfung nicht abschalten. |
| 32 | [EBV Harburg](https://www.ebv-harburg.de) | live | Immomio Tenant GraphQL | 0 | Immomio beibehalten; drei akzeptierte aus sechs Rohobjekten. Öffentliche Frontend-Kontrolle sinnvoll, kein neuer Primärconnector nötig. |
| 33 | [KAIFU-NORDLAND](https://kaifu.de) | live | REST /api/property-supply/all | 0 | REST beibehalten; Objektart-/Schema-Test bei Nullergebnis und getrenntes Fallbackziel prüfen. |
| 34 | [Bauverein Reiherstieg](https://www.reiherstieg.de) | live | Immomio Tenant GraphQL | 0 | Immomio beibehalten: aktuell null Rohobjekte. Registrierungs-/Angebotsseite nur als Kontrollprobe. |
| 35 | [Walddörfer](https://www.walddoerfer.de) | live | Immomio Tenant GraphQL | 1 | Immomio beibehalten: neue ID und echte Zustellungen nachgewiesen. |
| 36 | [Fuhlsbüttel](https://www.bg-fuhlsbuettel.de) | live | Immomio Tenant GraphQL | 0 | Immomio beibehalten: zwei aktuelle Angebote, keine neue ID. Profilmatching statt Transportwechsel prüfen. |
| 37 | [Finkenwärder-Hoffnung](https://fwheg.de) | live | Finkenwaerder REST API | 0 | REST beibehalten: aktuell keine akzeptierten Angebote. Kontrollabgleich mit offiziellem Frontend. |
| 38 | [Hanseatische Baugenossenschaft](https://www.hanseatische.de) | live | Hanseatische öffentliche Wohnungsangebote | 0 | Öffentliche Angebotsseite beibehalten; explizite Keine-Angebote-Meldung von Parserleerstand unterscheiden. Kein konkreter besserer Feed bestätigt. |
| 39 | [mgf Gartenstadt Farmsen](https://www.mgf-farmsen.de) | live | Immomio Tenant GraphQL | 0 | Immomio beibehalten; vier Rohobjekte, null akzeptierte Wohnungen: Ausschlüsse erklären. |
| 40 | [Schiffszimmerer](https://www.schiffszimmerer.de) | live | Schiffszimmerer Suchfrontend | 0 | Suchfrontend ist unvollständig und liefert null. Eingebetteten offiziellen Datenfeed verifizieren; Portalzuordnung nur mit Eigentümernachweis, persönliche Angebote getrennt. |
| 41 | [Süderelbe](https://www.baugen-suederelbe.de) | live | Süderelbe aktuelle Wohnungsangebote | 0 | Öffentliche Angebotsseite beibehalten; Nullbestand durch explizite Leermeldung bestätigen. Kein konkreter besserer Feed bestätigt. |
| 42 | [Lehrerbau](https://www.lehrerbau.de) | live | Lehrerbau ImmoScout Partner-Ergebnisliste | 0 | Anbieter-Ergebnisliste beibehalten; unabhängiger offizieller Feed wäre besserer Fallback als weiterer ImmoScout-Aufruf. Zugang/Bestand unbestätigt. |
| 43 | [Gartenstadt Wandsbek](https://www.gartenstadt-wandsbek.de) | live | ImmoSolve HPM REST | 0 | ImmoSolve beibehalten: null Rohobjekte. HTTP 200 im Shadow-Test bestätigt nur Erreichbarkeit. |
| 44 | [Gartenstadt Hamburg](https://www.gartenstadt-hamburg.de) | live | Offizielle Immomio-Registrierungsseite | 0 | Registrierungsseite ist kein Bestandsconnector. Offiziellen öffentlichen Immomio-Tenant prüfen; sonst persönliche Angebote nur mit nutzergebundener Freigabe. |
| 45 | [FLUWOG-NORDMARK](https://www.fluwog.de) | live | Offizielle Immomio-Registrierungsseite | 0 | Offizielle Website bestätigt Immomio-Vergabe. Öffentlichen Tenant oder autorisierten Feed prüfen; Registrierung allein enumeriert keine Wohnungen. |
| 46 | [Wohnungsverein Hamburg von 1902](https://wv1902.de) | live | WV1902 öffentliche Wohnungsangebote | 0 | Öffentliche Angebotsseite beibehalten; leeres Ergebnis separat verifizieren. Kein belegter Mehrwert eines zusätzlichen generischen Parsers. |
| 47 | [Wohnungsunternehmen Fiefstuecken](https://www.fiefstuecken.de) | live | ImmoSolve HPM Mandant 2205841 | 0 | ImmoSolve beibehalten; sieben Rohobjekte, eine akzeptierte Wohnung. Konfigurierte HTML/DWR-Fallbacks werden vom spezialisierten Adapter nicht ausgeführt: expliziten Fallbackpfad nur nach Test ergänzen. |
| 48 | [meravis Hamburg](https://www.meravis.de) | live | meravis official Hamburg card feed (Primary) | 1 | Meravis-Feed beibehalten; einzige neue DB-Zeile stammt aus Baseline. Neue echte IDs nach Baseline testen; derzeit kein belegter Verlust durch fehlenden Fallback. |
| 49 | [Smartments Hamburg](https://smartments.com/de/) | live | Hamburg Availability Page | 0 | Doppelte HTML-Ziele ersetzen. Öffentliche datumsspezifische Buchungsverfügbarkeit als Primärkandidat; Standortseite ist keine freie Wohnung. |
| 50 | [Urban Living Hamburg](https://www.urban-living-hamburg.de) | live | Öffentliche Mietseite | 0 | Doppelte HTML-Ziele ersetzen. Echte Unit-/Datumsverfügbarkeit aus offiziellem Buchungssystem prüfen; kein bestätigter zusätzlicher Endpoint. |
| 51 | [Felixx student Hamburg](https://www.felixx-student.de/) | shadow | Hamburger Apartmentseite | 0 | Shadow: Bewerbungs-/StarRez-Portal erst auf öffentlich zugängliche Verfügbarkeit prüfen. Kein Login ohne Freigabe. |
| 52 | [Wichern Baugesellschaft](https://wichernbau.de/) | live | Öffentliche Vermietungsseite | 0 | Öffentliche property-Detailseiten als spezialisierter Parser; Baseline fehlt. Schema-/Leermeldungstest erforderlich, bevor Zustellbereitschaft behauptet wird. |
| 53 | [KOLPING](https://baugenossenschaft-kolping.de/) | live | KOLPING freie Wohnungen | 0 | Öffentliche Seite beibehalten; Angebotsabschnitt und expliziten Nullbestand verifizieren. Noch kein besserer unabhängiger Feed belegt. |
| 54 | [HSG Wohnen](https://www.hsg-wohnen.de) | shadow | Öffentliche Wohnanlagen-Seite | 0 | Shadow: Wohnanlagen-/WordPress-Seiten sind kein Verfügbarkeitsbeweis. Nur echte Mietobjekt-Collection statt allgemeiner pages-API anbinden. |
| 55 | [WG von 1904](https://www.1904.de) | live | Offizielle Immomio-Registrierungsseite | 0 | Immomio-Registrierungsseite ist kein Inventar. Öffentlicher Tenant/Partnerfeed oder persönliche Angebote mit Einwilligung; kein pauschales HTML-Upgrade. |
| 56 | [WHW 1897](https://www.whw1897.de) | shadow | HTML-/DOM-Parsing | 0 | Shadow: Bewerberseite liefert keinen bestätigten Bestand. Direkte Kooperation/öffentlicher Angebotsfeed als bedingte Alternative. |
| 57 | [WGPV](https://www.wgpv.de) | shadow | Gästewohnungs-Seite | 0 | Shadow: Gästewohnungen nicht als normale Mietwohnungen zählen. Passenden langfristigen Angebotsbereich erst nachweisen. |
| 58 | [Wohnreform eG](https://www.wohnreform-eg.de/) | live | Autoritative Wohnreform Verfügbarkeitsseite | 0 | Öffentliche Verfügbarkeitsseite beibehalten. Kein belegter Ersatz; Nullbestand nicht durch alte Indexfunde auffüllen. |
| 59 | [Wohnwarft eG](https://wohnwarft.de/) | shadow | Öffentliche Website | 0 | Shadow: Transport unbestätigt und kein digitales Inventar nachgewiesen. Offizielle Kontakt-/Feedfreigabe nötig. |
| 60 | [Baugenossenschaft der Buchdrucker](https://www.buchdrucker.de) | live | Immomio HP Modul | 0 | Aktiver Primärconnector steht auf Priorität 3, RSS/Atom deaktiviert. Registry ordnen; Immomio-Inventar erhalten, RSS nur aktivieren, wenn tatsächlich aktuelle Objekte liefert. |
| 61 | [dhu](https://www.dhu.hamburg) | live | ImmoSolve HPM REST | 0 | ImmoSolve beibehalten: null Rohobjekte. Keine weitere Quelle durch denselben HPM-HTML-Wrapper. |
| 62 | [DVG Immobilien](https://www.dvgimmobilien.de/) | shadow | DVG Public Frontend | 0 | Shadow: Website erreichbar, keine bestätigten Listings. Öffentliche Exposé-Collection/Feed identifizieren; allgemeines Web-Scraping ist keine konkrete Alternative. |
| 63 | [Wohnungsbörse.net Hamburg](https://www.wohnungsboerse.net) | shadow | Public Search | 0 | Shadow belassen: konfigurierte Such-URL leitet beim Webabruf zu ImmoScout um; Produktionsprobe HTTP 401. Kein belegter unabhängiger Zusatzbestand. |
| 64 | [Falkenried-Terrassen](https://www.falkenried-terrassen.de) | shadow | Keiner | 0 | Shadow belassen: kein bestätigter digitaler Wohnungsfeed. Website-HTTP-200 ist kein funktionsfähiger Connector. |
| 65 | [BDS Dennerstraße-Selbsthilfe](https://www.bds-hamburg.de) | live | Immomio Tenant GraphQL | 0 | Immomio beibehalten: aktuell null Rohobjekte. Persönliche Bewerberangebote getrennt; kein belegter besserer öffentlicher Connector. |

## Extern belegte Alternativen und Grenzen

- [SAGA Wohnungssuche](https://www.saga.hamburg/immobiliensuche/Tipps/ihr-weg-in-ihr-neues-zuhause): Registrierung über Immomio. Persönliche Vergabe ist nicht gleich öffentlicher Gesamtbestand.
- [ImmoScout Search](https://api.immobilienscout24.de/api-docs/tutorials/search/) und [API-Freigabe](https://api.immobilienscout24.de/more/api-permission-request/): dokumentierte Suche, aber Nutzung/Berechtigung für diesen Bot nicht bestätigt. [Exposé-API](https://api.immobilienscout24.de/api-docs/expose/overview/) nennt ausdrücklich Content-Partner-Einschränkungen; kein sofort aktivierbarer Ersatz.
- [Vonovia Direkt-Suche](https://www.vonovia.de/zuhause-finden): eigener Suchweg bestätigt; ein für den Bot freigegebener stabiler Datenfeed noch nicht.
- [Heimstaden Hamburg](https://heimstaden.com/de/immobiliensuche/wohnung-hamburg/): offizielle Ausgangsseite; die konfigurierten Fallbacks sind kein zweiter Transport.
- [FLUWOG Wohnungssuche](https://www.fluwog.de/wohnen/wohnungssuche/): Immomio bestätigt; nicht automatisch ein anonymes Angebots-API.
- [Kleinanzeigen Suchaufträge](https://hilfe.kleinanzeigen.de/hc/de/articles/17102975598492-Ich-m%C3%B6chte-automatisch-neue-Suchergebnisse-zu-meiner-Suche-erhalten-Wie-richte-ich-das-ein) und [Immowelt Suchassistent](https://www.immowelt.de/suchassistent): eigene E-Mail-Benachrichtigungen als Kandidat für getrennten Eingang.
- Wohnungsbörse: der Abruf der konfigurierten URL https://www.wohnungsboerse.net/Hamburg/mieten/wohnungen leitete zur ImmoScout-Startseite. Suchindex-Treffer älterer Unterseiten sind kein Beleg aktueller separater Enumeration.

## Abnahmekriterien für jeden neuen Connector

Bekannte Angebots-ID korrekt erkennen; belegten Nullbestand von Parsefehler trennen; Seiten-/Cursorgrenzen dokumentieren; stabile IDs, Ort, Wohnungsart, Mietpreis und Datum prüfen; Baseline ohne Benachrichtigungsflut; neue synthetische ID nach Baseline durch Matching testen; Fallback mit absichtlich fehlgeschlagenem Primärpfad prüfen; keine Zugangssperren umgehen. Erst danach live. Mengensteigerungen dürfen erst nach Messung einzigartiger, aktueller und tatsächlich profilpassender Listings behauptet werden.


## Nachprüfung und Korrektur am Abend

Worker v50 korrigiert die bislang pauschal ausgeschlossene GCP-Empfehlungsspur. Die URL der erfolgreichen Fallback-Baseline wird dauerhaft gespeichert; ein URL-Wechsel beginnt erneut ohne Versand des Erstbestands. Fehlende Zahlenwerte können keine falschen Nullwert-Spiegeltreffer mehr erzeugen. Shadow-Anbindungen werden nicht versehentlich ausgeführt. Detailfehler werden ausgewiesen; zwischengespeicherte Portalspiegel verdecken keinen vollständigen Ausfall beider direkten Pfade.

Im gemeinsamen HTML-/JSON-Adapter werden elf zuvor ungeprüfte Datenbankzugriffe geprüft. Ein Fehler beim Lesen der Freshness oder beim Schreiben des Crawl-Fortschritts bricht den Lauf sichtbar ab. Die beiden bearbeiteten Adapter sind jetzt lesbar formatiert. Die frühere Queue-/Dispatcher-/UI-Bereinigung bleibt Bestandteil von PR #11.

Kontrolle vor v50: alle 54 Live-Quellen hatten aktuelle erfolgreiche Läufe, allerdings teilweise ohne erkannte Wohnungen. Das ist keine Bestätigung vollständiger Erfassung. Im 24-Stundenfenster waren 292 Zustellereignisse als gesendet gespeichert; es gab keine offenen pending/processing/retry-Ereignisse. Diese Zahlen gelten für den gesamten Bot.

Nicht umgesetzt sind unbestätigte private APIs, neue Postfacheingänge und Anbieterfeeds ohne bereitgestellten Zugang. Die Empfehlungen in der Tabelle bleiben insoweit offene Erweiterungsmöglichkeiten. Elf Shadow-Quellen bleiben außerhalb des Live-Versands. Es wäre falsch, dafür eine funktionierende Zustellung zu behaupten.
