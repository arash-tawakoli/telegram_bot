BEGIN;
SET LOCAL statement_timeout='20s';
DO $audit$
DECLARE
 payload jsonb; changed jsonb; result jsonb; before_row jsonb; after_row jsonb;
 listing_id uuid; new_id uuid; key text := 'efficiency-audit-'||gen_random_uuid()::text;
BEGIN
 SELECT to_jsonb(s) INTO payload FROM (SELECT source_id,source_listing_key,external_id,canonical_url,title,address,district,postal_code,city,warm_rent,cold_rent,additional_costs,operating_costs,heating_costs,deposit,deposit_text,rooms,area_sqm,available_from,property_type,furnished,wbs_required,image_url,cross_source_hash,raw,fresh_delivery_eligible,clock_timestamp() AS last_seen_at,is_active FROM public.listings WHERE source_id=13 AND is_active ORDER BY id LIMIT 1) s;
 IF payload IS NULL THEN RAISE EXCEPTION 'missing audit fixture'; END IF;
 PERFORM public.ingest_listing_batch(13::smallint,jsonb_build_array(payload));
 SELECT id,to_jsonb(l)-'last_seen_at'-'ingest_fingerprint' INTO listing_id,before_row
 FROM public.listings l WHERE source_id=13 AND source_listing_key=payload->>'source_listing_key';
 payload:=jsonb_set(payload,'{last_seen_at}',to_jsonb(clock_timestamp()+interval '1 second'));
 result:=public.ingest_listing_batch(13::smallint,jsonb_build_array(payload));
 IF result<> '{"seen":1,"fresh":0,"changed":0,"touched":1}'::jsonb THEN RAISE EXCEPTION 'heartbeat misclassified: %',result; END IF;
 SELECT to_jsonb(l)-'last_seen_at'-'ingest_fingerprint' INTO after_row FROM public.listings l WHERE id=listing_id;
 IF before_row IS DISTINCT FROM after_row THEN RAISE EXCEPTION 'heartbeat changed listing facts or eligibility'; END IF;
 changed:=jsonb_set(payload,'{title}',to_jsonb('Audit changed source title'::text));
 result:=public.ingest_listing_batch(13::smallint,jsonb_build_array(changed));
 IF result->>'changed'<>'1' OR result->>'fresh'<>'0' THEN RAISE EXCEPTION 'changed row misclassified'; END IF;
 payload:=payload||jsonb_build_object('source_listing_key',key,'fresh_delivery_eligible',false);
 result:=public.ingest_listing_batch(13::smallint,jsonb_build_array(payload));
 IF result->>'fresh'<>'1' THEN RAISE EXCEPTION 'new row misclassified'; END IF;
 SELECT id INTO new_id FROM public.listings WHERE source_id=13 AND source_listing_key=key;
 IF EXISTS(SELECT 1 FROM public.delivery_events WHERE public.delivery_events.listing_id=new_id)
 THEN RAISE EXCEPTION 'baseline audit listing queued for delivery'; END IF;
 BEGIN
   PERFORM public.ingest_listing_batch(8::smallint,jsonb_build_array(payload));
   RAISE EXCEPTION 'source isolation failed';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 PERFORM set_config('audit.invariants','heartbeat_facts_unchanged,changed_row_processed,new_row_counted,no_baseline_delivery,source_isolation',true);
END;
$audit$;
SELECT current_setting('audit.invariants') passed;
ROLLBACK;

