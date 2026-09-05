import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../supabase/functions/source-worker/shared.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function normalize(');
const end = source.indexOf('export async function upsertCandidates', start);
assert.ok(start >= 0 && end > start, 'normalization function must be present');
const normalize = vm.runInNewContext(stripTypeScriptTypes(source.slice(start, end)) + ';normalize;', {
  URL, String, Number, saneRooms: value => value ?? null,
  iso: () => '2026-09-05T00:00:00Z', sha: async () => { throw new Error('unexpected hash fallback'); },
});

test('Wunderflats tracking changes preserve stable listing identity', async () => {
  const a = await normalize({ id: 10 }, { url: 'https://wunderflats.com/de/moebliertes-apartment/test-id?dataLayerKey=first' }, true);
  const b = await normalize({ id: 10 }, { url: 'https://wunderflats.com/de/moebliertes-apartment/test-id?dataLayerKey=second' }, true);
  assert.equal(a.source_listing_key, 'test-id');
  assert.equal(a.source_listing_key, b.source_listing_key);
  assert.equal(a.canonical_url, b.canonical_url);
  assert.equal(new URL(a.canonical_url).searchParams.has('dataLayerKey'), false);
});

test('Wunderflats preserves explicit provider IDs and unrelated query parameters', async () => {
  const row = await normalize({ id: 10 }, { key: 'provider-id', url: 'https://wunderflats.com/de/moebliertes-apartment/test-id?dataLayerKey=x&language=de' }, false);
  assert.equal(row.source_listing_key, 'provider-id');
  assert.equal(new URL(row.canonical_url).searchParams.get('language'), 'de');
  assert.equal(row.fresh_delivery_eligible, false);
});
