# ImmoMio-Prüfung aller 32 Baugenossenschaften – 08.09.2026

## Ergebnis

- 10 direkte ImmoMio-Angebotsanbindungen: erfolgreich aus Supabase geprüft. Alle sind bereits aktiv, live und mit Priorität 1 eingerichtet; sie werden weiter verwendet.
- 7 weitere Quellen: ImmoMio-Registrierungsportal gefunden, aber keine erfolgreiche öffentliche Angebotsabfrage nachgewiesen. Bestehende Konfiguration bleibt unverändert.
- 15 weitere Quellen: kein öffentlicher ImmoMio-Angebotsendpunkt in den geprüften Quellseiten gefunden; ein Connector-Smoke-Test ist ohne Endpunkt nicht ausführbar. Bestehende Konfiguration bleibt unverändert.
- Keine Connector-, Prioritäts-, Aktivierungs- oder Laufzeitänderungen erforderlich bzw. vorgenommen. Auch bisher deaktivierte/Shadow-Quellen bleiben in ihrem bisherigen Zustand.

## Methode und Grenzen

Die Prüfung umfasst sämtliche `sources` mit `source_type = Baugenossenschaft`, einschließlich deaktivierter Quellen. Pro Quelle wurden Startseite, hinterlegte Suchseite und relevante verlinkte Seiten abgerufen (maximal neun Seiten). Öffentliche ImmoMio-Einbettungen und Registrierungslinks wurden gesucht. Das ist keine Behauptung, dass außerhalb der geprüften Seiten keine private Integration existiert.

Alle zehn vorhandenen öffentlichen Homepage-GraphQL-Anbindungen wurden zusätzlich direkt aus Supabase mit der produktiven `propertyList`-Abfrage getestet: HTTP 200, keine GraphQL-Fehler, vollständige Ergebnismenge passend zu `totalElements`/`totalPages`. Die unten genannten Objektzahlen enthalten auch Stellplätze; sie sind keine Zahl verfügbarer Wohnungen. Eine explizit leere Liste ist ein erfolgreicher Schnittstellentest. Bei vorhandenen Hamburger Wohnungen wurden zusätzlich Bewerbungslinks und ein öffentlicher Tenant-Detailabruf geprüft.

Registrierungsseiten sind kein Nachweis einer auslesbaren Angebotsliste. Ihre unveränderten öffentlichen Registrierungstokens wurden testweise gegen die öffentliche Angebotsabfrage geprüft; Fehler und Timeouts sind unten ausgewiesen. Keine Anmeldung, keine Bewerbungen und keine Telegram-Nachrichten wurden ausgelöst. Die Funktionsfähigkeit der jeweils anderen Bestandsconnectoren war nicht Gegenstand dieses ImmoMio-Smoke-Tests.

## Einzelentscheidungen

