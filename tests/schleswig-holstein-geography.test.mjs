import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Schleswig-Holstein geography catalog is complete and internally consistent", async () => {
  const catalog = JSON.parse(await read("../docs/geography/schleswig-holstein-municipalities.json"));
  const migration = await read("../supabase/migrations/20261022210000_add_schleswig_holstein_geography.sql");
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
});

test("listing ingestion persists and validates state-aware geography", async () => {
  const migration = await read("../supabase/migrations/20261022210000_add_schleswig_holstein_geography.sql");
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
});

test("Telegram and source adapters expose Schleswig-Holstein without changing Hamburg scope", async () => {
  const profiles = await read("../supabase/functions/telegram-ui/profiles.js");
  const handlers = await read("../supabase/functions/telegram-ui/handlers.js");
  const runtime = await read("../supabase/functions/telegram-ui/runtime.js");
  const scout = await read("../supabase/functions/source-worker/scout.ts");
  const klein = await read("../supabase/functions/source-worker/klein.ts");
  const immowelt = await read("../supabase/functions/source-worker/generic.ts");
  const shared = await read("../supabase/functions/source-worker/shared.ts");

  for (const mode of ["all_schleswig_holstein", "schleswig_holstein_areas"]) {
    assert.ok(profiles.includes(mode));
    assert.ok(handlers.includes(mode));
  }
  assert.ok(runtime.includes("schleswigHolsteinAreas"));
  assert.ok(scout.includes("Wohnungen zur Miete in Schleswig-Holstein"));
  assert.ok(klein.includes("s-schleswig-holstein/wohnung-mieten"));
  assert.ok(immowelt.includes("https://www.immowelt.de/suche/mieten/wohnung/schleswig-holstein/ad04de1"));
  assert.ok(immowelt.includes("wg-gesucht.de"));
  assert.ok(immowelt.includes("stateCode:'SH'"));
  assert.ok(immowelt.includes("resolveSchleswigHolsteinMunicipality(city)"));
  assert.ok(shared.includes("state_code: stateCode"));
  assert.ok(shared.includes("resolveSchleswigHolsteinMunicipality"));
});
