import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Schleswig-Holstein geography catalog is complete and internally consistent", async () => {
  const catalog = JSON.parse(await read("../docs/geography/schleswig-holstein-municipalities.json"));
  const migration = await read("../supabase/migrations/20261023094810_add_schleswig_holstein_geography.sql");
  assert.equal(catalog.source_vintage, "2026-01-01");
  assert.equal(catalog.count, 1104);
  assert.equal(catalog.municipalities.length, catalog.count);

  const codes = new Set(catalog.municipalities.map((area) => area.code));
  assert.equal(codes.size, catalog.count, "municipality AGS codes must be unique");
  assert.ok(catalog.municipalities.every((area) => /^01\d{6}$/.test(area.code)));
  assert.ok(catalog.municipalities.every((area) => area.parent === area.code.slice(0, 5)));

  const regionCodes = new Set(
    [...migration.matchAll(/\('([0-9]{5})','SH','SH','(?:county|independent_city)'/g)].map((match) => match[1]),
  );
  assert.equal(regionCodes.size, 15, "four independent cities and eleven counties must be seeded");
  assert.ok(catalog.municipalities.every((area) => regionCodes.has(area.parent)), "every municipality must have a seeded parent region");
  assert.ok(migration.includes("'all_schleswig_holstein'"));
  assert.ok(migration.includes("'schleswig_holstein_areas'"));
  assert.ok(migration.includes("https://www.wg-gesucht.de/wohnungen-in-Schleswig-Holstein.0.2.1.0.html"));
  assert.ok(migration.includes("('Garstedt','01060063','Stadt Norderstedt locality alias')"));
  assert.ok(migration.includes("false,'K2','primary',false,true"), "the WG-Gesucht SH lane must remain disabled until the new worker is deployed");
  assert.ok(migration.includes("priority >= 1 and priority <= 4"), "the dedicated fourth connector lane must be allowed by the connector priority constraint");
  assert.equal(catalog.municipalities.find((area) => area.name === "Norderstedt")?.code, "01060063");
  const ingestEnd = migration.indexOf("$function$;", start);
  const connectorSeed = migration.indexOf("-- Add a separate state-wide WG-Gesucht lane");
  assert.ok(ingestEnd > start && connectorSeed > ingestEnd, "the ingestion function must be terminated before the connector seed");
  assert.ok(migration.includes("public.get_schleswig_holstein_areas()"));
  assert.ok(migration.includes("returns jsonb"), "the catalog RPC must avoid the PostgREST 1,000-row cap");
  assert.ok(migration.includes("jsonb_agg(jsonb_build_object("), "the complete geography catalog must be returned in one JSONB value");
  assert.ok(migration.includes("public.get_schleswig_holstein_area_aliases()"));
  assert.ok(migration.includes("grant execute on function public.get_schleswig_holstein_areas() to service_role"));
  assert.ok(migration.includes("revoke all on table public.geo_areas, public.geo_area_aliases from PUBLIC, anon, authenticated"));
});

test("listing ingestion persists and validates state-aware geography", async () => {
  const migration = await read("../supabase/migrations/20261023094810_add_schleswig_holstein_geography.sql");
  const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.ingest_listing_batch_v3");
  const end = migration.indexOf("\ncommit;", start);
  assert.ok(start >= 0 && end > start, "migration must replace the canonical ingestion RPC");
  const ingest = migration.slice(start, end);

  for (const field of ["state_code", "admin_region_code", "municipality_code"]) {
    assert.ok(ingest.includes("'" + field + "'"), field + " must be accepted by the ingestion allowlist");
    assert.ok(ingest.includes(field + " = excluded." + field) || ingest.includes(field + ","));
  }
  assert.ok(ingest.includes("municipality.parent_code=x->>'admin_region_code'"));
  assert.ok(ingest.includes("municipality.area_type='municipality'"));
  assert.ok(ingest.includes("coalesce((c.r).state_code,'HH')"), "legacy workers that omit state_code must continue ingesting Hamburg listings");
  assert.ok(migration.includes("p.location_mode='all_hamburg' and coalesce(l.state_code,'HH')='HH'"));
  assert.ok(migration.includes("p.location_mode='all_schleswig_holstein' and l.state_code='SH'"));
});

