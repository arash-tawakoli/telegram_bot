# Traumwohnung Hamburg Bot

Backend für `@traumwohnunghamburgbot`: automatische Wohnungssuche in Hamburg über 65 konfigurierte Quellen, Suchprofil-Matching, gespeicherte Inserate und Telegram-Push.

## Stack

- **Telegram Bot API** – Button-Onboarding, Einstellungen, Saved Listings und Foto-Inseratkarten
- **Supabase Postgres** – Nutzer, Suchprofile, Hamburg-Geografie, Quellen, Listings, Deduplizierung und Logs
- **Supabase Edge Functions** – `telegram-ui`, `notification-dispatcher` und Source-Adapter
- **Supabase Cron + pg_net** – zeitgesteuertes Crawling und Notification-Dispatch
- **Supabase Vault** – Bot-Token und interne Secrets; keine Secrets im Repository

## Quellenlogik

Die Mastertabelle wird auf höchstens drei Connector-Stufen abgebildet:

- P1 = Primär
- P2 = Fallback 1
- P3 = Fallback 2

K1/K2/K3 laufen aktuell alle 15/30/60 Minuten. Quelle 64 bleibt deaktiviert, da kein bestätigter digitaler Listing-Connector vorliegt. Die vollständige Registry steht in `docs/source-connectors.md`.

## Telegram Commands

- `/start` – Startseite
- `/suche` – neue Suche
- `/profile` – Suchprofile
- `/gespeichert` – gespeicherte Inserate
- `/einstellungen` – Sprache/Einstellungen
- `/pause`
- `/resume`
- `/status`
- `/hilfe`

## Button-Onboarding

Der Workflow ist auf wenige, klare Schritte reduziert:

1. Immobilientyp: Wohnung, Haus, WG, Tauschwohnung – Mehrfachauswahl möglich
2. Gebiet: Ganz Hamburg, Bezirk(e) oder einzelne Stadtteile
3. maximale Warmmiete: vier Presets oder eigener Betrag
4. Mindestfläche: vier Button-Optionen
5. Zusammenfassung und Aktivierung

Zurück-/Bestätigen-Buttons sind Bestandteil der einzelnen Schritte. Freitext wird nur beim individuellen Mietbetrag benötigt.

## Hamburg-Geografie

Im Backend sind die **7 Bezirke und 104 bestehenden Stadtteile** hinterlegt. Oberbillwerder ist als geplanter 105. Stadtteil bewusst nicht als bestehender Stadtteil enthalten. Die Stadtteilansicht wird mit bis zu 15 Auswahlbuttons pro Seite und Vor/Zurück-Navigation ausgegeben.

## Sprachen

Der Bot speichert eine Sprache pro Nutzer. Verfügbar sind Deutsch, Englisch, Türkisch, Arabisch, Farsi, Dari, Pashto sowie Kurdisch Sorani, Kurmanji und Badini.

## Inseratkarten

Neue Treffer werden zentral durch `notification-dispatcher` als Telegram-Fotokarte zugestellt. Die Karte enthält – sofern von der Quelle veröffentlicht bzw. aus den Quelldaten ableitbar – Titel, Bild, vollständige Adresse, Warmmiete, Heizkosten, Nebenkosten, Kaution, Zimmer und Fläche.

Unter jeder Karte stehen:

- ein quellenbezogener Öffnen-Button, z. B. `Immowelt.de` oder `Kleinanzeigen.de`
- `💾 Speichern`
- `📍 Google Maps`

Fehlende Angaben werden nicht erfunden. Wenn ein Anbieter z. B. keine Kaution oder keine vollständige Adresse veröffentlicht, wird dies entsprechend als nicht angegeben behandelt.

## Datenfluss

1. Cron wählt fällige Quellen anhand ihres K1/K2/K3-Intervalls aus.
2. `source-engine` probiert P1 und danach höchstens P2/P3.
3. Immowelt nutzt zusätzlich den spezialisierten Adapter `source-immowelt`.
4. Inserate werden normalisiert und dedupliziert.
5. Der erste erfolgreiche Lauf einer Quelle ist ein Warm-up und versendet keine historischen Inserate.
6. Neue Treffer werden über `delivery_events` an den zentralen Foto-Dispatcher übergeben.
7. `notification-dispatcher` prüft das Suchprofil nochmals und sendet die Telegram-Karte.
8. Gespeicherte Inserate liegen in `saved_listings` und sind über `/gespeichert` wieder abrufbar.

## Repository

```text
supabase/
  functions/
    telegram-ui/
    notification-dispatcher/
    source-engine/
    source-immowelt/
    telegram-webhook/        # historische Version; nicht aktiver Telegram-Webhook
  migrations/
    202608260001_core_schema.sql
    ...
    202608260006_fix_private_function_search_path.sql
  seed.sql
docs/
  source-connectors.md
```

## Secrets

Die Secret-Werte liegen ausschließlich in Supabase Vault. Produktionswerte dürfen niemals committed werden.

## Betriebshinweis

Der Crawler verwendet ausschließlich öffentlich erreichbare Anbindungen. Login-Schranken, CAPTCHAs oder Anti-Bot-Schutz werden nicht umgangen. Quellen, die serverseitig mit 401/403 oder TLS-/Netzwerkfehlern antworten, bleiben im Monitoring sichtbar und werden nicht durch unsichere Workarounds umgangen.
