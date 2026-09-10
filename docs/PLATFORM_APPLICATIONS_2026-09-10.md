# Plattform-Bewerbungen — 2026-09-10

## Ziel und Sicherheitsgrenze

Die Premium-Bewerbungsfunktion ergänzt die bestehende manuelle Schnellbewerbung um private, wiederverwendbare Plattformsitzungen für ImmoScout24 und Kleinanzeigen. Nutzer melden sich selbst in einem Browserfenster der Plattform an; der Bot speichert keine Passwörter. Automatischer Versand bleibt hinter Premium, individueller Freigabe, bestehender Listing-Berechtigung, Dokumentfreigaben und einem irreversiblen Send-Checkpoint abgesichert.

## Laufzeit

- `application-worker` verwaltet private Browser-Kontexte, Login/Check/Disconnect und die geleaste Bewerbungswarteschlange.
- `telegram-ui` stellt die Konto-Verbindung und den Status bereit.
- Browser-Kontexte sind user- und plattformspezifisch und werden bei Disconnect bzw. Nutzerlöschung entfernt.
- Gleichzeitige Plattformaktionen verwenden eigene Statuskarten. Ein bereits laufendes Login-Fenster wird wiederverwendet statt parallel neu erzeugt.
- Disconnect fenced einen laufenden Login-Lease, bevor Browser/Context entfernt werden, damit nachlaufende Cleanup-Schritte keinen neuen Zustand überschreiben.

## Versandgrenzen

Vor der ersten möglichen Offenlegung von Bewerberdaten ruft der Worker den bestehenden `authorize_application_send`-Checkpoint auf. Danach darf ein unklarer oder abgebrochener Versand nicht automatisch wiederholt werden. Dokumente werden unmittelbar vor der Verwendung erneut auf Freigabe, Typ und Größe geprüft. Fehlende Pflichtfelder, Captchas, unklare Authentifizierung, externe Kontaktflüsse und nicht eindeutig bestätigte Erfolgszustände fallen auf `manual_required` zurück.

## Produktionsstatus

Die technische Infrastruktur ist deployed. Automatische Bewerbungen bleiben absichtlich deaktiviert, solange keine kontrollierten, einwilligungsbasierten End-to-End-Plattformtests den tatsächlichen Login-, Upload- und Sendepfad verifiziert haben. Es wird kein künstlicher Versand an Vermieter ausgeführt, um diese Freigabe zu erzwingen.

## Aktueller Live-Abgleich

Stand 10.09.2026: Supabase `application-worker` v10 und `telegram-ui` v78 enthalten den Plattform-Login-Hotfix. Der Live-Stand wurde auf GitHub `main` zurückgeführt. Die Datenbank enthält weiterhin keine aktivierten Auto-Bewerber; die Freigabesperre bleibt damit wirksam.
