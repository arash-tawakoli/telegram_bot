import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const provider=readFileSync(new URL('../supabase/functions/application-worker/providers/kleinanzeigen.ts',import.meta.url),'utf8');

test('Kleinanzeigen login has no active Safari/share bridge fallback',()=>{
 assert.doesNotMatch(worker,/oauth_bridge'\)==='kleinanzeigen'/);
 assert.doesNotMatch(worker,/transport:'safari-extension-bridge'/);
 assert.doesNotMatch(worker,/kleinanzeigenBridgeEndpoint/);
});

test('direct OAuth stays PKCE-bound and state validated',()=>{
 assert.match(provider,/code_challenge_method:'S256'/);
 assert.match(provider,/flow\.code_verifier/);
 assert.match(provider,/validateCallbackTarget/);
 assert.match(provider,/state!==String\(flow\.state\)/);
 assert.match(provider,/consumed_at:new Date\(\)\.toISOString\(\)/);
});

test('remote browser login is not part of application-worker',()=>{
 assert.doesNotMatch(worker,/puppeteer|browserless|Browserless\.liveURL|production-ams\.browserless\.io/i);
});
