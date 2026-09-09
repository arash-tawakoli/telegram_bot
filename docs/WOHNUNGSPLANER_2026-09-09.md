# Wohnungsplaner: fünf neue Funktionen

Erreichbar über `/planer`, den Startmenü-Button „🗂 Wohnungsplaner“ und „Wohnungen organisieren“ in der Merkliste. Der Planer ergänzt die bestehende Premium-Merkliste; deren Berechtigungen bleiben bestehen. Bedienoberfläche und Kontaktentwürfe sind zunächst auf Deutsch.

1. **Bewerbungsstatus:** Gemerkt, Angefragt, Besichtigung, Beworben, Absage und Zusage. Der selbst gesetzte Status erscheint direkt in der paginierten Wohnungsübersicht.
2. **Private Notizen:** Eine frei bearbeitbare Notiz je gespeicherter Wohnung, bis 1.500 Zeichen. Eingabe innerhalb von zehn Minuten als nächste Textnachricht; löschbar. Kommandos oder die Rücknavigation beenden die Eingabe. Ein angefangener Suchprofil-Entwurf wird beibehalten.
3. **Wohnungsvergleich:** Zwei beliebige eigene gespeicherte Wohnungen auswählen, auch über mehrere Seiten hinweg. Bekannte Eckdaten werden gegenübergestellt. Warmmiet- und Flächendifferenzen werden nur berechnet, wenn beide Werte vorliegen.
4. **Kontaktentwürfe:** Anfrage und Nachfassnachricht mit dem Titel des konkreten Angebots. Keine erfundenen Angaben zu Beruf, Einkommen, Bonität oder Haushalt. Der Nutzer ergänzt seinen Namen und versendet selbst; der Bot kontaktiert keine Anbieter.
5. **Kostenübersicht:** Bekannte Mietbestandteile, Kaution, zwölf Monatswarmmieten, rechnerische Summe einer Monatswarmmiete und Kaution sowie Kaltmiete je Quadratmeter. Keine Addition bereits enthaltener Nebenkosten und keine ungeprüfte Errechnung einer Warmmiete. Die Zusammenstellung ist kein Zahlungsplan und umfasst keine unbekannten persönlichen Zusatzkosten.

## Umsetzung

- Ein zusammenhängendes UI-Modul `telegram-ui/organizer.js` verwendet vorhandene `saved_listings.status` und `saved_listings.note`; keine neuen Tabellen oder Migrationen.
- Jede Detailabfrage und Änderung ist serverseitig an den authentifizierten Nutzer und dessen gespeicherte Wohnung gebunden. Vergleiche prüfen beide Besitzbeziehungen. Freie Texte werden für Telegram-HTML maskiert.
- Vergleichs-Callbacks enthalten zwei kompakt kodierte UUIDs und bleiben innerhalb der Telegram-Grenze von 64 Bytes. Die Auswahl benötigt keinen veränderlichen Vergleichszustand.
- Die Übersicht liest sechs Einträge pro Seite; Detaildaten werden erst bei Bedarf geladen. Hauptmenüs erhalten lediglich einen zusätzlichen Button und keine zusätzliche Datenbankabfrage. Bei einer offenen Notizeingabe wird der schnelle Menüpfad an die bestehende UI weitergereicht, damit die Eingabe sauber beendet wird.
- Die vorhandene Quelle-Fakten-Auswertung wird für belegte Daten wiederverwendet. Fehlende Eckdaten bleiben ausgeblendet. Gespeicherte, als inaktiv markierte Angebote sind als solche erkennbar; der Planer prüft Verfügbarkeit nicht eigenständig erneut.

## Prüfung und Auslieferung

- **112 Tests bestanden**, darunter neue Prüfungen für Statuswechsel, fremde Datensätze, Notizbearbeitung/-löschung/-ablauf, Erhaltung angefangener Suchprofile, Datenmaskierung, Vergleich, Mietberechnung, Kontaktentwürfe, Pagination, Callback-Längen und Menü-Routing.
- Zwei bestehende gespeicherte Angebote wurden für eine reine Darstellungskontrolle verwendet. Kostenübersicht, Kontaktentwurf und Vergleich lagen innerhalb der Telegram-Textgrenzen. Dabei wurden keine Nachrichten verschickt.
- Speicherung von Status und Notiz gegen die produktive Datenbank in einer zurückgerollten Transaktion geprüft; genau ein Datensatz ließ sich ändern, anschließend blieben null Testnotizen zurück.
- Live ausgerollt: `telegram-ui` v67 (neun Dateien) und `telegram-fast` v2 (eine Datei). Alle zehn Dateien anschließend zurückgelesen und exakt mit den Deployment-Inhalten verglichen.
- Beide produktiven Endpunkte lehnten Testanfragen mit falschem Webhook-Geheimnis mit HTTP 401 ab. Das bestätigt Startfähigkeit und Authentifizierung, ersetzt aber keinen manuellen Durchlauf in der Telegram-App.
- Die Tests decken Funktionsabläufe mit kontrollierten Telegram-Antworten ab. Ein manueller App-Durchlauf und zusätzliche Übersetzungen stehen als weitere Prüfungen/Erweiterungen aus. Keine gemessene Geschwindigkeitssteigerung wird behauptet.

Die Änderung lässt sich über Git zurücknehmen; bestehende Notizen und Statusdaten bleiben dabei erhalten. Listing-Zustellung, Connectoren, Frischefilter und Preise wurden nicht geändert.
