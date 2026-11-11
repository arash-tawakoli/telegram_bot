import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const provider=readFileSync(new URL('../supabase/functions/application-worker/providers/kleinanzeigen.ts',import.meta.url),'utf8');

test('official web OAuth remains available while share is the fallback',()=>{
 assert.match(worker,/loginTransport:configured\?'direct-oauth-callback':'telegram-share-fallback'/);
 assert.match(worker,/action==='login_share'/);
 assert.match(worker,/oauth=kleinanzeigen/);
 assert.match(worker,/kleinanzeigen_oauth_client_id/);
 assert.match(worker,/completeKleinanzeigenCallback/);
});

test('OAuth authorization uses PKCE and exact redirect URI',()=>{
 assert.match(provider,/code_challenge_method:'S256'/);
 assert.match(provider,/redirect_uri:oauth\.redirectUri/);
 assert.match(provider,/oauth_client_id:oauth\.clientId/);
 assert.match(provider,/refresh_token/);
});

test('OAuth callback validates state before token exchange',()=>{
 assert.match(provider,/state!==String\(flow\.state\)/);
 assert.match(provider,/eq\('state',state\)/);
 assert.match(provider,/is\('consumed_at',null\)/);
 assert.match(provider,/gt\('expires_at'/);
 assert.match(provider,/validateCallbackTarget/);
});
