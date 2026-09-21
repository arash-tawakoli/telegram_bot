import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const category=readFileSync(new URL('../supabase/functions/source-worker/category.ts',import.meta.url),'utf8');
const klein=readFileSync(new URL('../supabase/functions/source-worker/klein.ts',import.meta.url),'utf8');
const categoryPersist=readFileSync(new URL('../supabase/functions/source-worker/category-persist.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20260920170532_enable_verified_category_streams.sql',import.meta.url),'utf8');

test('category discovery uses all verified production adapters',()=>{
  assert.match(category,/stream\.adapter==='scout'/);
  assert.match(category,/stream\.adapter==='kleinanzeigen'/);
  assert.match(category,/\['wg-gesucht','ohne-makler'\]\.includes\(stream\.adapter\)/);
  assert.match(category,/stream\.adapter==='immowelt'/);
  assert.match(category,/method:'source_timestamp'/);
  assert.match(categoryPersist,/category_stream:category/);
  assert.match(categoryPersist,/old\?\.raw\?\.category_stream!==category/);
  assert.match(categoryPersist,/poll_delta/);
  assert.match(categoryPersist,/complete_snapshot_delta/);
  assert.match(categoryPersist,/stream\?\.baseline_at/);
  assert.match(categoryPersist,/86400000/);
});

test('Kleinanzeigen apartment reconciliation cannot deactivate category rows',()=>{
  assert.match(klein,/property_kind\.is\.null,property_kind\.eq\.apartment/);
});

test('Kleinanzeigen room stream rejects complete apartments without a room signal',()=>{
  assert.match(klein,/wholeUnit/);
  assert.match(klein,/strongRoom/);
  assert.match(klein,/Zimmer\\b\.\{0,40\}\\bWohnung/);
});

test('category migration preserves baselines and reconciles all verified streams',()=>{
  for(const pair of ["(1::smallint,'house')","(2::smallint,'house')","(2::smallint,'room')","(6::smallint,'room')","(12::smallint,'house')"])
    assert.match(migration,new RegExp(pair.replace(/[()]/g,'\\$&')));
  assert.match(migration,/wg-zimmer\/k0c199l9409/);
  assert.doesNotMatch(migration,/baseline_at\s*=\s*null/i);
  assert.doesNotMatch(migration,/last_success_at\s*=\s*null/i);
  assert.match(migration,/whole_unit_misclassified_as_room/);
});
