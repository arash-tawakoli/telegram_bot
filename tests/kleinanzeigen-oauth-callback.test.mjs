import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const provider=readFileSync(new URL('../supabase/functions/application-worker/providers/kleinanzeigen.ts',import.meta.url),'utf8');

test('production Kleinanzeigen login stays direct OAuth while beta helper is explicit',()=>{
 assert.match(worker,/loginTransport:configured\?'direct-oauth-callback':'not-provisioned'/);
 assert.match(worker,/action==='login_beta_bridge'/);
 assert.match(worker,/transport:'remote-browser-handoff'/);
 assert.match(worker,/oauth=kleinanzeigen/);
 assert.match(worker,/kleinanzeigen_oauth_client_id/);
 assert.match(worker,/oauth_client_not_provisioned/);
 assert.match(worker,/completeKleinanzeigenCallback/);
 assert.doesNotMatch(worker,/safari-extension-bridge|oauth_bridge=kleinanzeigen|Browserless\.liveURL|puppeteer/);
});

test('OAuth authorization uses PKCE and configured redirect URI',()=>{
 assert.match(provider,/code_challenge_method:'S256'/);
 assert.match(provider,/redirect_uri:oauth\.redirectUri/);
 assert.match(provider,/oauth_client_id:oauth\.clientId/);
 assert.match(provider,/refresh_token/);
});

test('OAuth callback validates state before exchanging tokens',()=>{
 assert.match(provider,/state!==String\(flow\.state\)/);
 assert.match(provider,/eq\('state',state\)/);
 assert.match(provider,/is\('consumed_at',null\)/);
 assert.match(provider,/gt\('expires_at'/);
 assert.match(provider,/validateCallbackTarget/);
});
