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
 '../supabase/functions/application-worker/providers/router.ts',
 '../supabase/functions/coach-api/index.ts'
]){
 test('Retired housing provider is unavailable: '+path,()=>{
  const src=readFileSync(new URL(path,import.meta.url),'utf8');
  assert.doesNotMatch(src,/Kleinanzeigen|login_share|complete_shared_login|probe_kleinanzeigen/i);
 });
}
