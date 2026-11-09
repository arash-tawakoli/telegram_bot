-- Add the missing provider-specific AutoApply preference to Cloudflare D1.
-- Existing participant and preference rows are preserved.
ALTER TABLE application_preferences ADD COLUMN kleinanzeigen_enabled INTEGER NOT NULL DEFAULT 0;
