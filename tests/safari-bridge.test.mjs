import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
test('retired provider Safari and OAuth bridges remain disabled',()=>{
 assert.doesNotMatch(worker,/oauth_bridge=kleinanzeigen|safari-extension-bridge|transport:'telegram-share'|complete_shared_login/);
});
