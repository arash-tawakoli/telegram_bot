CREATE SCHEMA app_private;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.listings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_id smallint,
 source_listing_key text,
 external_id text,
 canonical_url text,
 title text,
 address text,
 district text,
 postal_code text,
 city text,
 warm_rent numeric,
 cold_rent numeric,
 additional_costs numeric,
 operating_costs numeric,
 heating_costs numeric,
 deposit numeric,
 deposit_text text,
 rooms numeric,
 area_sqm numeric,
 available_from date,
 property_type text,
 furnished boolean,
 wbs_required boolean,
 image_url text,
 cross_source_hash text,
 raw jsonb,
 fresh_delivery_eligible boolean,
 last_seen_at timestamptz,
 is_active boolean,
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 enrichment_marker integer NOT NULL DEFAULT 0,
 UNIQUE(source_id,source_listing_key)
);
CREATE FUNCTION app_private.test_enrichment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.enrichment_marker := coalesce(OLD.enrichment_marker,0)+1;
 IF TG_OP='UPDATE' THEN NEW.fresh_delivery_eligible:=OLD.fresh_delivery_eligible; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_enrichment BEFORE INSERT OR UPDATE OF raw,warm_rent ON public.listings
FOR EACH ROW EXECUTE FUNCTION app_private.test_enrichment();