| ID | Quelle / geprüfter Einstieg | ImmoMio-Smoke-Test | Weiter verwendete Konfiguration |
|---|---|---|---|
| 23 | [Hamburger Wohnen](https://www.hamburgerwohnen.de/wohnen/wohnungssuche-home.html) | BESTANDEN: HTTP 200, 4 Objekte; Supabase-Request 163789 | immomio_tenant #66; live; unverändert |
| 24 | [Bergedorf-Bille](https://2211665.hpm.immosolve.eu/#!/result-list-2) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | immosolve_api #69; live; unverändert |
| 25 | [BVE](https://www.bve.de/wohnen-beim-bve/wohnungsbestand/wohnungsangebote/) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | json_endpoint #72; live; unverändert |
| 26 | [altoba](https://2222820.hpm.immosolve.eu/?startRoute=result-list&objectIdentifier=2#!/result-list-2) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | immosolve_api #75; live; unverändert |
| 27 | [HANSA](https://hansa-wohnen.de/wohnen/unsere-wohnungen) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | immosolve_api #78; live; unverändert |
| 28 | [BGFG](https://www.bgfg.de/zuhause-finden/aktuelle-angebote) | BESTANDEN: HTTP 200, 6 Objekte; Supabase-Request 163790 | immomio_tenant #81; live; unverändert |
| 29 | [VHW](https://www.vhw-hamburg.de/wohnen/aktuelle-angebote.html) | BESTANDEN: HTTP 200, 6 Objekte; Supabase-Request 163791 | immomio_tenant #84; live; unverändert |
| 30 | [HARABAU](https://www.harabau.de/wohnen/wohnungsangebote/) | BESTANDEN: HTTP 200, 9 Objekte; Supabase-Request 163792 | immomio_tenant #87; live; unverändert |
| 32 | [EBV Harburg](https://www.ebv-harburg.de/wohnungen/wohnungsangebote/) | BESTANDEN: HTTP 200, 6 Objekte; Supabase-Request 163793 | immomio_tenant #93; live; unverändert |
| 33 | [KAIFU-NORDLAND](https://kaifu.de/wohnen/hamburg) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | json_endpoint #96; live; unverändert |
| 34 | [Bauverein Reiherstieg](https://www.reiherstieg.de/wohnungsangebote/) | BESTANDEN: HTTP 200, 0 Objekte; Supabase-Request 163794 | immomio_tenant #99; live; unverändert |
| 35 | [Walddörfer](https://www.walddoerfer.de/wohnungsangebote/aktuelle-angebote/) | BESTANDEN: HTTP 200, 2 Objekte; Supabase-Request 163795 | immomio_tenant #102; live; unverändert |
| 36 | [Fuhlsbüttel](https://www.bg-fuhlsbuettel.de/index.php?id=22) | BESTANDEN: HTTP 200, 0 Objekte; Supabase-Request 163796 | immomio_tenant #105; live; unverändert |
| 37 | [Finkenwärder-Hoffnung](https://fwheg.de/wohnungsangebote/) | NICHT BESTANDEN: Registrierung HTTP 200; Angebotsabfrage: GraphQL: ERROR_PARSING_JWT_TOKEN_L | json_endpoint #108; live; unverändert |
| 38 | [Hanseatische Baugenossenschaft](https://www.hanseatische.de/de/wohnungsangebote) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | html_discovery #111; live; unverändert |
| 39 | [mgf Gartenstadt Farmsen](https://www.mgf-farmsen.de/immobiliensuche/aktuelle-angebote-wohnungen/stellplaetze/) | BESTANDEN: HTTP 200, 4 Objekte; Supabase-Request 163797 | immomio_tenant #114; live; unverändert |
| 40 | [Schiffszimmerer](https://suche.schiffszimmerer.de/) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | html_discovery #117; live; unverändert |
| 41 | [Süderelbe](https://www.baugen-suederelbe.de/wohnungangebote/) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | html_discovery #120; live; unverändert |
| 42 | [Lehrerbau](https://www.lehrerbau.de/) | NICHT BESTANDEN: Registrierung HTTP 200; Angebotsabfrage: Timeout | html_discovery #123; live; unverändert |
| 43 | [Gartenstadt Wandsbek](https://asp2.immosolve.eu/immosolve_presentation/pub/modern/2227623/HP/immo.jsp) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | immosolve_api #126; live; unverändert |
| 44 | [Gartenstadt Hamburg](https://www.gartenstadt-hamburg.de/angebote/) | NICHT BESTANDEN: Registrierung HTTP 200; Angebotsabfrage: Timeout | html_discovery #129; live; unverändert |
| 45 | [FLUWOG-NORDMARK](https://www.fluwog.de/wohnen/wohnungssuche/) | NICHT BESTANDEN: Registrierung HTTP 200; Angebotsabfrage: Timeout | html_discovery #131; live; unverändert |
| 46 | [Wohnungsverein Hamburg von 1902](https://wv1902.de/wohnungsangebote/) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | html_discovery #133; live; unverändert |
| 53 | [KOLPING](https://baugenossenschaft-kolping.de/wohnungsbestand/#wohnungen) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | html_discovery #153; live; unverändert |
| 55 | [WG von 1904](https://www.1904.de/wohnungen/wohnungssuche) | NICHT BESTANDEN: Registrierung HTTP 200; Angebotsabfrage: GraphQL: ERROR_PARSING_JWT_TOKEN_L | html_discovery #159; live; unverändert |
| 56 | [WHW 1897](https://www.whw1897.de/) | NICHT BESTANDEN: Registrierung HTTP 200; Angebotsabfrage: Timeout | html_discovery #161; shadow / deaktiviert; unverändert |
| 58 | [Wohnreform eG](https://www.wohnreform-eg.de/) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | html_discovery #166; live; unverändert |
| 59 | [Wohnwarft eG](https://wohnwarft.de/) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | html_discovery #168; shadow / deaktiviert; unverändert |
| 60 | [Baugenossenschaft der Buchdrucker](https://buchdrucker.immomio.de/) | NICHT BESTANDEN: Registrierung Abruf nicht bestätigt; Angebotsabfrage: GraphQL: ERROR_PARSING_JWT_TOKEN_L | html_discovery #170; shadow; unverändert |
| 61 | [dhu](https://hpm2.immosolve.eu/immosolve_presentation/pub/modern/2223228/HP/immo.jsp) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | immosolve_api #173; live; unverändert |
| 64 | [Falkenried-Terrassen](https://www.falkenried-terrassen.de/) | NICHT AUSFÜHRBAR: kein öffentlicher ImmoMio-Endpunkt gefunden | unsupported #182; shadow / deaktiviert; unverändert |
| 65 | [BDS Dennerstraße-Selbsthilfe](https://www.bds-hamburg.de/unser-angebot/interessentenportal-immomio/) | BESTANDEN: HTTP 200, 0 Objekte; Supabase-Request 163798 | immomio_tenant #183; live; unverändert |

## Abrufbelege je Quelle

Fehler einzelner Webseiten sind keine Aussage über die Verfügbarkeit des gesamten Anbieters. Der lokale Timeout bei Fuhlsbüttel wird durch den erfolgreichen direkten Supabase-Test aufgelöst.

### 23 – Hamburger Wohnen

- [https://www.hamburgerwohnen.de/wohnen/wohnungssuche-home.html](https://www.hamburgerwohnen.de/wohnen/wohnungssuche-home.html): erreichbar
- [https://www.hamburgerwohnen.de](https://www.hamburgerwohnen.de): erreichbar
- [https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand.html](https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand.html): erreichbar
- [https://www.hamburgerwohnen.de/wohnen/wohnungssuche.html](https://www.hamburgerwohnen.de/wohnen/wohnungssuche.html): erreichbar
- [https://www.hamburgerwohnen.de/wohnen/besondere-wohnformen.html](https://www.hamburgerwohnen.de/wohnen/besondere-wohnformen.html): erreichbar
- [https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand.feed](https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand.feed?type=rss): erreichbar
- [https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand.feed](https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand.feed?type=atom): erreichbar
- [https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand/alsterdorf.html](https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand/alsterdorf.html): erreichbar
- [https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand/altona.html](https://www.hamburgerwohnen.de/wohnen/unser-wohnungsbestand/altona.html): erreichbar
- Öffentliche Einbettung auf der Anbieterwebsite nachgewiesen: https://www.hamburgerwohnen.de/wohnen/wohnungssuche-home.html
- Tenant-Detailtest: erfolgreich; Anbieter Baugenossenschaft Hamburger Wohnen eG

### 24 – Bergedorf-Bille

- [https://2211665.hpm.immosolve.eu/](https://2211665.hpm.immosolve.eu/): erreichbar
- [https://www.bergedorf-bille.de](https://www.bergedorf-bille.de): erreichbar
- [https://bergedorf-bille.de/wohnen/aktuelle-angebote](https://bergedorf-bille.de/wohnen/aktuelle-angebote): erreichbar
- [https://bergedorf-bille.de/wohnen/wohnungsbestand](https://bergedorf-bille.de/wohnen/wohnungsbestand): erreichbar
- [https://bergedorf-bille.de/wohnen/wohnungsbestand-online](https://bergedorf-bille.de/wohnen/wohnungsbestand-online): erreichbar
- [https://bergedorf-bille.de/wohnen/wohnen-im-alter](https://bergedorf-bille.de/wohnen/wohnen-im-alter): erreichbar
- [https://bergedorf-bille.de/wohnen/mobilitaet](https://bergedorf-bille.de/wohnen/mobilitaet): erreichbar
- [https://bergedorf-bille.de/wohnen/nachbarschaft](https://bergedorf-bille.de/wohnen/nachbarschaft): erreichbar
- [https://bergedorf-bille.de/wohnen/nachbarschaftfeste](https://bergedorf-bille.de/wohnen/nachbarschaftfeste): erreichbar

### 25 – BVE

- [https://www.bve.de/wohnen-beim-bve/wohnungsbestand/wohnungsangebote/](https://www.bve.de/wohnen-beim-bve/wohnungsbestand/wohnungsangebote/): Abruffehler: <urlopen error timed out>
- [https://www.bve.de](https://www.bve.de): erreichbar
- [https://www.bve.de/wohnen-beim-bve/wohnungsbestand/familienfreundliches-wohnen/](https://www.bve.de/wohnen-beim-bve/wohnungsbestand/familienfreundliches-wohnen/): Abruffehler: <urlopen error timed out>
- [https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/75-jahre-mechelnbusch-grosses-jubilaeum/](https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/75-jahre-mechelnbusch-grosses-jubilaeum/): erreichbar
- [https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/bm-vor-ort/](https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/bm-vor-ort/): Abruffehler: <urlopen error timed out>
- [https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/finke-geht-durchs-quartier/](https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/finke-geht-durchs-quartier/): erreichbar
- [https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/75-jahre-mechelnbusch-grosses-jubilaeum/](https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/75-jahre-mechelnbusch-grosses-jubilaeum/): Abruffehler: <urlopen error timed out>
- [https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/75-jahre-mechelnbusch-grosses-jubilaeum/](https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/75-jahre-mechelnbusch-grosses-jubilaeum/): erreichbar
- [https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/75-jahre-mechelnbusch-grosses-jubilaeum/](https://www.bve.de/bve-aktuell/2026_03/handlungsfelder/wohnen/75-jahre-mechelnbusch-grosses-jubilaeum/): Abruffehler: <urlopen error timed out>

### 26 – altoba

- [https://2222820.hpm.immosolve.eu/](https://2222820.hpm.immosolve.eu/?startRoute=result-list&objectIdentifier=2): Abruffehler: <urlopen error timed out>
- [https://www.altoba.de](https://www.altoba.de): erreichbar
- [https://altoba.de/wohnen/](https://altoba.de/wohnen/): Abruffehler: <urlopen error timed out>
- [https://altoba.de/wohnen/angebote/stellplaetze/](https://altoba.de/wohnen/angebote/stellplaetze/): erreichbar
- [https://altoba.de/wohnen/angebote/freie-gewerbeflaechen-2/](https://altoba.de/wohnen/angebote/freie-gewerbeflaechen-2/): erreichbar
- [https://altoba.de/wohnen/unsere-bauprojekte/](https://altoba.de/wohnen/unsere-bauprojekte/): erreichbar
- [https://altoba.de/wohnen/mitgliedschaft/](https://altoba.de/wohnen/mitgliedschaft/): erreichbar
- [https://altoba.de/wohnen/ueber-die-mitgliedschaft/](https://altoba.de/wohnen/ueber-die-mitgliedschaft/): Abruffehler: <urlopen error timed out>
- [http://altoba.de/wohnen/](http://altoba.de/wohnen/): Abruffehler: <urlopen error timed out>

### 27 – HANSA

- [https://hansa-wohnen.de/wohnen/unsere-wohnungen](https://hansa-wohnen.de/wohnen/unsere-wohnungen): erreichbar
- [https://hansa-wohnen.de](https://hansa-wohnen.de): erreichbar
- [https://hansa-wohnen.de/wohnen/neubauprojekte](https://hansa-wohnen.de/wohnen/neubauprojekte): erreichbar
- [https://hansa-wohnen.de/wohnen/quartiersentwicklung](https://hansa-wohnen.de/wohnen/quartiersentwicklung): erreichbar
- [https://hansa-wohnen.de/wohnen/unsere-wohnungen/wandsbek/](https://hansa-wohnen.de/wohnen/unsere-wohnungen/wandsbek/): erreichbar
- [https://hansa-wohnen.de/wohnen/unsere-wohnungen/nord/](https://hansa-wohnen.de/wohnen/unsere-wohnungen/nord/): erreichbar
- [https://hansa-wohnen.de/wohnen/unsere-wohnungen/eimsbuettel/](https://hansa-wohnen.de/wohnen/unsere-wohnungen/eimsbuettel/): erreichbar
- [https://hansa-wohnen.de/wohnen/unsere-wohnungen/altona/](https://hansa-wohnen.de/wohnen/unsere-wohnungen/altona/): erreichbar
- [https://hansa-wohnen.de/wohnen/unsere-wohnungen/mitte/](https://hansa-wohnen.de/wohnen/unsere-wohnungen/mitte/): erreichbar

### 28 – BGFG

- [https://www.bgfg.de/zuhause-finden/aktuelle-angebote](https://www.bgfg.de/zuhause-finden/aktuelle-angebote): Abruffehler: HTTP Error 404: Not Found
- [https://www.bgfg.de](https://www.bgfg.de): erreichbar
- [https://www.bgfg.de/wohnen/wohnungssuche](https://www.bgfg.de/wohnen/wohnungssuche): erreichbar
- [https://www.bgfg.de/wohnen/wohnungsangebote](https://www.bgfg.de/wohnen/wohnungsangebote): erreichbar
- [https://www.bgfg.de/wohnen/wohnanlagen](https://www.bgfg.de/wohnen/wohnanlagen): erreichbar
- [https://www.bgfg.de/wohnen/neubau-modernisierung](https://www.bgfg.de/wohnen/neubau-modernisierung): erreichbar
- [https://www.bgfg.de/wohnen/servicewohnen](https://www.bgfg.de/wohnen/servicewohnen): erreichbar
- [https://www.bgfg.de/wohnen/wohnungssuche](https://www.bgfg.de/wohnen/wohnungssuche): erreichbar
- [https://www.bgfg.de/wohnen/wohnungsangebote](https://www.bgfg.de/wohnen/wohnungsangebote): erreichbar
- Öffentliche Einbettung auf der Anbieterwebsite nachgewiesen: https://www.bgfg.de/wohnen/wohnungsangebote#main-content

### 29 – VHW

- [https://www.vhw-hamburg.de/wohnen/aktuelle-angebote.html](https://www.vhw-hamburg.de/wohnen/aktuelle-angebote.html): erreichbar
- [https://www.vhw-hamburg.de](https://www.vhw-hamburg.de): erreichbar
- Öffentliche Einbettung auf der Anbieterwebsite nachgewiesen: https://www.vhw-hamburg.de/wohnen/aktuelle-angebote.html
- Tenant-Detailtest: erfolgreich; Anbieter Vereinigte Hamburger Wohnungsbaugenossenschaft eG

### 30 – HARABAU

- [https://www.harabau.de/wohnen/wohnungsangebote/](https://www.harabau.de/wohnen/wohnungsangebote/): erreichbar
- [https://www.harabau.de](https://www.harabau.de): Abruffehler: <urlopen error timed out>
- [https://www.harabau.de/wohnen/wohnungsangebote/](https://www.harabau.de/wohnen/wohnungsangebote/): erreichbar
- [https://www.harabau.de/wohnen/](https://www.harabau.de/wohnen/): erreichbar
- [https://www.harabau.de/wohnen/wohnungsgesuch-aufgeben/](https://www.harabau.de/wohnen/wohnungsgesuch-aufgeben/): erreichbar
- [https://www.harabau.de/wohnen/stellplaetze-und-garagen/](https://www.harabau.de/wohnen/stellplaetze-und-garagen/): erreichbar
- [https://www.harabau.de/wohnen/gewerbe/](https://www.harabau.de/wohnen/gewerbe/): erreichbar
- [https://www.harabau.de/wohnen/unser-wohnbestand/](https://www.harabau.de/wohnen/unser-wohnbestand/): erreichbar
- Öffentliche Einbettung auf der Anbieterwebsite nachgewiesen: https://www.harabau.de/wohnen/wohnungsangebote/#mainContent
- Tenant-Detailtest: erfolgreich; Anbieter Hamburg-Rahlstedter Baugenossenschaft eG

### 32 – EBV Harburg

- [https://www.ebv-harburg.de/wohnungen/wohnungsangebote/](https://www.ebv-harburg.de/wohnungen/wohnungsangebote/): erreichbar
- [https://www.ebv-harburg.de](https://www.ebv-harburg.de): erreichbar
- [https://www.ebv-harburg.de/wohnungssuche/](https://www.ebv-harburg.de/wohnungssuche/): erreichbar
- Öffentliche Einbettung auf der Anbieterwebsite nachgewiesen: https://www.ebv-harburg.de/wohnungen/wohnungsangebote/
- Tenant-Detailtest: erfolgreich; Anbieter Eisenbahnbauverein Harburg eG

### 33 – KAIFU-NORDLAND

- [https://kaifu.de/wohnen/hamburg](https://kaifu.de/wohnen/hamburg): erreichbar
- [https://kaifu.de](https://kaifu.de): Abruffehler: <urlopen error timed out>
- [https://www.kaifu.de/wohnen/wohnungsbestand/](https://www.kaifu.de/wohnen/wohnungsbestand/): erreichbar
- [https://www.kaifu.de/wohnen/mietangebote/](https://www.kaifu.de/wohnen/mietangebote/): erreichbar
- [https://www.kaifu.de/wohnen/mietangebote/](https://www.kaifu.de/wohnen/mietangebote/): Abruffehler: <urlopen error timed out>
- [https://www.kaifu.de/wohnen/mietangebote/](https://www.kaifu.de/wohnen/mietangebote/): erreichbar
- [https://www.kaifu.de/wohnen/mietangebote/](https://www.kaifu.de/wohnen/mietangebote/): erreichbar
- [https://www.kaifu.de/wohnen/mietangebote/](https://www.kaifu.de/wohnen/mietangebote/): erreichbar
- [https://www.kaifu.de/wohnen/](https://www.kaifu.de/wohnen/): erreichbar

### 34 – Bauverein Reiherstieg

- [https://www.reiherstieg.de/wohnungsangebote/](https://www.reiherstieg.de/wohnungsangebote/): Abruffehler: <urlopen error timed out>
- [https://www.reiherstieg.de](https://www.reiherstieg.de): erreichbar

### 35 – Walddörfer

- [https://www.walddoerfer.de/wohnungsangebote/aktuelle-angebote/](https://www.walddoerfer.de/wohnungsangebote/aktuelle-angebote/): erreichbar
- [https://www.walddoerfer.de](https://www.walddoerfer.de): Abruffehler: <urlopen error timed out>
- [https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/](https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/): erreichbar
- [https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/ammersbek-hoisbuettel/](https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/ammersbek-hoisbuettel/): erreichbar
- [https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/bergstedt/](https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/bergstedt/): erreichbar
- [https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/buckhorn/](https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/buckhorn/): erreichbar
- [https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/horn/](https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/horn/): erreichbar
- [https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/hummelsbuettel/](https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/hummelsbuettel/): erreichbar
- [https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/poppenbuettel/](https://www.walddoerfer.de/wohnungsangebote/wohnanlagen/poppenbuettel/): erreichbar
- Tenant-Detailtest: erfolgreich; Anbieter Walddörfer Wohnungsbaugenossenschaft eG

### 36 – Fuhlsbüttel

- [https://www.bg-fuhlsbuettel.de/index.php](https://www.bg-fuhlsbuettel.de/index.php?id=22): erreichbar
- [https://www.bg-fuhlsbuettel.de](https://www.bg-fuhlsbuettel.de): erreichbar
- Öffentliche Einbettung auf der Anbieterwebsite nachgewiesen: https://www.bg-fuhlsbuettel.de/index.php?id=22

### 37 – Finkenwärder-Hoffnung

- [https://fwheg.de/wohnungsangebote/](https://fwheg.de/wohnungsangebote/): erreichbar
- [https://fwheg.de](https://fwheg.de): erreichbar
- [https://fwheg.de/wohnungsangebote/](https://fwheg.de/wohnungsangebote/): Abruffehler: <urlopen error timed out>
- [https://fwheg.de/wohnungssuche/](https://fwheg.de/wohnungssuche/): erreichbar
- [https://fwheg.de/seniorenwohnen/](https://fwheg.de/seniorenwohnen/): Abruffehler: <urlopen error timed out>
- [https://fwheg.de/wohnungssuche/](https://fwheg.de/wohnungssuche/): Abruffehler: <urlopen error timed out>

### 38 – Hanseatische Baugenossenschaft

- [https://www.hanseatische.de/de/wohnungsangebote](https://www.hanseatische.de/de/wohnungsangebote): erreichbar
- [https://www.hanseatische.de](https://www.hanseatische.de): erreichbar

### 39 – mgf Gartenstadt Farmsen

- [https://www.mgf-farmsen.de/immobiliensuche/aktuelle-angebote-wohnungen/stellplaetze/](https://www.mgf-farmsen.de/immobiliensuche/aktuelle-angebote-wohnungen/stellplaetze/): erreichbar
- [https://www.mgf-farmsen.de](https://www.mgf-farmsen.de): erreichbar
- Öffentliche Einbettung auf der Anbieterwebsite nachgewiesen: https://www.mgf-farmsen.de/immobiliensuche/aktuelle-angebote-wohnungen/stellplaetze/

### 40 – Schiffszimmerer

- [https://suche.schiffszimmerer.de/](https://suche.schiffszimmerer.de/): erreichbar
- [https://www.schiffszimmerer.de](https://www.schiffszimmerer.de): erreichbar

### 41 – Süderelbe

- [https://www.baugen-suederelbe.de/wohnungangebote/](https://www.baugen-suederelbe.de/wohnungangebote/): erreichbar
- [https://www.baugen-suederelbe.de](https://www.baugen-suederelbe.de): erreichbar
- [https://www.baugen-suederelbe.de/wohnen/](https://www.baugen-suederelbe.de/wohnen/): erreichbar

### 42 – Lehrerbau

- [https://www.lehrerbau.de/](https://www.lehrerbau.de/): erreichbar
- [https://www.lehrerbau.de](https://www.lehrerbau.de): erreichbar

### 43 – Gartenstadt Wandsbek

- [https://asp2.immosolve.eu/immosolve_presentation/pub/modern/2227623/HP/immo.jsp](https://asp2.immosolve.eu/immosolve_presentation/pub/modern/2227623/HP/immo.jsp): erreichbar
- [https://www.gartenstadt-wandsbek.de](https://www.gartenstadt-wandsbek.de): erreichbar
- [https://www.gartenstadt-wandsbek.de/wohnen/](https://www.gartenstadt-wandsbek.de/wohnen/): erreichbar
- [https://www.gartenstadt-wandsbek.de/wohnen/wohnungen/](https://www.gartenstadt-wandsbek.de/wohnen/wohnungen/): erreichbar
- [https://www.gartenstadt-wandsbek.de/wohnen/neubau-projekte/](https://www.gartenstadt-wandsbek.de/wohnen/neubau-projekte/): erreichbar
- [https://www.gartenstadt-wandsbek.de/wohnen/modernisierung-instandhaltung/](https://www.gartenstadt-wandsbek.de/wohnen/modernisierung-instandhaltung/): erreichbar
- [https://www.gartenstadt-wandsbek.de/wohnen/freie-wohnungen/](https://www.gartenstadt-wandsbek.de/wohnen/freie-wohnungen/): erreichbar
- [https://www.gartenstadt-wandsbek.de/wohnen/immobilienboersen/](https://www.gartenstadt-wandsbek.de/wohnen/immobilienboersen/): erreichbar

### 44 – Gartenstadt Hamburg

- [https://www.gartenstadt-hamburg.de/angebote/](https://www.gartenstadt-hamburg.de/angebote/): erreichbar
- [https://www.gartenstadt-hamburg.de](https://www.gartenstadt-hamburg.de): erreichbar
- [https://www.gartenstadt-hamburg.de/mehr-als-wohnen/termine-gartenstadt/](https://www.gartenstadt-hamburg.de/mehr-als-wohnen/termine-gartenstadt/): erreichbar
- [https://www.gartenstadt-hamburg.de/mehr-als-wohnen/berner-schloss/infos-und-bilder/](https://www.gartenstadt-hamburg.de/mehr-als-wohnen/berner-schloss/infos-und-bilder/): Abruffehler: <urlopen error timed out>
- [https://www.gartenstadt-hamburg.de/mehr-als-wohnen/gemeinschaftshaus/](https://www.gartenstadt-hamburg.de/mehr-als-wohnen/gemeinschaftshaus/): erreichbar
- [https://www.gartenstadt-hamburg.de/mehr-als-wohnen/gaestewohnen/gaestewohnung/](https://www.gartenstadt-hamburg.de/mehr-als-wohnen/gaestewohnen/gaestewohnung/): erreichbar
- [https://www.gartenstadt-hamburg.de/mehr-als-wohnen/gaestewohnen/gaestezimmer/](https://www.gartenstadt-hamburg.de/mehr-als-wohnen/gaestewohnen/gaestezimmer/): erreichbar
- [https://www.gartenstadt-hamburg.de/mehr-als-wohnen/bei-uns-zeitschrift/](https://www.gartenstadt-hamburg.de/mehr-als-wohnen/bei-uns-zeitschrift/): erreichbar
- [https://www.gartenstadt-hamburg.de/mehr-als-wohnen/gemeinschaftshaus/{href}](https://www.gartenstadt-hamburg.de/mehr-als-wohnen/gemeinschaftshaus/{href}): Abruffehler: <urlopen error timed out>

### 45 – FLUWOG-NORDMARK

- [https://www.fluwog.de/wohnen/wohnungssuche/](https://www.fluwog.de/wohnen/wohnungssuche/): erreichbar
- [https://www.fluwog.de](https://www.fluwog.de): erreichbar
- [https://www.fluwog.de/wohnen/wohnungssuche/](https://www.fluwog.de/wohnen/wohnungssuche/): erreichbar
- [https://www.fluwog.de/wohnen/wohnungssuche/](https://www.fluwog.de/wohnen/wohnungssuche/): erreichbar
- [https://www.fluwog.de/wohnen/wohnungssuche/](https://www.fluwog.de/wohnen/wohnungssuche/): erreichbar
- [https://www.fluwog.de/wohnen/wohnungssuche/](https://www.fluwog.de/wohnen/wohnungssuche/): Abruffehler: <urlopen error timed out>
- [https://www.fluwog.de/wohnen/](https://www.fluwog.de/wohnen/): erreichbar
- [https://www.fluwog.de/wohnen/unser-bestand/](https://www.fluwog.de/wohnen/unser-bestand/): erreichbar
- [https://www.fluwog.de/wohnen/neubau/](https://www.fluwog.de/wohnen/neubau/): erreichbar

### 46 – Wohnungsverein Hamburg von 1902

- [https://wv1902.de/wohnungsangebote/](https://wv1902.de/wohnungsangebote/): erreichbar
- [https://wv1902.de](https://wv1902.de): erreichbar

### 53 – KOLPING

- [https://baugenossenschaft-kolping.de/wohnungsbestand/](https://baugenossenschaft-kolping.de/wohnungsbestand/): erreichbar
- [https://baugenossenschaft-kolping.de/](https://baugenossenschaft-kolping.de/): erreichbar

### 55 – WG von 1904

- [https://www.1904.de/wohnungen/wohnungssuche](https://www.1904.de/wohnungen/wohnungssuche): erreichbar
- [https://www.1904.de](https://www.1904.de): erreichbar
- [https://www.1904.de/fileadmin/user_upload/Immomio_-_Interessentenportal.png](https://www.1904.de/fileadmin/user_upload/Immomio_-_Interessentenportal.png): erreichbar
- [https://www.1904.de/fileadmin/_processed_/d/c/csm_Immomio_-_Interessentenportal_4a9a8a4c62.png](https://www.1904.de/fileadmin/_processed_/d/c/csm_Immomio_-_Interessentenportal_4a9a8a4c62.png): erreichbar

### 56 – WHW 1897

- [https://www.whw1897.de/](https://www.whw1897.de/): erreichbar
- [https://www.whw1897.de](https://www.whw1897.de): erreichbar

### 58 – Wohnreform eG

- [https://www.wohnreform-eg.de/](https://www.wohnreform-eg.de/): erreichbar

### 59 – Wohnwarft eG

- [https://wohnwarft.de/](https://wohnwarft.de/): Abruffehler: HTTP Error 502: Bad Gateway

### 60 – Baugenossenschaft der Buchdrucker

- [https://buchdrucker.immomio.de/](https://buchdrucker.immomio.de/): erreichbar
- [https://www.buchdrucker.de](https://www.buchdrucker.de): erreichbar
- [https://buchdrucker.immomio.de/xmlrpc.php](https://buchdrucker.immomio.de/xmlrpc.php): Abruffehler: HTTP Error 405: Method Not Allowed
- [https://buchdrucker.immomio.de/feed/](https://buchdrucker.immomio.de/feed/): erreichbar
- [https://buchdrucker.immomio.de/comments/feed/](https://buchdrucker.immomio.de/comments/feed/): erreichbar
- [https://buchdrucker.immomio.de/wp-includes/css/dist/block-library/style.min.css](https://buchdrucker.immomio.de/wp-includes/css/dist/block-library/style.min.css?ver=6.7.7): erreichbar

### 61 – dhu

- [https://hpm2.immosolve.eu/immosolve_presentation/pub/modern/2223228/HP/immo.jsp](https://hpm2.immosolve.eu/immosolve_presentation/pub/modern/2223228/HP/immo.jsp): erreichbar
- [https://www.dhu.hamburg](https://www.dhu.hamburg): Abruffehler: <urlopen error timed out>

### 64 – Falkenried-Terrassen

- [https://www.falkenried-terrassen.de/](https://www.falkenried-terrassen.de/): erreichbar
- [https://www.falkenried-terrassen.de](https://www.falkenried-terrassen.de): erreichbar

### 65 – BDS Dennerstraße-Selbsthilfe

- [https://www.bds-hamburg.de/unser-angebot/interessentenportal-immomio/](https://www.bds-hamburg.de/unser-angebot/interessentenportal-immomio/): erreichbar
- [https://www.bds-hamburg.de](https://www.bds-hamburg.de): erreichbar
- Öffentliche Einbettung auf der Anbieterwebsite nachgewiesen: https://www.bds-hamburg.de/unser-angebot/interessentenportal-immomio/

## Konfigurationskontrolle

Nach Abschluss der Abfragen wurden Aktivierung, Laufzeitmodus, Connector-Typ und Prioritäten erneut aus Supabase gelesen. Die zehn erfolgreichen ImmoMio-Connectoren bleiben live auf Priorität 1. Es wurden keine Bestandsanbindungen ersetzt.
