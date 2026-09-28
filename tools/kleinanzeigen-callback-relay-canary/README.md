# Kleinanzeigen Callback Relay - Admin Canary

This canary changes **no production OAuth logic**. It only replaces the manual transport of the existing Kleinanzeigen callback URL on the browser where the extension is installed.

## Flow

1. Start the existing Kleinanzeigen login from Telegram.
2. Log in normally.
3. When Kleinanzeigen reaches the existing Android callback URL, the extension detects it.
4. The extension POSTs the full callback URL to the existing `kleinanzeigen-callback-bridge`.
5. The existing bridge validates the callback and calls the existing `application-worker`.
6. The existing PKCE token exchange stores the connection.
7. Telegram sends the existing success notification.

The manual **Share -> Telegram** flow remains available as fallback.

## Canary scope

Install this extension only in the admin test browser. No other Telegram user is affected.

## Install in Chrome / Edge

1. Open the browser's extensions page.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this folder.
5. Start the existing Kleinanzeigen connection from Telegram and log in normally.

A successful relay sets the extension badge to **OK**. A relay failure sets it to **!**.

## Rollback

Remove or disable the extension. No backend rollback is required because no production code path is replaced.