test("Telegram and source adapters expose Schleswig-Holstein without changing Hamburg scope", async () => {
  const profiles = await read("../supabase/functions/telegram-ui/profiles.js");
  const handlers = await read("../supabase/functions/telegram-ui/handlers.js");
  const runtime = await read("../supabase/functions/telegram-ui/runtime.js");
  const scout = await read("../supabase/functions/source-worker/scout.ts");
  const klein = await read("../supabase/functions/source-worker/klein.ts");
  const immowelt = await read("../supabase/functions/source-worker/generic.ts");
  const shared = await read("../supabase/functions/source-worker/shared.ts");
  const immomio = await read("../supabase/functions/source-worker/immomio.ts");
  const coachApi = await read("../supabase/functions/coach-api/index.ts");

  for (const mode of ["all_schleswig_holstein", "schleswig_holstein_areas"]) {
    assert.ok(profiles.includes(mode));
    assert.ok(handlers.includes(mode));
  }
  assert.ok(handlers.includes('onboarding_step === "schleswig_holstein_search"'));
  assert.ok(handlers.includes('data === "shsearch:start"'));
  assert.ok(handlers.includes('data.startsWith("shsearch:pick:")'));
  assert.ok(handlers.includes("location_area_search_return_step"), "text search must restore the previous onboarding step after a result is selected");
  assert.ok(handlers.includes("await saveState(user.id, returnStep, { ...draft }"), "search selection must persist the restored draft without clearing it");
  assert.ok(handlers.includes("geo.schleswigHolsteinAliases"));
  assert.ok(runtime.includes("schleswigHolsteinAreas"));
  assert.ok(runtime.includes('db.rpc("get_schleswig_holstein_areas")'));
  assert.ok(runtime.includes('db.rpc("get_schleswig_holstein_area_aliases")'));
  assert.ok(!runtime.includes('db.from("geo_areas")'), "Telegram should use the service-only geography RPC");
  assert.ok(scout.includes("Wohnungen zur Miete in Schleswig-Holstein"));
  assert.ok(klein.includes("s-schleswig-holstein/wohnung-mieten"));
  assert.ok(klein.includes("city=stateCode==='SH'?(loc.match"), "Kleinanzeigen SH city resolution must parse the listing location, not the whole card text");
  assert.ok(immowelt.includes("https://www.immowelt.de/suche/mieten/wohnung/schleswig-holstein/ad04de1"));
  assert.ok(migration.includes("https://www.wg-gesucht.de/wohnungen-in-Schleswig-Holstein.0.2.1.0.html"), "WG-Gesucht is configured through its own source connector, not the Immowelt adapter");
  assert.ok(immowelt.includes("stateCode:'SH'"));
  assert.ok(immowelt.includes("resolveSchleswigHolsteinMunicipality(city)"));
  assert.ok(immowelt.includes("schleswig_holstein_fresh_lane"), "WG-Gesucht SH must run independently of the existing Hamburg pagination cursor");
  assert.ok(immowelt.includes("source.id === 6"));
  assert.ok(immowelt.includes("region_state_code"));
  assert.ok(shared.includes("state_code: stateCode"));
  assert.ok(shared.includes("resolveSchleswigHolsteinMunicipality"));
  assert.ok(shared.includes("schleswig_holstein_geography_resolution_skips"), "ambiguous/unmapped public listing locations must be observable, not silently swallowed");
  assert.ok(shared.includes('db.rpc("get_schleswig_holstein_areas")'));
  assert.ok(shared.includes('db.rpc("get_schleswig_holstein_area_aliases")'));
  assert.ok(!shared.includes('db.from("geo_areas")'), "source worker should use the service-only geography RPC");
  assert.ok(immomio.includes("get_schleswig_holstein_areas"));
  assert.ok(immomio.includes("get_schleswig_holstein_area_aliases"));
  assert.ok(coachApi.includes("get_schleswig_holstein_areas"));
  assert.ok(coachApi.includes("get_schleswig_holstein_area_aliases"));
});
