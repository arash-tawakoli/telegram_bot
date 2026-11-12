import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261101221736_personal_immoscout_auto_apply_test_mode.sql');
const worker = read('../supabase/functions/application-worker/index.ts');
const adapter = read('../supabase/functions/application-worker/providers/immoscout.ts');
const telegram = read('../supabase/functions/telegram-ui/platform-sessions.js');
const manifest = JSON.parse(read('../supabase/runtime-manifest.json'));
const registry = JSON.parse(read('../docs/migration-registry.d/20261101-personal-auto-apply-test-mode.json'));

test('personal test mode is opt-in and allowlisted for one Telegram owner', () => {
  assert.match(migration, /test_auto_apply_allowed boolean not null default false/i);
  assert.match(migration, /test_auto_apply_enabled boolean not null default false/i);
  assert.match(migration, /where telegram_user_id=8538226539/i);
  assert.match(migration, /test_auto_apply_enabled=false/i);
  assert.match(migration, /do \$owner\$[\s\S]*?end\s+\$owner\$;/i);
  assert.match(migration, /revoke all on function public\.set_application_test_mode\(uuid,bigint,boolean\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.set_application_test_mode\(uuid,bigint,boolean\) to service_role/i);
});

test('test mode uses the active applicant and search profiles without changing plugin preferences', () => {
  assert.match(worker, /application_profile_missing_fields',\s*\{p_user:userId\}/);
  assert.match(migration, /from public\.search_profiles s[\s\S]*?s\.user_id=p_user[\s\S]*?s\.is_active/i);
  assert.match(migration, /insert into public\.application_preferences[\s\S]*?values\(p_user,false,false,false,false,false\)/i);
  assert.doesNotMatch(migration, /update public\.application_preferences\s+set enabled=true/i);
  assert.doesNotMatch(migration, /delete from public\.platform_connections/i);
});

test('test mode bypasses participant plugins for ImmoScout only', () => {
  assert.match(migration, /then p_provider='immoscout'/);
  assert.match(migration, /return v_provider='immoscout'/);
  assert.match(migration, /jsonb_build_object\('test_mode',true\)/);
  assert.match(migration, /test_auto_apply_enabled[\s\S]*?not u\.auto_apply_enabled/);
  assert.match(worker, /testModeEnabled=user\.test_auto_apply_allowed===true&&user\.test_auto_apply_enabled===true&&user\.auto_apply_enabled!==true/);
  assert.match(worker, /test_mode_provider_blocked/);
});

test('personal test mode uses the central token without falling back to the participant plugin', () => {
  const start = adapter.indexOf('if(personalTestMode){');
  const end = adapter.indexOf('const connection=await getConnection(db,userId,PROVIDER)', start);
  assert.ok(start >= 0 && end > start, 'test-mode route must precede participant plugin lookup');
  const testRoute = adapter.slice(start, end);
  assert.match(testRoute, /getCentralImmoScoutConnection\(db\)/);
  assert.match(testRoute, /central\.row\.enabled!==false/);
  assert.match(testRoute, /return refreshCentral\(db,central,force\)/);
  assert.doesNotMatch(testRoute, /const connection=await getConnection\(db,userId,PROVIDER\)/);
});

test('test mode has a one-per-day real-send cap and preserves send windows', () => {
  assert.match(migration, /test_auto_apply_daily_limit integer not null default 1/i);
  assert.match(migration, /test_auto_apply_daily_limit between 1 and 5/i);
  assert.match(migration, /v_effective_daily_limit/);
  assert.match(migration, /q\.provider_state->>'test_mode'='true'/);
  assert.match(migration, /q\.quota_local_date=v_local_date[\s\S]*?q\.provider_state->>'test_mode'='true'/);
  assert.doesNotMatch(migration, /v_test_enabled_at|q\.created_at>=coalesce\(v_test_enabled_at/);
  assert.match(migration, /wait_reason='outside_send_window'/);
});

test('the normal global auto-apply switch cannot be enabled during the personal test', () => {
  assert.match(migration, /raise exception 'test_mode_active'/);
  assert.match(migration, /test_mode_global_auto_apply_active/);
});

test('Telegram exposes an owner-only Test Aktivieren/Deaktivieren control and test history', () => {
  assert.match(telegram, /state\.test_auto_apply_allowed===true/);
  assert.match(telegram, /Test Aktivieren/);
  assert.match(telegram, /Test Deaktivieren/);
  assert.match(telegram, /ImmoScout24 · Testzugang/);
  assert.match(telegram, /contains\('provider_state',\{test_mode:true\}\)/);
  assert.match(telegram, /Letzte Testbewerbungen/);
  assert.match(telegram, /Tageslimit/);
});

test('the migration registry records the exact migration content hash', () => {
  const hash = createHash('sha256').update(migration).digest('hex');
  const entry = registry.migrations.find(row => row.version === '20261101221736');
  assert.ok(entry, 'migration registry entry missing');
  assert.equal(entry.file, 'supabase/migrations/20261101221736_personal_immoscout_auto_apply_test_mode.sql');
  assert.equal(entry.registry_sql_sha256, hash);
  assert.equal(entry.export_sql_sha256, hash);
});

test('runtime manifest separates archived source versions from observed live deployments', () => {
  const app = manifest.functions.find(row => row.slug === 'application-worker');
  const ui = manifest.functions.find(row => row.slug === 'telegram-ui');
  const notifications = manifest.functions.find(row => row.slug === 'notification-dispatcher');
  assert.equal(notifications.observed_live_version, 366);
  assert.equal(notifications.observed_live_artifact_sha256, 'a0360c5cfb1affa17c1578806fa714a072ad3010dd4a1a4c2a8b8885b8466207');
  assert.ok(notifications.known_source_drift.some(row => row.path === 'supabase/functions/notification-dispatcher/index.ts' && row.reason.includes('archived')));
  assert.ok(notifications.known_source_drift.some(row => row.path === 'supabase/functions/notification-dispatcher/delivery-lease.ts' && row.reason.includes('archived')));
  const platformConnect = manifest.functions.find(row => row.slug === 'platform-connect-broker-v2');
  assert.ok(platformConnect.known_source_drift.some(row => row.path === 'supabase/functions/platform-connect-broker-v2/index.ts' && row.reason.includes('Not deployed')));
  const telegramOAuth = manifest.functions.find(row => row.slug === 'telegram-oauth-bridge');
  assert.ok(telegramOAuth.known_source_drift.some(row => row.path === 'supabase/functions/telegram-oauth-bridge/index.ts' && row.reason.includes('not deployed')));
  assert.equal(app.version, 336);
  assert.equal(app.observed_live_version, 337);
  assert.equal(app.observed_live_artifact_sha256, '07a7fc8709e9db2f2621f23a656bc13ce095534958b952d5a4230d0383f45334');
  assert.equal(ui.version, 385);
  assert.equal(ui.observed_live_version, 386);
  assert.equal(ui.observed_live_artifact_sha256, 'e25ca584f55a5b469a972b686d83ecf0564bbe71413cfa3a7fab24da335af146');
  assert.ok(app.known_source_drift.some(row => row.path === 'supabase/functions/application-worker/index.ts'));
  assert.ok(ui.known_source_drift.some(row => row.path === 'supabase/functions/telegram-ui/platform-sessions.js'));
  for (const fn of [app, ui]) {
    for (const file of fn.files) assert.equal(file.deployed_git_blob_sha, file.git_blob_sha);
  }
});
