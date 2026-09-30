import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const provider=readFileSync(new URL('../supabase/functions/application-worker/providers/kleinanzeigen.ts',import.meta.url),'utf8');

test('temporary share flow does not re-enable Safari extension bridge',()=>{
 assert.doesNotMatch(worker,/oauth_bridge=kleinanzeigen|safari-extension-bridge/);
 assert.match(worker,/transport:'telegram-share'/);
});

test('share completion remains PKCE/state bound and one time',()=>{
 assert.match(provider,/code_challenge_method:'S256'/);
 assert.match(provider,/flow\.code_verifier/);
 assert.match(provider,/validateCallbackTarget/);
 assert.match(provider,/state!==String\(flow\.state\)/);
 assert.match(provider,/is\('consumed_at',null\)/);
 assert.match(provider,/await claimPlatformConnectFlow\(db,flow\)/);
 assert.match(provider,/await completePlatformConnectFlow\(db,flow,/);
});
