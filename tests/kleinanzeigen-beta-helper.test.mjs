import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const coach=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');
const telegram=readFileSync(new URL('../supabase/functions/telegram-oauth-bridge/index.ts',import.meta.url),'utf8');

test('temporary operational fallback is share-to-Telegram, not remote Browser Run',()=>{
 assert.match(worker,/action==='login_share'/);
 assert.match(worker,/bridgeRequired:true/);
 assert.match(worker,/automaticCallback:false/);
 assert.match(coach,/share_flow:true/);
 assert.match(telegram,/share_flow:true/);
 assert.doesNotMatch(coach,/remote_browser_handoff|remote\/kleinanzeigen\/open/);
 assert.doesNotMatch(telegram,/remote_browser_handoff|remote\/kleinanzeigen\/open/);
});

test('coach-issued share flows preserve the authenticated coach issuer',()=>{
 assert.match(coach,/issuedBy:a\.user\.id/);
 assert.match(worker,/origin==='coach'\?uuid\(body\.issuedBy\):null/);
});
