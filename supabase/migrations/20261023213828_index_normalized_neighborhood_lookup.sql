-- The source-health report normalizes each active listing's district.
-- This expression index lets normalize_hamburg_neighborhood use an index instead of repeatedly scanning all neighborhoods.
CREATE INDEX IF NOT EXISTS hamburg_neighborhoods_normalized_name_idx
  ON public.hamburg_neighborhoods (lower(trim(name)));
