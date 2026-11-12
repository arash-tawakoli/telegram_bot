import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const category=readFileSync(new URL('../supabase/functions/source-worker/category.ts',import.meta.url),'utf8');
const reminder=readFileSync(new URL('../supabase/functions/platform-session-reminder/index.ts',import.meta.url),'utf8');
test('WG-Gesucht is absent from source category execution and account reminders',()=>{
 assert.doesNotMatch(category,/wg-gesucht|wgGesucht|WgGesucht/i);
 assert.doesNotMatch(reminder,/wg_gesucht|wg-gesucht|WG-Gesucht/i);
 assert.match(category,/unsupported category adapter/);
});
