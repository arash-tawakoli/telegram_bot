import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../supabase/functions/kleinanzeigen-callback-bridge/index.ts',import.meta.url),'utf8');
const coach=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');
const telegram=readFileSync(new URL('../supabase/functions/telegram-oauth-bridge/index.ts',import.meta.url),'utf8');

test('beta login is explicit and hands off to remote Browser Run without share flow',()=>{
  assert.match(worker,/action==='login_beta_bridge'/);
  assert.match(worker,/transport:'remote-browser-handoff'/);
  assert.match(worker,/ticket/);
  assert.doesNotMatch(worker,/transport:'safari-extension-bridge'|transport:'beta-callback-helper'/);
});

test('coach and Telegram use the same remote Kleinanzeigen handoff URL',()=>{
  const route=/https:\/\/login\.traumwohnunghamburg\.de\/remote\/kleinanzeigen\/open\?ticket=/;
  assert.match(coach,route);
  assert.match(telegram,route);
  assert.doesNotMatch(coach,/navigator\.share|Abschluss-URL|clipboard/i);
  assert.doesNotMatch(telegram,/navigator\.share|Abschluss-URL|clipboard/i);
});

test('callback bridge remains PKCE/state bound and one time',()=>{
  assert.match(bridge,/CALLBACK_ORIGIN='https:\/\/login\.kleinanzeigen\.de'/);
  assert.match(bridge,/CALLBACK_PATH='\/android\/com\.ebay\.kleinanzeigen\/callback'/);
  assert.match(bridge,/eq\('provider','kleinanzeigen'\)/);
  assert.match(bridge,/is\('consumed_at',null\)/);
  assert.match(bridge,/code_verifier/);
  assert.match(bridge,/action:'complete_login'/);
});


test('coach-issued beta flows preserve the authenticated coach issuer',()=>{
  assert.match(coach,/issuedBy:a\.user\.id/);
  assert.match(worker,/origin==='coach'\?uuid\(body\.issuedBy\):null/);
  assert.match(provider,/issued_by:meta\?\.issuedBy\?String\(meta\.issuedBy\):null/);
});
