import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const coach=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');
const telegram=readFileSync(new URL('../supabase/functions/telegram-oauth-bridge/index.ts',import.meta.url),'utf8');
test('retired provider share flows no longer exist',()=>{
 for(const source of [worker,coach,telegram])assert.doesNotMatch(source,/login_share|share_flow:true|remote\/kleinanzeigen\/open/);
});
