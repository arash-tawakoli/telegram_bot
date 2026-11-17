# WAHA with Cloudflare only

This optional WhatsApp sender is **NOT LIVE**. WAHA is an unofficial WhatsApp Web client. It has no WhatsApp message fees but carries a phone-number suspension risk. Total Cloudflare cost is usage-based and cannot be guaranteed below $12.

## Architecture

- Housing Worker: existing search, matching, D1 and Telegram.
- WAHA Worker + Container: cloudflare/waha-server/ (GOWS, no Chromium).
- WAHA's session filesystem: Cloudflare Container snapshots (beta); periodic 15-minute checkpoint and manual checkpoint after phone pairing.
- GitHub: code storage and pull requests only. Builds and deployments exclusively by **Cloudflare Workers Builds**. No GitHub Actions or external runners.

## Setup checklist

1. Keep the draft PR unmerged while checking the monthly Cloudflare budget. The account has no Container application and the Housing Worker has no Cloudflare Builds trigger as of 2026-11-17.
2. Connect the `telegram_bot` GitHub repo in Cloudflare Workers & Pages > Workers Builds. Create **a separate** Workers Builds project for `cloudflare/waha-server`. Select that as the root directory. Configure production deploy command `npx wrangler deploy`. Do not deploy the Housing Worker feature branch to its production environment.
3. The standalone Worker starts with `WAHA_ENABLED=0`. Store `WAHA_API_KEY` and `WAHA_WEBHOOK_HMAC_KEY` as Worker secrets; the same values are needed as the Housing Worker secrets `WAHA_API_KEY` and `WAHA_WEBHOOK_HMAC_KEY` respectively.
4. Deploy the WAHA Worker via **Cloudflare Workers Builds**. The Cloudflare Container image is based on `devlikeapro/waha:gows`. The instance is initially disabled, so it has no active runtime charge until enabled.
5. Set `WAHA_ENABLED=1` **only for a controlled trial**. The GOWS Container runs with 0.125 vCPU / 512 MiB RAM / 2 GB disk and is kept awake by a one-minute Cloudflare Cron Trigger. Monitor memory, CPU, restarts, and costs.
6. With `X-Api-Key` (only on a trusted connection), create/start the `default` WAHA session using the WAHA sessions REST API. Fetch `GET /api/default/auth/qr` with the same header, scan with a **dedicated WhatsApp account** under Linked Devices, and verify session status. Immediately save a snapshot through the Worker-internal checkpoint; the cron later snapshots every 15 minutes.
7. Apply `cloudflare/housing-runtime/schema/d1/0031_whatsapp_delivery.sql` to production D1 only when safe to release.
8. Set Housing Worker variables `WAHA_BASE_URL=https://<deployed-waha-worker-domain>/`, `WAHA_SENDER_NUMBER=<dedicated-number-digits-only>`, `WAHA_SESSION=default`, and `WAHA_ENABLED=1` after end-to-end testing. Set the Housing Worker `WAHA_API_KEY` and `WAHA_WEBHOOK_HMAC_KEY` secrets to the matching WAHA Worker values.
9. End user opens Telegram Mini App > Profil > WhatsApp verbinden and sends the one-time prefilled START message from their WhatsApp number. STOP cancels. Existing Telegram delivery remains intact.

## Reliability and cost limitations

The Cloudflare-only proof of concept uses Container snapshots (public beta), not a permanently mounted WAHA database. Cloudflare may terminate active containers and restore them on another host. Snapshot creation/restoration and actual WAHA behavior must be tested under load. A changed container image requires a new snapshot; images and snapshots cannot be mixed freely.

30-day, 24/7 **estimated** Cloudflare cost (included $5 Workers Paid fee, 2GB disk, 512MiB RAM, after included usage; excludes existing Workers/D1/DO, logs, and additional network charges):
- 0.025 average vCPU: ~$9.17
- 0.05 average vCPU: ~$10.47
- 0.10 average vCPU: ~$13.06
- 0.125 average vCPU: ~$14.36

A hard account-wide $12 cap is **not guaranteed** by Cloudflare budget alerts or Worker spend limits. If $12 is a strict total ceiling for all housing infrastructure, a continuously running WAHA Container may not fit. Do not enable blindly.

Cloudflare docs: https://developers.cloudflare.com/containers/ , https://developers.cloudflare.com/containers/guides/snapshots/ , https://developers.cloudflare.com/workers/ci-cd/builds/
WAHA docs: https://waha.devlike.pro/docs/how-to/sessions/ , https://waha.devlike.pro/docs/overview/faq/
