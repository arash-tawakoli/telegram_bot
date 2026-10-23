-- Cache official postal-code to municipality mappings used only when a provider location name is ambiguous.
CREATE TABLE IF NOT EXISTS public.geo_area_postal_codes (
  postal_code text NOT NULL CHECK (postal_code ~ '^[0-9]{5}$'),
  area_code text NOT NULL REFERENCES public.geo_areas(area_code) ON DELETE CASCADE,
  locality_name text NOT NULL DEFAULT '',
  source_name text NOT NULL DEFAULT 'OpenPLZ API',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (postal_code, area_code, locality_name)
);

CREATE INDEX IF NOT EXISTS geo_area_postal_codes_area_code_idx
  ON public.geo_area_postal_codes (area_code);

ALTER TABLE public.geo_area_postal_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.geo_area_postal_codes FROM anon, authenticated;
GRANT ALL ON TABLE public.geo_area_postal_codes TO service_role;

DO $validation$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='geo_area_postal_codes'
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein postal-code cache table was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.geo_areas
    WHERE state_code='SH' AND area_type='municipality' AND is_active
  ) THEN
    RAISE EXCEPTION 'Schleswig-Holstein official municipality geography is missing';
  END IF;
END;
$validation$;
