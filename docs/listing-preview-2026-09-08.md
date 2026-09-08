# Listing preview: source facts and all images

Costs, dates, floor and property type were incomplete in previews; image delivery stopped after its first success. GitHub also lagged the deployed dispatcher v39 and three source-worker adapters. This change retains those deployed fixes and completes the preview path.

- Read property-owned structured data, explicit HTML fact labels and scoped JSON-LD. Direct source values override stale database values. Hide missing fields and calculated warm rent without explicit source evidence.
- Fetch ImmoMio's anonymous public property detail query (the same query used on its apply page) to obtain all public image attachments, rent components, deposit, floor and availability. Retain complete homepage listing nodes during ingestion.
- Use ImmoSolve's existing API detail snapshot, including all image filenames. Its presentation page contains translation templates, which must never overwrite the API values.
- Address text comes only from explicit source address fields. Preserve full address strings verbatim; join structured components without inventing a city, changing spelling or deriving streets from descriptions. Respect hidden addresses. Legacy inferred addresses and default property types are not presentation fallbacks.
- Send every collected image in albums of up to ten, and keep all facts and action buttons in an accompanying text message. One-image short previews remain a photo with caption. Long captions no longer discard images.
- Store frozen per-event operations and confirmed progress in `delivery_events.preview_progress`. Resume after confirmed errors. Ambiguous Telegram outcomes and failed acknowledgement persistence retain the existing no-automatic-resend protection. Reuse existing RLS/service-role-only access and dispatcher lease checks.

Validation: 82 Node tests, including source extraction, placeholders, zero values, hidden addresses, half rooms, galleries exceeding ten images, upload fallback, retry checkpoints and uncertain outcomes. Read-only deployed preview checks against current ImmoMio and ImmoSolve listings returned respectively 3 and 8 images. No test messages were sent to recipients.

Applied migration: 20260908045835_listing_preview_delivery_progress. Runtime: notification-dispatcher v41; source-worker v58.

Scope limits: Public source fields must be reachable and in a supported format. Source-side access failures and permanently invalid image URLs cannot be guaranteed; their send errors remain visible and retryable. This does not establish exhaustive coverage of every field across all 65 providers. Existing Telegram messages are not retrospectively edited or resent.
