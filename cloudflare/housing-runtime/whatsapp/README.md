# WhatsApp notifications (WAHA Core)

WAHA Core has no per-message fee. It is an unofficial WhatsApp Web client that carries number-suspension risk. It must run on a persistent Docker host, **not** directly in a Cloudflare Worker. Hosting and electricity may cost money.

## Setup

1. Apply the D1 migration in schema/d1/0031_whatsapp_delivery.sql before enabling.
2. On the always-on host, copy env.example to .env. Generate strong random secrets, then run docker compose up -d.
3. Publish WAHA behind HTTPS (for example, through a secure reverse proxy or Cloudflare Tunnel). Protect its dashboard and API; the compose file binds it to localhost.
4. Pair a **dedicated** WhatsApp number by scanning the QR code in the WAHA dashboard. Ensure the default session and the configured message webhook are active.
5. Add Cloudflare bindings to the housing runtime:
   * WAHA_BASE_URL: HTTPS origin of the reachable WAHA server with trailing slash (var).
   * WAHA_SENDER_NUMBER: paired number, digits only, no plus sign (var).
   * WAHA_SESSION: default (var).
   * WAHA_API_KEY: same secret as Docker (Worker secret).
   * WAHA_WEBHOOK_HMAC_KEY: same as WHATSAPP_HOOK_HMAC_KEY (Worker secret).
   * WAHA_ENABLED: 1 only after migrations, pairing and smoke tests (var).
6. A user opens the existing Telegram Mini App under Profil and selects WhatsApp verbinden. They send the prefilled START code to the WAHA number. That one-time code expires after 30 minutes. Only new matches are delivered automatically. Send STOP by WhatsApp or use WhatsApp trennen to disable.

The Worker reuses existing matching and offers. Each channel has its own delivery status; Telegram behavior is unchanged. WAHA calls POST /api/sendText with X-Api-Key. Incoming POST /edge/whatsapp/webhook messages are verified with raw-body HMAC-SHA512. Messages are disabled by default and never sent without opt-in. Five notifications maximum per minute are processed. Failed/unknown outcomes are not blindly retried.

The status sent means accepted by WAHA, not necessarily delivered to the recipient. Run npm run check && npm test before enabling, then test with a spare WhatsApp number. Do not assume a free always-on server or permanent WhatsApp availability.
