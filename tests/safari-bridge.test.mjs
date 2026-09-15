import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const provider=readFileSync(new URL('../supabase/functions/application-worker/providers/kleinanzeigen.ts',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../clients/safari-kleinanzeigen-bridge/extension/manifest.json',import.meta.url),'utf8'));
const callbackScript=readFileSync(new URL('../clients/safari-kleinanzeigen-bridge/extension/callback.js',import.meta.url),'utf8');

const callback='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';

test('Safari bridge is narrow-scope and never receives user credentials',()=>{
 assert.equal(manifest.manifest_version,3);
 assert.deepEqual(manifest.permissions,[]);
 assert.equal(manifest.background,undefined);
 assert.ok(manifest.host_permissions.includes(`${callback}*`));
 assert.ok(manifest.host_permissions.includes('https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/application-worker*'));
 assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
 assert.doesNotMatch(callbackScript,/document\.cookie|cookie_header|password\s*[:=]|authorization\s*[:=]|localStorage|sessionStorage/i);
 assert.match(callbackScript,/credentials:\s*'omit'/);
 assert.match(callbackScript,/callbackUrl/);
 assert.match(callbackScript,/fetch\(BRIDGE_ENDPOINT/);
});

test('bridge callback stays PKCE-bound and exact-target validated',()=>{
 assert.match(provider,/code_challenge_method:'S256'/);
 assert.match(provider,/flow\.code_verifier/);
 assert.match(provider,/validateCallbackTarget/);
 assert.match(provider,/state!==String\(flow\.state\)/);
 assert.match(provider,/consumed_at:new Date\(\)\.toISOString\(\)/);
});

test('public bridge endpoint is limited to the legacy Kleinanzeigen callback',()=>{
 assert.match(worker,/KLEIN_LEGACY_CALLBACK='https:\/\/login\.kleinanzeigen\.de\/android\/com\.ebay\.kleinanzeigen\/callback'/);
 assert.match(worker,/KLEIN_BRIDGE_ENDPOINT=`\$\{base\}\/functions\/v1\/application-worker\?oauth_bridge=kleinanzeigen`/);
 assert.match(worker,/completeKleinanzeigenCallback\(db,callbackUrl\)/);
 assert.match(worker,/cache-control':'no-store'/);
 assert.ok(worker.indexOf("oauth_bridge')==='kleinanzeigen'") < worker.indexOf("x-internal-secret"));
});

test('remote Browserless login is not part of application-worker anymore',()=>{
 assert.doesNotMatch(worker,/puppeteer|browserless|Browserless\.liveURL|production-ams\.browserless\.io/i);
});
