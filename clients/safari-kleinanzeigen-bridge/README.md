# Traumwohnung Kleinanzeigen Safari Bridge

Diese Safari Web Extension beendet den einmaligen Kleinanzeigen-PKCE-Login automatisch auf dem Gerät des Nutzers.

## Ablauf

1. Der Telegram-Bot startet den bestehenden Kleinanzeigen-Authorization-Code-Flow mit PKCE.
2. Der Nutzer öffnet den Login in Safari und meldet sich direkt bei Kleinanzeigen an.
3. Kleinanzeigen leitet auf den registrierten Android-Callback `https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback` weiter.
4. Die Extension läuft ausschließlich auf diesem Callback-Pfad, liest `code` + `state` und sendet die vollständige Callback-URL per TLS an den Bridge-Endpunkt des `application-worker`.
5. Der Server validiert Host/Pfad/State/Expiry, verwendet den serverseitig gespeicherten PKCE-Verifier und tauscht den Code gegen Access-/Refresh-Token.
6. Die Tokens werden über den bestehenden AES-GCM-Credential-Store verschlüsselt gespeichert.
7. Die Extension leitet zurück zu `@traumwohnunghamburgbot`.

Passwörter, Cookies oder 2FA-Codes werden nicht an Traumwohnung übertragen.

## Berechtigungen

Die Extension fordert nur Zugriff auf:

- `https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback*`
- den konkreten Supabase `application-worker`-Endpunkt

Es gibt keinen Zugriff auf andere Kleinanzeigen-Seiten und kein `<all_urls>`.

## iOS paketieren

Aktuelle Apple-Toolchains verwenden den Safari Web Extension Packager. Auf einem Mac mit Xcode:

```bash
xcrun safari-web-extension-packager clients/safari-kleinanzeigen-bridge/extension \
  --project-location clients/safari-kleinanzeigen-bridge/build \
  --app-name "Traumwohnung Bridge" \
  --bundle-identifier de.traumwohnunghamburg.bridge \
  --swift \
  --ios-only
```

Danach das erzeugte Xcode-Projekt öffnen, Signing-Team wählen und auf einem iPhone ausführen. Anschließend unter **Einstellungen → Apps → Safari → Erweiterungen** die Erweiterung aktivieren und für `login.kleinanzeigen.de` erlauben.

Für einen physischen iOS-Test verlangt Apple ein Developer-Program-Konto. Für Distribution kann das Projekt über TestFlight/App Store Connect verteilt werden.

## Sicherheit

Der Bridge-Endpunkt besitzt bewusst keinen Service-Role- oder statischen Client-Key. Eine erfolgreiche Completion benötigt gleichzeitig:

- einen gültigen, nicht verbrauchten, kurzlebigen `state`,
- den zugehörigen PKCE-Verifier, der ausschließlich serverseitig liegt,
- einen echten Authorization Code von Kleinanzeigen,
- exakt den registrierten Kleinanzeigen-Callback-Host und -Pfad.

Callbacks sind one-time; Replays scheitern nach `consumed_at`.
