# Quellen- und Connector-Registry

## Verbindliche Trennung

Die 65 Quellen besitzen mehrere voneinander unabhängige Eigenschaften:

- **K1/K2/K3 (`sources.tier`)** ist die fachliche Kategorisierung aus der verbindlichen 65-Quellen-Mastertabelle. Sie wird nicht aus Connector-Qualität, Polling oder Runtime-Health abgeleitet.
- **P1/P2/P3 (`source_connectors.priority`)** ist die technische Connector-Reihenfolge: P1 Primär, P2 Fallback 1, P3 Fallback 2.
- **`runtime_mode`** entscheidet, ob eine Quelle `live` oder `shadow` ist.
- **`poll_interval_minutes`** bestimmt die tatsächliche Abruffrequenz und ist unabhängig von K1/K2/K3.
- **`crawl_priority`** ordnet gleichzeitig fällige Quellen.
- **`coverage_strategy`** bestimmt die Enumeration des Bestands.

Supabase `sources` und `source_connectors` sind die Runtime-Source-of-Truth. Es gibt absichtlich keine zweite maschinenlesbare Source-Registry im Repository.

## Coverage-Strategien

| Strategie | Verwendung |
|---|---|
| `adaptive_partition` | Result-Cap wird rekursiv geteilt; ImmoScout nutzt 7 Bezirke + adaptive Preispartitionierung + Stadtteil-Fallback. |
| `district_hybrid` | Kleinanzeigen: 7 Hamburger Bezirke. Seite 1 aller Bezirke bildet die Fast Lane; die Vollabdeckung läuft zusätzlich sequenziell Seite für Seite mit persistentem Cursor. |
| `district_pagination` | Bezirkssegmente mit vollständiger Pagination; bleibt als allgemeine Strategiebezeichnung für reine Bezirks-Pagination erhalten. |
| `tenant_api` | Vollständige strukturierte Tenant-/API-Enumeration, z. B. ImmoMio, ImmoSolve/HPM oder dedizierte REST APIs. |
| `pagination` | Resultlisten werden Seite/Cursor für Seite/Cursor abgearbeitet. |
| `full_page` | Kleine offizielle Angebotsseiten werden vollständig geladen und ausgewertet. |
| `availability` | Verfügbarkeits-/Booking-Systeme werden nach ihrer Unit-/Zeitraumlogik geprüft. |
| `generic` | Live-Quelle ohne spezialisierten Adapter; bleibt sichtbar und messbar, bis ein spezifischer Adapter erforderlich ist. |

## Betriebsregeln

1. Der `source-worker` ist der einzige produktive Source-Worker. Source-Adapter sind Module innerhalb dieses Deployments; `kleinanzeigen-transport` ist ausschließlich der eng erlaubte HTTP-Transport für den Kleinanzeigen-Adapter und führt weder Scheduling noch Matching oder Delivery aus.
2. Pro Worker-Claim laufen maximal drei Source-Jobs parallel.
3. Alle fälligen Live-Quellen dürfen in `source_jobs` eingereiht werden; die Dreiergrenze gilt für Ausführung, nicht für Queue-Größe.
4. Der Coverage-State wird generisch in `source_coverage_state` persistiert.
5. Eine erfolgreiche Erstinventarisierung bildet die Baseline. Erst nach abgeschlossener Baseline dürfen neue Listings an Nutzer zugestellt werden.
6. Telegram-Delivery ist zusätzlich **fail-closed** über `listings.fresh_delivery_eligible`: Nur Listings aus einem bestätigten aktuellen Pfad dürfen `delivery_events` erzeugen. ImmoScout markiert nur die `neueste Inserate`-Lane als frisch; Kleinanzeigen nur die 7 Bezirks-Seite-1-Fast-Lane. Deep-Crawl-/Backfill-Ergebnisse bleiben in `listings`, sind aber nicht Telegram-berechtigt. Vollständige strukturierte Tenant-Snapshots dürfen neue IDs nach vorhandener Baseline als frisch markieren. Unbestätigte Pagination-/Generic-/Availability-Pfade bleiben blockiert, bis ihre Freshness-Semantik explizit verifiziert ist.
7. Neue primäre und `fresh_delivery_eligible=true` Listings werden direkt per SQL gematcht und als `delivery_events` eingereiht.
8. Cross-Source-Deduplizierung erfolgt über `listing_dedupe_groups` und `preferred_listing_id`.
9. Login-Schranken, CAPTCHA und Anti-Bot-Schutz werden nicht umgangen. 401/403/429-/Netzwerkfehler bleiben als Health-Fehler sichtbar und nutzen Queue-Retries; ein Coverage-Cursor wird bei einer nicht erfolgreich geparsten Seite nicht weitergeschoben.
10. Shadow-Quellen bleiben im 65-Quellen-Katalog, konkurrieren aber nicht um normale Source-Worker-Kapazität.

## Aktueller Runtime-Split

- **65 Quellen insgesamt**
- **56 live**
- **9 shadow**

Shadow ist ausdrücklich keine vierte K-Kategorie. Eine Quelle behält ihren K1/K2/K3-Wert aus der Mastertabelle auch dann, wenn `runtime_mode='shadow'` gesetzt ist.

## Connector-Health

Architekturstatus und Connector-Coverage sind getrennte Zustände. Ein sauberer v3-Cutover bedeutet nicht automatisch, dass jeder externe Anbieter jederzeit vollständige serverseitige Enumeration erlaubt. Insbesondere werden Transportfehler wie ein Kleinanzeigen-HTTP-403 nicht als erfolgreiche Coverage gewertet.

Für jeden Lauf werden verwendeter Connector, Ergebnis und Fehler in `crawl_runs` protokolliert. Die aktuelle Konfiguration einer konkreten Quelle ist direkt aus `sources` und `source_connectors` zu lesen; dadurch kann GitHub nicht von der produktiven Connector-Registry abweichen.
