DELETE FROM supabase_archive_rows
WHERE table_name NOT IN (
  'sources',
  'source_connectors',
  'cooperative_provider_registry',
  'geo_areas',
  'geo_area_aliases',
  'geo_area_postal_codes',
  'hamburg_boroughs',
  'hamburg_neighborhoods'
);

DROP TABLE IF EXISTS telegram_saved_effects;
DROP TABLE IF EXISTS saved_listings;
