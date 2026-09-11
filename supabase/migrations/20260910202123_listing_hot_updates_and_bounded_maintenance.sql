-- Preserve exact observations while allowing HOT updates to last_seen_at.
SET lock_timeout = '2s';
SET statement_timeout = '30s';
CREATE INDEX listings_active_source_idx ON public.listings (source_id) WHERE is_active;
CREATE INDEX listings_dedupe_url_idx ON public.listings (canonical_url)
  WHERE is_active AND quality_status <> 'rejected' AND dedupe_group_id IS NOT NULL;
CREATE INDEX listings_dedupe_address_idx ON public.listings (app_private.normalized_listing_address(address))
  WHERE is_active AND quality_status <> 'rejected' AND dedupe_group_id IS NOT NULL;
DROP INDEX public.listings_quality_status_idx;
DROP INDEX public.listings_active_idx;
DROP INDEX public.listings_primary_active_idx;
DROP INDEX public.listings_enrichment_status_idx;
DROP INDEX public.listings_image_status_idx;
ALTER TABLE public.listings SET (fillfactor = 85);

-- Compare final values after BEFORE triggers, including indirect changes.
DROP TRIGGER listings_capture_product_changes ON public.listings;
CREATE TRIGGER listings_capture_product_changes AFTER UPDATE ON public.listings
FOR EACH ROW WHEN (
  ROW(OLD.warm_rent,OLD.cold_rent,OLD.deposit,OLD.rooms,OLD.area_sqm,OLD.available_from,OLD.canonical_url,OLD.is_active)
  IS DISTINCT FROM
  ROW(NEW.warm_rent,NEW.cold_rent,NEW.deposit,NEW.rooms,NEW.area_sqm,NEW.available_from,NEW.canonical_url,NEW.is_active)
) EXECUTE FUNCTION app_private.capture_listing_changes();
-- Replayed/older observations do not create another row version.
-- touched retains its API count of unchanged input rows observed.
CREATE OR REPLACE FUNCTION public.ingest_listing_batch(p_source_id smallint, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  result jsonb;
  allowed_keys constant text[] := ARRAY['source_id','source_listing_key','external_id','canonical_url','title','address','district','postal_code','city','warm_rent','cold_rent','additional_costs','operating_costs','heating_costs','deposit','deposit_text','rooms','area_sqm','available_from','property_type','furnished','wbs_required','image_url','cross_source_hash','raw','fresh_delivery_eligible','last_seen_at','is_active'];
BEGIN
  IF p_source_id IS NULL OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'source and listing array are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > 100 THEN
    RAISE EXCEPTION 'listing batch exceeds 100 rows' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('seen',0,'fresh',0,'changed',0,'touched',0);
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) x
    WHERE jsonb_typeof(x) <> 'object'
  ) THEN
    RAISE EXCEPTION 'every listing must be an object' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) x
    WHERE (x->>'source_id')::smallint IS DISTINCT FROM p_source_id
      OR coalesce(length(btrim(x->>'source_listing_key')),0) NOT BETWEEN 1 AND 500
      OR coalesce(jsonb_typeof(x->'raw'),'null') <> 'object'
      OR (x->>'last_seen_at')::timestamptz IS NULL
      OR (x->>'is_active')::boolean IS DISTINCT FROM true
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(x) k WHERE NOT k = ANY(allowed_keys))
  ) OR (
    SELECT count(*) <> count(DISTINCT x->>'source_listing_key') FROM jsonb_array_elements(p_rows) x
  ) THEN
    RAISE EXCEPTION 'invalid listing batch, source mismatch or duplicate key' USING ERRCODE = '22023';
  END IF;

  -- Serialize batches for the same provider, not the entire ingestion pipeline.
  PERFORM pg_catalog.pg_advisory_xact_lock(913247, p_source_id::integer);
  -- Also coordinate with legacy/direct writers before classifying existing rows.
  PERFORM 1 FROM public.listings l
  WHERE l.source_id = p_source_id
    AND l.source_listing_key IN (SELECT x->>'source_listing_key' FROM jsonb_array_elements(p_rows) x)
  ORDER BY l.id FOR UPDATE;

  WITH input AS MATERIALIZED (
    SELECT jsonb_populate_record(NULL::public.listings, x) AS r,
      pg_catalog.sha256(pg_catalog.convert_to((x - 'last_seen_at')::text,'UTF8')) AS fingerprint
    FROM jsonb_array_elements(p_rows) x
  ), classified AS MATERIALIZED (
    SELECT i.r, i.fingerprint, l.id,
      coalesce(l.ingest_fingerprint = i.fingerprint AND l.is_active,false) AS unchanged
    FROM input i LEFT JOIN public.listings l
      ON l.source_id = p_source_id AND l.source_listing_key = (i.r).source_listing_key
  ), touched AS (
    UPDATE public.listings l SET last_seen_at = greatest(l.last_seen_at,(c.r).last_seen_at)
    FROM classified c WHERE c.unchanged AND l.id = c.id
      AND (l.last_seen_at IS NULL OR l.last_seen_at < (c.r).last_seen_at)
    RETURNING l.id
  ), written AS (
    INSERT INTO public.listings AS l (source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,last_seen_at,is_active,ingest_fingerprint)
    SELECT (c.r).source_id,(c.r).source_listing_key,(c.r).external_id,(c.r).canonical_url,(c.r).title,(c.r).address,(c.r).district,(c.r).postal_code,(c.r).city,(c.r).warm_rent,(c.r).cold_rent,(c.r).additional_costs,(c.r).operating_costs,(c.r).heating_costs,(c.r).deposit,(c.r).deposit_text,(c.r).rooms,(c.r).area_sqm,(c.r).available_from,(c.r).property_type,(c.r).furnished,(c.r).wbs_required,(c.r).image_url,(c.r).cross_source_hash,(c.r).raw,(c.r).fresh_delivery_eligible,(c.r).last_seen_at,(c.r).is_active,c.fingerprint
    FROM classified c WHERE NOT c.unchanged
    ON CONFLICT (source_id,source_listing_key) DO UPDATE SET
      external_id = EXCLUDED.external_id,
      canonical_url = EXCLUDED.canonical_url,
      title = EXCLUDED.title,
      address = EXCLUDED.address,
      district = EXCLUDED.district,
      postal_code = EXCLUDED.postal_code,
      city = EXCLUDED.city,
      warm_rent = EXCLUDED.warm_rent,
      cold_rent = EXCLUDED.cold_rent,
      additional_costs = EXCLUDED.additional_costs,
      operating_costs = EXCLUDED.operating_costs,
      heating_costs = EXCLUDED.heating_costs,
      deposit = EXCLUDED.deposit,
      deposit_text = EXCLUDED.deposit_text,
      rooms = EXCLUDED.rooms,
      area_sqm = EXCLUDED.area_sqm,
      available_from = EXCLUDED.available_from,
      property_type = EXCLUDED.property_type,
      furnished = EXCLUDED.furnished,
      wbs_required = EXCLUDED.wbs_required,
      image_url = EXCLUDED.image_url,
      cross_source_hash = EXCLUDED.cross_source_hash,
      raw = EXCLUDED.raw,
      fresh_delivery_eligible = EXCLUDED.fresh_delivery_eligible,
      last_seen_at = greatest(l.last_seen_at,EXCLUDED.last_seen_at),
      is_active = EXCLUDED.is_active,
      ingest_fingerprint = EXCLUDED.ingest_fingerprint
    RETURNING (xmax = 0) AS inserted
  )
  SELECT jsonb_build_object(
    'seen',(SELECT count(*) FROM input),
    'fresh',(SELECT count(*) FROM written WHERE inserted),
    'changed',(SELECT count(*) FROM written),
    'touched',(SELECT count(*) FROM classified WHERE unchanged)
  ) INTO result;
  RETURN result;
END;
$function$
;
RESET lock_timeout;
RESET statement_timeout;
