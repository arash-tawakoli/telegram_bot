import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
test('retired provider login and callback endpoints are absent',()=>{
 assert.doesNotMatch(worker,/Kleinanzeigen|kleinanzeigen|login_share|complete_shared_login|oauth=kleinanzeigen/i);
 assert.match(worker,/provider_unsupported/);
});
