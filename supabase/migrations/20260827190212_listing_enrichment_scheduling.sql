select cron.schedule(
  'listing-enricher-every-10-seconds',
  '10 seconds',
  $$select net.http_post(
      url:='https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/listing-enricher',
      headers:=jsonb_build_object('Content-Type','application/json','x-internal-secret',public.get_bot_secret('internal_worker_secret')),
      body:='{"qty":6}'::jsonb,
      timeout_milliseconds:=30000
    ) as request_id;$$
);

select cron.schedule(
  'listing-enrichment-backfill-every-minute',
  '* * * * *',
  $$select app_private.enqueue_stale_listing_enrichment(30);$$
);

select cron.schedule(
  'source-field-capability-refresh-every-15-minutes',
  '*/15 * * * *',
  $$select app_private.refresh_source_field_capabilities();$$
);
