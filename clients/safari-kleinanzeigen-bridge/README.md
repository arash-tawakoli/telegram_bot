# TraumWohnung Kleinanzeigen Login Helper (Beta)

Dieser Safari WebExtension-Helper wird nur für den internen Beta-Test verwendet. Er ersetzt keinen Kleinanzeigen-Login und automatisiert keine Eingaben.

## Nutzerablauf

1. In Telegram oder unter `intern.traumwohnunghamburg.de` auf **Kleinanzeigen verbinden** klicken.
2. Die originale Kleinanzeigen-Loginseite öffnet sich.
3. Nutzer meldet sich direkt bei Kleinanzeigen an und bestätigt gegebenenfalls MFA.
4. Kleinanzeigen leitet auf den registrierten Android-Callback weiter.
5. Der Helper läuft ausschließlich auf diesem Callback-Pfad, übergibt `code + state` an die Supabase-Callback-Bridge und beendet den Login automatisch.
6. Supabase prüft State, Ablaufzeit und PKCE, tauscht den Code gegen Tokens und speichert die Verbindung.
7. Coach-Portal aktualisiert den Status über das vorhandene Polling; Telegram erhält die Bestätigung.

Es gibt **keinen Share-Flow, kein Copy/Paste und keine Browser-Automation**.

## Berechtigungen

Der Helper darf ausschließlich auf folgenden Zielen laufen bzw. zugreifen:

- `https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback*`
- `https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-callback-bridge*`

Er liest keine Passwörter, Cookies, MFA-Codes, Local Storage oder Session Storage.

## macOS Safari paketieren

Auf einem Mac mit aktuellem Xcode:

```bash
xcrun safari-web-extension-packager clients/safari-kleinanzeigen-bridge/extension \
  --project-location clients/safari-kleinanzeigen-bridge/build-macos \
  --app-name "TraumWohnung Login Helper" \
  --bundle-identifier de.traumwohnunghamburg.loginhelper \
  --swift \
  --macos-only \
  --copy-resources
```

Danach das erzeugte Xcode-Projekt öffnen, Signing-Team auswählen und die App einmal ausführen. Anschließend in **Safari → Einstellungen → Erweiterungen** den Helper aktivieren und den Zugriff für `login.kleinanzeigen.de` erlauben.

## iOS Safari paketieren

```bash
xcrun safari-web-extension-packager clients/safari-kleinanzeigen-bridge/extension \
  --project-location clients/safari-kleinanzeigen-bridge/build-ios \
  --app-name "TraumWohnung Login Helper" \
  --bundle-identifier de.traumwohnunghamburg.loginhelper \
  --swift \
  --ios-only \
  --copy-resources
```

## Sicherheitsmodell

Eine erfolgreiche Completion benötigt gleichzeitig:

- einen gültigen, noch nicht verbrauchten und nicht abgelaufenen `state`,
- den zugehörigen PKCE-Verifier, der ausschließlich in Supabase gespeichert ist,
- einen echten Authorization Code von Kleinanzeigen,
- exakt den registrierten Kleinanzeigen-Callback-Host und -Pfad.

Nach erfolgreichem Token-Exchange wird der Flow über `consumed_at` einmalig verbraucht. Die Callback-URL wird nicht als Credential gespeichert.
