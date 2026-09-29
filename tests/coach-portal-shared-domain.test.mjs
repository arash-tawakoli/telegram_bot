import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const coach=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');
const autoApply=readFileSync(new URL('../supabase/functions/telegram-gateway/auto-apply.ts',import.meta.url),'utf8');
const oauth=readFileSync(new URL('../supabase/functions/telegram-oauth-bridge/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20260922114316_unify_coach_portal_telegram_domain_logic.sql',import.meta.url),'utf8');
const parity=readFileSync(new URL('../supabase/migrations/20260929002703_sync_coach_portal_telegram_parity.sql',import.meta.url),'utf8');

test('coach portal and Telegram share premium and search-profile domain rules',()=>{
  assert.match(coach,/coach_effective_premium_status/);
  assert.match(coach,/coach_save_search_profile/);
  assert.match(migration,/app_private\.save_search_profile_values/);
  assert.match(migration,/public\.save_search_profile_ui/);
  assert.match(migration,/public\.coach_save_search_profile/);
});

test('global AutoApply state is written through the shared application_preferences writer',()=>{
  assert.match(autoApply,/set_application_enabled_shared/);
  assert.match(autoApply,/prefs\.enabled\?'⏸ Auto-Bewerbung pausieren'/);
  assert.match(migration,/public\.set_application_enabled_shared/);
});

test('Telegram provider login uses the same central connect surface as the coach portal',()=>{
  assert.match(oauth,/https:\/\/login\.traumwohnunghamburg\.de\/connect\?ticket=/);
  assert.match(oauth,/platform_auth_flows/);
  assert.match(coach,/https:\/\/login\.traumwohnunghamburg\.de\/connect\?ticket=/);
});

test('coach provider login is gated by effective premium, not plan_override UI state',()=>{
  assert.match(coach,/premium=await effectivePremium/);
  assert.match(coach,/premium_required/);
});


test('coach AutoApply writes use the same shared global and provider writers as Telegram',()=>{
  assert.match(parity,/set_application_provider_enabled_shared/);
  assert.match(parity,/set_application_enabled_shared/);
  assert.match(coach,/p_immowelt:Boolean\(p\.immowelt_enabled\)/);
  assert.doesNotMatch(coach,/application_preferences'\)\.update\(\{immowelt_enabled/);
});

test('coach platform parity includes Immowelt across analytics and filtering',()=>{
  assert.match(coach,/\['immoscout','kleinanzeigen','immomio','immowelt'\]/);
  assert.match(coach,/immowelt:0,unknown:0/);
  assert.match(coach,/connections=\{immoscout:0,kleinanzeigen:0,immomio:0,immowelt:0\}/);
});

test('coach Kleinanzeigen login follows the same capability based direct-or-share decision',()=>{
  assert.match(coach,/kleinanzeigenOAuthClientProvisioned/);
  assert.match(coach,/direct\?'login':'login_share'/);
  assert.match(coach,/shareFlow:!direct/);
});
