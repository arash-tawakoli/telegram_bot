# Quellen- und Connector-Registry

Verbindliche Logik: **P1 = Primär**, **P2 = Fallback 1**, **P3 = Fallback 2**. Der Crawler verwendet pro Quelle höchstens diese drei Stufen. K1/K2/K3 steuern aktuell die Polling-Intervalle 15/30/60 Minuten.

Quelle 64 bleibt deaktiviert, weil in der Mastertabelle kein bestätigter digitaler Listing-Connector vorhanden ist.

1. ImmobilienScout24 Hamburg [K1] — P1 Public Search | P2 /expose/<ID> | P3 XML-Sitemap/Discovery
2. Kleinanzeigen Hamburg [K1] — P1 Public Search | P2 data-adid/data-href -> /s-anzeige/.../<ID> | P3 Pagination
3. Immowelt Hamburg [K1] — P1 Public Search | P2 /expose/<GUID> | P3 Pagination
4. SAGA [K3] — P1 SAGA Public Frontend | P2 HTML-/DOM-Parsing
5. Vonovia Hamburg [K1] — P1 REST /api/real-estate/list | P2 JSON Response | P3 Fetch-Endpunkt
6. WG-Gesucht Hamburg [K1] — P1 JSON-LD | P2 Schema.org CollectionPage/ItemList | P3 Public Search
7. TAG Wohnen Hamburg [K2] — P1 JSON /properties | P2 JSON Response Parser | P3 Hamburg City Bucket
8. Grand City Property Hamburg [K2] — P1 GCP Public Wohnungssuche | P2 /wohnungssuche/hamburg/.../<Objekt-ID> | P3 Pagination
9. HousingAnywhere Hamburg [K1] — P1 Public Search | P2 /room/<ID> | P3 Pagination
10. Wunderflats Hamburg [K2] — P1 XML-Sitemap | P2 Öffentliche Hamburg-Suchseite | P3 Pagination
11. Heimstaden Hamburg [K2] — P1 Offizielle Hamburg-Listingseite | P2 ImmoScout Portal 89093515 | P3 ImmoScout Portal 75089905
12. Ohne-Makler.net Hamburg [K1] — P1 Public Search | P2 /immobilie/<ID>/ | P3 Pagination
13. Homelike / Spacest Hamburg [K1] — P1 JSON-LD | P2 Next.js __NEXT_DATA__ | P3 Public Hamburg Search
14. meinestadt.de Hamburg [K1] — P1 Public Search | P2 /expose/<ID> | P3 Pagination
15. immobilien.de Hamburg [K1] — P1 Public Search | P2 /wohnen/<ID> | P3 Pagination
16. immobilie1 Hamburg [K1] — P1 Schema.org | P2 Microdata | P3 Public Search
17. City-Wohnen Hamburg [K1] — P1 JSON-LD | P2 Public Hamburg Search | P3 HTML-/DOM-Parsing
18. Studierendenwerk Hamburg [K2] — P1 Wohnanlagen-Verzeichnis | P2 Online-Bewerbung | P3 Bewerbungsinformationen / Bewerbungsportal
19. Nestpick Hamburg [K1] — P1 Rendered Public Search | P2 HTML-/DOM Listing Cards | P3 Rendered Card Text Scraper
20. Covivio Hamburg [K2] — P1 Public Housing Search | P2 ?location=Hamburg Filter | P3 HTML-/DOM Search Renderer
21. Tauschwohnung.com Hamburg [K1] — P1 Public Hamburg Search | P2 Nuxt-rendered Listing Cards | P3 Pagination ?page=2
22. Wohnungsswap.de Hamburg [K1] — P1 Public Hamburg Search | P2 /tauschangebot/<ID> | P3 HTML-/DOM-Parsing
23. Hamburger Wohnen [K1] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
24. Bergedorf-Bille [K2] — P1 ImmoSolve REST API | P2 JSON Response | P3 ImmoSolve HPM
25. BVE [K1] — P1 BVE eigene Wohnungsangebote-Seite | P2 HTML-/DOM-Parsing | P3 Web-Scraping
26. altoba [K2] — P1 ImmoSolve REST API | P2 JSON Response | P3 ImmoSolve HPM
27. HANSA [K2] — P1 ImmoSolve REST-Konfiguration | P2 JSON Response | P3 ImmoSolve Presentation/HPM
28. BGFG [K2] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
29. VHW [K1] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
30. HARABAU [K1] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
31. GWG-Gruppe Hamburg [K1] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
32. EBV Harburg [K1] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
33. KAIFU-NORDLAND [K2] — P1 REST /api/property-supply/all | P2 JSON Response | P3 Fetch-Endpunkt
34. Bauverein Reiherstieg [K2] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
35. Walddörfer [K2] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
36. Fuhlsbüttel [K1] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
37. Finkenwärder-Hoffnung [K1] — P1 WordPress REST /wp-json/immo/v1/estates | P2 JSON Response | P3 JavaScript Fetch
38. Hanseatische Baugenossenschaft [K2] — P1 Öffentliche Wohnungsangebote-Seite | P2 HTML-/DOM-Parsing | P3 Web-Scraping/Monitoring
39. mgf Gartenstadt Farmsen [K2] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt
40. Schiffszimmerer [K2] — P1 React-Suchfrontend | P2 Öffentliches Frontend | P3 HTML-/DOM-Parsing
41. Süderelbe [K2] — P1 Öffentliche Seite Aktuelle Wohnungsangebote | P2 serverseitiges HTML/DOM | P3 Web-Monitoring
42. Lehrerbau [K2] — P1 Lehrerbau eigene Angebots-/Informationsseite | P2 HTML-/DOM-Parsing | P3 Monitoring
43. Gartenstadt Wandsbek [K3] — P1 Legacy ImmoSolve HPM | P2 DWR/XHR | P3 AJAX
44. Gartenstadt Hamburg [K3] — P1 Öffentliches Frontend | P2 HTML-/DOM-Parsing
45. FLUWOG-NORDMARK [K3] — P1 Öffentliches Frontend | P2 HTML-/DOM-Parsing
46. Wohnungsverein Hamburg von 1902 [K2] — P1 Öffentliche Wohnungsangebote-Seite | P2 HTML-/DOM-Parsing
47. Wohnungsunternehmen Fiefstuecken [K2] — P1 Nord-IMMO Mietangebote | P2 ImmoSolve HPM Mandant 2205841 | P3 DWR/XHR
48. meravis Hamburg [K2] — P1 Öffentliche Wohnungssuche | P2 TYPO3 tx_uoimmo RealEstates | P3 Wohnungshelden Interessentenlisten-iFrame
49. Smartments Hamburg [K1] — P1 Hamburg Availability Page | P2 Hamburg Location Cards | P3 Booking Renderer
50. Urban Living Hamburg [K2] — P1 Öffentliche Mietseite | P2 Apartment-Verfügbarkeits-DOM | P3 Apartment-Detail-Popover
51. Felixx student Hamburg [K2] — P1 Hamburger Apartmentseite | P2 Jetzt-bewerben-Weg | P3 StarRez PortalX
52. Wichern Baugesellschaft [K2] — P1 Öffentliche Vermietungsseite | P2 /property/<slug> Angebotskarten | P3 HTML-/DOM-Parsing
53. KOLPING [K2] — P1 Öffentliche Seite Freie Wohnungen | P2 HTML-/DOM-Parsing | P3 Web-Scraping/Monitoring
54. HSG Wohnen [K3] — P1 Öffentliche Wohnanlagen-Seite | P2 WordPress REST /wp-json/wp/v2/pages/9 | P3 HTML-/DOM-Parsing
55. WG von 1904 [K3] — P1 Öffentliches Frontend | P2 HTML-/DOM-Parsing
56. WHW 1897 [K3] — P1 Public Bewerbungs-/Interessentenseite | P2 HTML-/DOM-Parsing
57. WGPV [K2] — P1 Gästewohnungs-Seite | P2 Öffentliche Wohnen-Seite | P3 HTML-/DOM-Parsing
58. Wohnreform eG [K3] — P1 Öffentliche Wohnprojekt-Seite | P2 HTML-/DOM-Parsing
59. Wohnwarft eG [K3] — P1 Öffentliche Website | P2 HTML-/DOM-Parsing
60. Baugenossenschaft der Buchdrucker [K3] — P1 WP-ImmoMakler RSS Feed | P2 WP-ImmoMakler Atom Feed | P3 AJAX Listing Request
61. dhu [K3] — P1 ImmoSolve REST API | P2 JSON Response | P3 ImmoSolve HPM
62. DVG Immobilien [K3] — P1 DVG Public Frontend | P2 HTML-/DOM-Parsing | P3 Web-Scraping
63. Wohnungsbörse.net Hamburg [K3] — P1 Public Search | P2 /immodetail/<ID> | P3 Sitemap/Discovery
64. Falkenried-Terrassen [K3] — P1 Kein bestätigter digitaler Wohnungslisting-Connector
65. BDS Dennerstraße-Selbsthilfe [K2] — P1 Immomio GraphQL API | P2 JSON Response | P3 Fetch-Endpunkt

## Betriebsregeln

- Keine Umgehung von Login, CAPTCHA oder Anti-Bot-Schutz.
- Erste erfolgreiche Abfrage einer Quelle ist ein Warm-up; vorhandene Alt-Inserate werden gespeichert, aber nicht an Nutzer gesendet.
- Danach werden nur neu entdeckte Treffer gegen aktive Suchprofile gematcht.
- Cross-Source-Deduplizierung nutzt, soweit verfügbar, Adresse + Mietpreis + Zimmer + Fläche.
- Fehler und verwendete Fallback-Stufe werden in `crawl_runs` protokolliert.
