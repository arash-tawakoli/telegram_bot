import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

for(const path of [
 '../supabase/functions/telegram-ui/platform-sessions.js',
 '../supabase/functions/telegram-gateway/auto-apply.ts',
 '../supabase/functions/telegram-gateway/fast-ui.ts',
 '../supabase/functions/telegram-oauth-bridge/index.ts',
 '../cloudflare/housing-runtime/src/telegram-legacy/platform-sessions.js',
 '../supabase/functions/application-worker/index.ts',
 '../supabase/functions/application-worker/providers/router.ts'
]){
 test('Retired housing provider is unavailable: '+path,()=>{
  const src=readFileSync(new URL(path,import.meta.url),'utf8');
  if (path.includes('/cloudflare/housing-runtime/src/telegram-legacy/platform-sessions.js')) {
   // The unified applicant profile and source toggle are allowed, but private
   // Kleinanzeigen sending must remain gated until provider transport is verified.
   assert.match(src,/Kleinanzeigen · Versand noch nicht freigegeben/);
   assert.match(src,/providerSendEnabled/);
   assert.doesNotMatch(src,/login_share|complete_shared_login|probe_kleinanzeigen/i);
  } else {
   assert.doesNotMatch(src,/Kleinanzeigen|login_share|complete_shared_login|probe_kleinanzeigen/i);
  }
 });
}
