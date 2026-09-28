# TraumWohnung Kleinanzeigen Mobile Canary

Admin-only iPhone test client for the existing Kleinanzeigen OAuth/PKCE flow.

## Safe canary flow

1. In Telegram, open Kleinanzeigen and choose **Mobile Canary testen**.
2. Telegram asks the private canary endpoint to create a separate PKCE auth flow.
3. The existing connected Kleinanzeigen session is not changed while the test is pending.
4. The handoff page opens this app with only the one-time OAuth `state`.
5. The app asks the canary endpoint for the Kleinanzeigen authorization URL.
6. A local `WKWebView` performs the normal Kleinanzeigen login.
7. `WKNavigationDelegate` observes only the exact legacy callback URL and cancels its navigation.
8. The callback URL is POSTed to the existing `kleinanzeigen-callback-bridge`.
9. The existing application worker performs the PKCE token exchange and encrypted connection storage.
10. Only after that succeeds are the new credentials stored, and the app returns to Telegram.

If the test is abandoned or fails before the token exchange succeeds, the existing Kleinanzeigen connection remains untouched.

No access token, refresh token, PKCE verifier, Kleinanzeigen password, or Telegram bot token is stored in this app.
