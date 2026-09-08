Telegram button latency, 2026-09-08

Live telegram-ui v62 uses the existing prepare_telegram_update RPC instead of separate claim, user read, user write and subscription read. Instrumented original and modified handlers counted 4 versus 1 preparation requests. Empty callback acknowledgements run via EdgeRuntime.waitUntil alongside menu updates. Save/admin result acknowledgements remain awaited after their mutations. Auth, duplicate/busy handling, lease completion and premium overrides are covered by tests. Main menu fast routing remains unchanged.

89 tests passed; repository manifests validated. Live v62 retrieved and all seven files compared byte-for-byte with repository files. No test messages or artificial user updates sent. This verifies reduced sequential work, not an end-to-end latency guarantee on a user's phone.
