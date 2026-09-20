import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/source-worker/category-streams.ts',import.meta.url),'utf8');
const index=readFileSync(new URL('../supabase/functions/source-worker/index.ts',import.meta.url),'utf8');
const klein=readFileSync(new URL('../supabase/functions/source-worker/klein.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20260920183500_enable_verified_category_streams.sql',import.meta.url),'utf8');

test('category discovery stays isolated from apartment inventory',()=>{
  assert.match(worker,/category_stream: category/);
  assert.match(worker,/_classification:\s*\{ version: "1", kind, mode: "rent" \}/);
  assert.match(worker,/method: "source_timestamp"/);
  assert.match(index,/runCategoryStreams\(s\)/);
});

test('fresh delivery is impossible before the category baseline',()=>{
  assert.match(worker,/const eligible = stream\.baseline_at\s*\? parsed\.items\.filter\(isRecent\)\s*:\s*\[\]/);
});

test('only verified Kleinanzeigen house and room streams are enabled',()=>{
  assert.match(migration,/where source_id=2 and adapter='kleinanzeigen' and category in \('house','room'\)/);
  assert.doesNotMatch(migration,/source_id=1[^;]*enabled=true/s);
  assert.doesNotMatch(migration,/source_id=6[^;]*enabled=true/s);
  assert.doesNotMatch(migration,/source_id=12[^;]*enabled=true/s);
});


test('apartment coverage cannot deactivate independent house or room rows',()=>{
  assert.match(klein,/property_kind\.is\.null,property_kind\.eq\.apartment/);
});
