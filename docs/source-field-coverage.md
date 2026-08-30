# Listing-Feld-Coverage der 65 Quellen

Stand: 2026-08-30. Diese Matrix dokumentiert den **beobachteten produktiven Datenstand in `public.listings` vor dem Parser-Fix**. Sie ist keine zweite Runtime-Konfiguration. Supabase bleibt Source of Truth.

Wichtig: `x/y` bedeutet: Bei `y` aktuell aktiven Listings ist das Feld bei `x` Listings vorhanden. `—` bedeutet, dass zum Prüfzeitpunkt kein aktives Listing als reale Stichprobe vorhanden war; daraus folgt **nicht**, dass die Quelle das Feld grundsätzlich nicht liefert.

Die kanonischen Zielfelder sind: `title`, `image_url`/`resolved_image_url`, `cold_rent`, `warm_rent`, `additional_costs`, `operating_costs`, `heating_costs`, `deposit`/`deposit_text`, `rooms`, `area_sqm`. Originale strukturierte API-/JSON-Werte haben Vorrang; Text-Parsing ist Fallback. Fehlende Werte werden nicht erfunden.

| ID | Quelle | Runtime | Strategie | Aktiv | Titel | Bild* | Kalt | Warm/Gesamt | NK | Betrieb | Heiz | Kaution | Zimmer | Fläche |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | ImmobilienScout24 Hamburg | live | adaptive_partition | 1298 | 1298/1298 | 140/1298 | 1298/1298 | 0/1298 | 0/1298 | 0/1298 | 0/1298 | 0/1298 | 1070/1298 | 1070/1298 |
| 2 | Kleinanzeigen Hamburg | live | district_hybrid | 3241 | 3241/3241 | 3131/3241 | 3172/3241 | 1650/3241 | 1314/3241 | 11/3241 | 247/3241 | 45/3241 | 3237/3241 | 3235/3241 |
| 3 | Immowelt Hamburg | live | pagination | 44 | 44/44 | 38/44 | 38/44 | 1/44 | 0/44 | 0/44 | 0/44 | 0/44 | 44/44 | 44/44 |
| 4 | SAGA | live | generic | 6 | 6/6 | 0/6 | 6/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 | 1/6 | 6/6 |
| 5 | Vonovia Hamburg | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 6 | WG-Gesucht Hamburg | live | pagination | 6 | 6/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 | 6/6 | 6/6 |
| 7 | TAG Wohnen Hamburg | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 8 | Grand City Property Hamburg | live | pagination | 1 | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | 0/1 |
| 9 | HousingAnywhere Hamburg | live | pagination | 9 | 9/9 | 4/9 | 0/9 | 4/9 | 0/9 | 0/9 | 0/9 | 2/9 | 4/9 | 9/9 |
| 10 | Wunderflats Hamburg | live | pagination | 128 | 128/128 | 64/128 | 0/128 | 65/128 | 0/128 | 0/128 | 0/128 | 3/128 | 128/128 | 127/128 |
| 11 | Heimstaden Hamburg | live | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 12 | Ohne-Makler.net Hamburg | live | pagination | 38 | 38/38 | 25/38 | 30/38 | 7/38 | 1/38 | 0/38 | 7/38 | 4/38 | 31/38 | 34/38 |
| 13 | Homelike / Spacest Hamburg | live | generic | 10 | 10/10 | 10/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 0/10 | 10/10 | 10/10 |
| 14 | meinestadt.de Hamburg | live | pagination | 0 | — | — | — | — | — | — | — | — | — | — |
| 15 | immobilien.de Hamburg | live | pagination | 31 | 31/31 | 1/31 | 30/31 | 19/31 | 15/31 | 1/31 | 9/31 | 21/31 | 27/31 | 31/31 |
| 16 | immobilie1 Hamburg | live | pagination | 46 | 46/46 | 12/46 | 15/46 | 0/46 | 9/46 | 0/46 | 6/46 | 0/46 | 46/46 | 46/46 |
| 17 | City-Wohnen Hamburg | live | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 18 | Studierendenwerk Hamburg | shadow | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 19 | Nestpick Hamburg | live | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 20 | Covivio Hamburg | live | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 21 | Tauschwohnung.com Hamburg | live | pagination | 5 | 5/5 | 1/5 | 1/5 | 1/5 | 1/5 | 0/5 | 0/5 | 0/5 | 5/5 | 5/5 |
| 22 | Wohnungsswap.de Hamburg | live | pagination | 0 | — | — | — | — | — | — | — | — | — | — |
| 23 | Hamburger Wohnen | live | tenant_api | 3 | 3/3 | 3/3 | 0/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 |
| 24 | Bergedorf-Bille | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 25 | BVE | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 26 | altoba | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 27 | HANSA | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 28 | BGFG | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 29 | VHW | live | tenant_api | 6 | 6/6 | 6/6 | 0/6 | 6/6 | 0/6 | 0/6 | 0/6 | 0/6 | 6/6 | 6/6 |
| 30 | HARABAU | live | tenant_api | 4 | 4/4 | 2/4 | 0/4 | 4/4 | 0/4 | 0/4 | 0/4 | 0/4 | 4/4 | 4/4 |
| 31 | GWG-Gruppe Hamburg | live | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 32 | EBV Harburg | live | tenant_api | 3 | 3/3 | 3/3 | 0/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 |
| 33 | KAIFU-NORDLAND | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 34 | Bauverein Reiherstieg | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 35 | Walddörfer | live | tenant_api | 2 | 2/2 | 0/2 | 0/2 | 2/2 | 0/2 | 0/2 | 0/2 | 0/2 | 2/2 | 2/2 |
| 36 | Fuhlsbüttel | live | tenant_api | 3 | 3/3 | 3/3 | 0/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 |
| 37 | Finkenwärder-Hoffnung | live | tenant_api | 2 | 0/2 | 0/2 | 2/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | 2/2 | 1/2 |
| 38 | Hanseatische Baugenossenschaft | live | full_page | 0 | — | — | — | — | — | — | — | — | — | — |
| 39 | mgf Gartenstadt Farmsen | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 40 | Schiffszimmerer | live | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 41 | Süderelbe | live | full_page | 0 | — | — | — | — | — | — | — | — | — | — |
| 42 | Lehrerbau | live | full_page | 0 | — | — | — | — | — | — | — | — | — | — |
| 43 | Gartenstadt Wandsbek | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 44 | Gartenstadt Hamburg | live | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 45 | FLUWOG-NORDMARK | live | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 46 | Wohnungsverein Hamburg von 1902 | live | full_page | 0 | — | — | — | — | — | — | — | — | — | — |
| 47 | Wohnungsunternehmen Fiefstuecken | live | generic | 2 | 2/2 | 2/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 |
| 48 | meravis Hamburg | live | generic | 1 | 1/1 | 0/1 | 0/1 | 1/1 | 0/1 | 0/1 | 0/1 | 0/1 | 1/1 | 0/1 |
| 49 | Smartments Hamburg | live | availability | 3 | 3/3 | 2/3 | 2/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 |
| 50 | Urban Living Hamburg | live | availability | 0 | — | — | — | — | — | — | — | — | — | — |
| 51 | Felixx student Hamburg | shadow | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 52 | Wichern Baugesellschaft | live | full_page | 0 | — | — | — | — | — | — | — | — | — | — |
| 53 | KOLPING | live | full_page | 0 | — | — | — | — | — | — | — | — | — | — |
| 54 | HSG Wohnen | shadow | generic | 3 | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| 55 | WG von 1904 | live | generic | 1 | 1/1 | 1/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 |
| 56 | WHW 1897 | shadow | generic | 1 | 1/1 | 1/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 |
| 57 | WGPV | shadow | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 58 | Wohnreform eG | live | full_page | 0 | — | — | — | — | — | — | — | — | — | — |
| 59 | Wohnwarft eG | shadow | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 60 | Baugenossenschaft der Buchdrucker | live | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 61 | dhu | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |
| 62 | DVG Immobilien | shadow | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 63 | Wohnungsbörse.net Hamburg | shadow | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 64 | Falkenried-Terrassen | shadow | generic | 0 | — | — | — | — | — | — | — | — | — | — |
| 65 | BDS Dennerstraße-Selbsthilfe | live | tenant_api | 0 | — | — | — | — | — | — | — | — | — | — |

