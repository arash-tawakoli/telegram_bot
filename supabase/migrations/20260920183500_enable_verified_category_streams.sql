set local lock_timeout='3s';
set local statement_timeout='30s';

-- Enable only category streams whose public source timestamp is independently
-- available. First successful run establishes the baseline; pre-baseline rows
-- cannot become delivery eligible later.
update app_private.source_category_streams
set url=case category
      when 'house' then 'https://www.kleinanzeigen.de/s-haus-mieten/hamburg/anzeige:angebote/c205l9409?sortingField=SORTING_DATE'
      when 'room' then 'https://www.kleinanzeigen.de/s-auf-zeit-wg/hamburg/anzeige:angebote/c199l9409?sortingField=SORTING_DATE'
      else url end,
    enabled=true,
    verified_at=now(),
    baseline_at=null,
    last_started_at=null,
    last_success_at=null,
    last_error=null,
    failures=0,
    cursor='{}'::jsonb,
    lease_token=null,
    lease_until=null,
    poll_minutes=3
where source_id=2 and adapter='kleinanzeigen' and category in ('house','room');

update public.sources
set search_capabilities =
  coalesce(search_capabilities,'{}'::jsonb) ||
  jsonb_build_object(
    'version',1,
    'configured_kinds',jsonb_build_array('apartment','house','room'),
    'offer_modes',jsonb_build_array('rent'),
    'evidence','verified_category_streams',
    'category_streams',jsonb_build_array('house','room'),
    'additional_kinds_require_evidence',true
  ),
  updated_at=now()
where id=2;
