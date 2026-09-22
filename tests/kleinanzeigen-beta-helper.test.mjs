import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../supabase/functions/kleinanzeigen-callback-bridge/index.ts',import.meta.url),'utf8');
const helper=readFileSync(new URL('../clients/safari-kleinanzeigen-bridge/extension/callback.js',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../clients/safari-kleinanzeigen-bridge/extension/manifest.json',import.meta.url),'utf8'));

test('beta login is explicit and does not re-enable share flow',()=>{
  assert.match(worker,/action==='login_beta_bridge'/);
  assert.match(worker,/transport:'beta-callback-helper'/);
  assert.doesNotMatch(worker,/transport:'safari-extension-bridge'/);
});

test('callback bridge only accepts the registered Kleinanzeigen callback path',()=>{
  assert.match(bridge,/CALLBACK_ORIGIN='https:\/\/login\.kleinanzeigen\.de'/);
  assert.match(bridge,/CALLBACK_PATH='\/android\/com\.ebay\.kleinanzeigen\/callback'/);
  assert.match(bridge,/eq\('provider','kleinanzeigen'\)/);
  assert.match(bridge,/is\('consumed_at',null\)/);
  assert.match(bridge,/code_verifier/);
  assert.match(bridge,/action:'complete_login'/);
});

test('helper has narrow permissions and no credential access',()=>{
  assert.deepEqual(manifest.permissions,[]);
  assert.ok(manifest.host_permissions.includes('https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback*'));
  assert.ok(manifest.host_permissions.includes('https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-callback-bridge*'));
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  assert.doesNotMatch(helper,/document\.cookie|localStorage|sessionStorage|password/i);
  assert.match(helper,/credentials:\s*'omit'/);
  assert.match(helper,/kleinanzeigen-callback-bridge/);
  assert.doesNotMatch(helper,/Telegram →|navigator\.share|clipboard/);
});
