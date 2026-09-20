set local lock_timeout='3s';
set local statement_timeout='30s';

-- Reconcile the already verified production category streams into migration history.
-- Preserve live baselines and health timestamps; a fresh environment will warm each
-- stream before any category listing can qualify for delivery.
update app_private.source_category_streams
set enabled=true,
    verified_at=coalesce(verified_at,now()),
    poll_minutes=5
where (source_id,category) in (
  (1::smallint,'house'),
  (2::smallint,'house'),
  (2::smallint,'room'),
  (6::smallint,'room'),
  (12::smallint,'house')
);

-- Narrow Kleinanzeigen room discovery to the WG-Zimmer query while preserving the
-- existing baseline. Parser-side guards additionally reject complete apartments.
update app_private.source_category_streams
set url='https://www.kleinanzeigen.de/s-auf-zeit-wg/hamburg/wg-zimmer/k0c199l9409?sortingField=SORTING_DATE'
where source_id=2 and category='room' and adapter='kleinanzeigen';

update public.sources
set search_capabilities=case id
  when 1 then jsonb_build_object(
    'version',2,'configured_kinds',jsonb_build_array('apartment','house'),
    'offer_modes',jsonb_build_array('rent'),'evidence','verified_category_stream',
    'discovery','public_search_or_inventory','category_streams',jsonb_build_array('house'),
    'additional_kinds_require_evidence',true)
  when 2 then jsonb_build_object(
    'version',2,'configured_kinds',jsonb_build_array('apartment','house','room'),
    'offer_modes',jsonb_build_array('rent'),'evidence','verified_category_stream',
    'discovery','public_search_or_inventory','category_streams',jsonb_build_array('house','room'),
    'additional_kinds_require_evidence',true)
  when 6 then jsonb_build_object(
    'version',2,'configured_kinds',jsonb_build_array('apartment','room'),
    'offer_modes',jsonb_build_array('rent'),'evidence','verified_category_stream',
    'discovery','public_search_or_inventory','category_streams',jsonb_build_array('room'),
    'additional_kinds_require_evidence',true)
  when 12 then jsonb_build_object(
    'version',2,'configured_kinds',jsonb_build_array('apartment','house'),
    'offer_modes',jsonb_build_array('rent'),'evidence','verified_category_stream',
    'discovery','public_search_or_inventory','category_streams',jsonb_build_array('house'),
    'additional_kinds_require_evidence',true)
  else search_capabilities
end,
updated_at=now()
where id in (1,2,6,12);

-- Remove previously misclassified complete apartments from the WG inventory.
update public.listings
set is_active=false,
    fresh_delivery_eligible=false,
    quality_status='rejected',
    quality_reason='whole_unit_misclassified_as_room'
where source_id=2
  and raw->>'category_stream'='room'
  and is_active
  and (
    title ~* '[0-9]+([.,][0-9]+)?[ -]?Zimmer.{0,40}Wohnung'
    or title ~* '(^|[^[:alpha:]])Apartment([^[:alpha:]]|$)'
    or title ~* '(gesamte|komplette)[[:space:]]+(Unterkunft|Wohnung)'
  )
  and title !~* 'WG([ -]?Zimmer)?|Privatzimmer|Mitbewohner|Untermiet(e|er)?';
