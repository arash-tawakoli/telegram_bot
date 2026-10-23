-- Repair the staged Schleswig-Holstein source after its first adapter verification.
-- The later baseline guard migration keeps delivery in shadow until coverage is complete.
UPDATE public.sources
SET enabled=true,
    runtime_mode='live',
    delivery_mode='live',
    poll_interval_minutes=60,
    last_checked_at=coalesce(last_checked_at,now()),
    notes='Separate Schleswig-Holstein coverage via the verified ImmoScout24 MCP adapter. Only listings resolved to an active Schleswig-Holstein municipality or independent-city code are ingested.',
    updated_at=now()
WHERE id=69
  AND search_capabilities->>'region_state_code'='SH';
DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sources
    WHERE id=69 AND enabled=true AND runtime_mode='live'
      AND delivery_mode='live' AND poll_interval_minutes=60
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein source delivery-mode repair failed';
  END IF;
END;
$validation$;