\* `Bild` zählt in dieser Baseline nur ein nicht als `fallback` markiertes Bild. Dadurch wird sichtbar, dass z. B. bei ImmoScout echte `image_url`-Werte vorhanden sind, aber ältere Enrichment-Zustände teilweise noch auf Fallback stehen.

## Implementierte Normalisierung

- Titel: strukturierter Titel/Headline/ObjectTitle/Name vor Text-Fallback; bei strukturierter API ohne Titel nur ein sachlicher Adress-Fallback.
- Bilder: strukturierte `image*`/`picture*`/`photo*`/`thumbnail*`-Felder sowie HTML `data-src`, `data-original`, `src`, `data-srcset`, `srcset`; bekannte Logo-/Placeholder-Assets werden verworfen.
- Kaltmiete: Kaltmiete, Nettokaltmiete, Grundmiete, Nettomiete sowie explizites `Miete zzgl. NK`.
- Warm/Gesamt: Warmmiete, Bruttowarmmiete, Bruttomiete, Gesamtmiete, Miete warm und strukturierte Total-Rent-Felder.
- Nebenkosten: Nebenkosten, Nebenkostenvorauszahlung, sonstige Kosten und strukturierte ancillary/service-cost-Felder.
- Betriebskosten: Betriebskosten/Betriebskostenvorauszahlung.
- Heizkosten: Heizkosten/Heizungskosten/Heizkostenvorauszahlung.
- Kaution: Kaution/Mietkaution/Mietsicherheit und strukturierte Deposit-Felder.
- Zimmer/Fläche: sowohl `2 Zimmer`/`60 m²` als auch beschriftete Reihenfolge wie `Zimmer: 2`/`Wohnfläche: 60` sowie strukturierte Felder.

## Bekannte Grenzen

- Felder werden nur übernommen, wenn die jeweilige öffentliche Liste/API sie tatsächlich liefert. Nicht explizit belegte Kosten werden nicht aus anderen Preisen geraten.
- Quellen ohne aktives Listing bleiben in dieser Matrix `—`, bis eine reale Stichprobe vorliegt.
- Detailseiten-Crawling für jedes einzelne Listing wurde bewusst nicht neu eingeführt; das wäre ein zusätzlicher Request-/Enrichment-Workflow und nicht die minimale Änderung.
- Scheduler, Source Queue, Coverage, Freshness, Dedupe, Matching und Telegram-Dispatcher sind von diesem Fix nicht betroffen.
