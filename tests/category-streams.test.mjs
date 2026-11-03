import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const category=readFileSync(new URL('../supabase/functions/source-worker/category.ts',import.meta.url),'utf8');
const categoryPersist=readFileSync(new URL('../supabase/functions/source-worker/category-persist.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20260920170532_enable_verified_category_streams.sql',import.meta.url),'utf8');

test('category discovery retains only the required housing adapters',()=>{
 assert.match(category,/stream\.adapter==='scout'/);
 assert.match(category,/stream\.adapter==='immowelt'/);
 assert.match(category,/stream\.adapter==='ohne-makler'/);
 assert.doesNotMatch(category,/kleinanzeigen|wg-gesucht|WG-Gesucht/i);
 assert.match(category,/method:'source_timestamp'/);
 assert.match(categoryPersist,/category_stream:category/);
 assert.match(categoryPersist,/old\?\.raw\?\.category_stream!==category/);
 assert.match(categoryPersist,/poll_delta/);
 assert.match(categoryPersist,/complete_snapshot_delta/);
 assert.match(categoryPersist,/stream\?\.baseline_at/);
 assert.match(categoryPersist,/86400000/);
});

test('category migration retains existing baseline and expiry safeguards',()=>{
 assert.doesNotMatch(migration,/baseline_at\s*=\s*null/i);
 assert.doesNotMatch(migration,/last_success_at\s*=\s*null/i);
 assert.match(migration,/whole_unit_misclassified_as_room/);
});
