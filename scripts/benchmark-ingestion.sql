-- Run only in an authorized maintenance session. Replays roll back their data effects,
-- but still generate WAL and acquire short-lived listing locks. Not a load test.

-- Source 13: existing blind upsert.
BEGIN;
SET LOCAL statement_timeout='30s';
EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) WITH sample AS MATERIALIZED (SELECT source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,clock_timestamp() AS last_seen_at,is_active FROM public.listings WHERE source_id=13 AND is_active ORDER BY id LIMIT 100) INSERT INTO public.listings AS l (source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,last_seen_at,is_active) SELECT source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,last_seen_at,is_active FROM sample ON CONFLICT (source_id,source_listing_key) DO UPDATE SET external_id=EXCLUDED.external_id,canonical_url=EXCLUDED.canonical_url,title=EXCLUDED.title,address=EXCLUDED.address,district=EXCLUDED.district,postal_code=EXCLUDED.postal_code,city=EXCLUDED.city,warm_rent=EXCLUDED.warm_rent,cold_rent=EXCLUDED.cold_rent,additional_costs=EXCLUDED.additional_costs,operating_costs=EXCLUDED.operating_costs,heating_costs=EXCLUDED.heating_costs,deposit=EXCLUDED.deposit,deposit_text=EXCLUDED.deposit_text,rooms=EXCLUDED.rooms,area_sqm=EXCLUDED.area_sqm,available_from=EXCLUDED.available_from,property_type=EXCLUDED.property_type,furnished=EXCLUDED.furnished,wbs_required=EXCLUDED.wbs_required,image_url=EXCLUDED.image_url,cross_source_hash=EXCLUDED.cross_source_hash,raw=EXCLUDED.raw,fresh_delivery_eligible=EXCLUDED.fresh_delivery_eligible,last_seen_at=EXCLUDED.last_seen_at,is_active=EXCLUDED.is_active;
ROLLBACK;

-- Source 13: warm fingerprint, then repeated identical connector input.
BEGIN;
SET LOCAL statement_timeout='30s';
SELECT set_config('audit.ingest_payload',(SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,clock_timestamp() AS last_seen_at,is_active FROM public.listings WHERE source_id=13 AND is_active ORDER BY id LIMIT 100) s)::text,true);
SELECT public.ingest_listing_batch(13::smallint,current_setting('audit.ingest_payload')::jsonb);
EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON)
SELECT public.ingest_listing_batch(13::smallint,current_setting('audit.ingest_payload')::jsonb);
ROLLBACK;

-- Source 1: existing blind upsert.
BEGIN;
SET LOCAL statement_timeout='30s';
EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) WITH sample AS MATERIALIZED (SELECT source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,clock_timestamp() AS last_seen_at,is_active FROM public.listings WHERE source_id=1 AND is_active ORDER BY id LIMIT 100) INSERT INTO public.listings AS l (source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,last_seen_at,is_active) SELECT source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,last_seen_at,is_active FROM sample ON CONFLICT (source_id,source_listing_key) DO UPDATE SET external_id=EXCLUDED.external_id,canonical_url=EXCLUDED.canonical_url,title=EXCLUDED.title,address=EXCLUDED.address,district=EXCLUDED.district,postal_code=EXCLUDED.postal_code,city=EXCLUDED.city,warm_rent=EXCLUDED.warm_rent,cold_rent=EXCLUDED.cold_rent,additional_costs=EXCLUDED.additional_costs,operating_costs=EXCLUDED.operating_costs,heating_costs=EXCLUDED.heating_costs,deposit=EXCLUDED.deposit,deposit_text=EXCLUDED.deposit_text,rooms=EXCLUDED.rooms,area_sqm=EXCLUDED.area_sqm,available_from=EXCLUDED.available_from,property_type=EXCLUDED.property_type,furnished=EXCLUDED.furnished,wbs_required=EXCLUDED.wbs_required,image_url=EXCLUDED.image_url,cross_source_hash=EXCLUDED.cross_source_hash,raw=EXCLUDED.raw,fresh_delivery_eligible=EXCLUDED.fresh_delivery_eligible,last_seen_at=EXCLUDED.last_seen_at,is_active=EXCLUDED.is_active;
ROLLBACK;

-- Source 1: warm fingerprint, then repeated identical connector input.
BEGIN;
SET LOCAL statement_timeout='30s';
SELECT set_config('audit.ingest_payload',(SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,clock_timestamp() AS last_seen_at,is_active FROM public.listings WHERE source_id=1 AND is_active ORDER BY id LIMIT 100) s)::text,true);
SELECT public.ingest_listing_batch(1::smallint,current_setting('audit.ingest_payload')::jsonb);
EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON)
SELECT public.ingest_listing_batch(1::smallint,current_setting('audit.ingest_payload')::jsonb);
ROLLBACK;

