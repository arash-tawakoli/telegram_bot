import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const handlers = read('../supabase/functions/telegram-ui/handlers.js');
const runtime = read('../supabase/functions/telegram-ui/runtime.js');
const admin = read('../supabase/functions/_shared/telegram-admin.ts');
const facade = read('../supabase/functions/auth-facade-broker/index.ts');
const participantAuth = read('../supabase/functions/immoscout-auth-bridge/index.ts');
const credentials = read('../supabase/functions/application-worker/credentials.ts');
const adapter = read('../supabase/functions/application-worker/providers/immoscout.ts');
const worker = read('../cloudflare/housing-runtime/src/immoscout-central-token.js');
const schema = read('../supabase/migrations/20261103172212_immoscout_central_token_postgres.sql');
const housingRuntime = read('../cloudflare/housing-runtime/src/index.js');
const d1Compat = read('../cloudflare/housing-runtime/src/d1-compat.js');
const runtimeConfig = read('../cloudflare/housing-runtime/wrangler.jsonc');

test('the /token command is visible and executable only for Telegram admins', () => {
  const publicCommands = handlers.match(/const PUBLIC_COMMANDS = \[([\s\S]*?)\];/)?.[1] || '';
  const adminCommands = handlers.match(/const ADMIN_COMMANDS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(publicCommands, /command: "token"/);
  assert.match(adminCommands, /command: "token"/);
  assert.match(handlers, /if \(command === "\/token"\)\s*\{\s*if \(!isAdmin\(user\)\)/);
  assert.match(admin, /8538226539/);
  assert.match(admin, /414638980/);
  assert.match(runtime, /ADMIN_TELEGRAM_USER_IDS/);
});

test('Telegram controls the Cloudflare token vault without manual Supabase table configuration', () => {
  assert.match(handlers, /centralImmoScoutApi\("\/internal\/start", "POST"/);
  assert.match(handlers, /centralImmoScoutApi\("\/internal\/status"\)/);
  assert.match(handlers, /centralImmoScoutApi\("\/internal\/enable", "POST"/);
  assert.match(handlers, /immoscout_central_cloudflare_api_secret/);
  assert.doesNotMatch(handlers, /platform_auth_flows/);
  assert.doesNotMatch(handlers, /get_immoscout_central_credential_status/);
  assert.doesNotMatch(handlers, /set_immoscout_central_enabled/);
});

test('Cloudflare owns central OAuth flow, PKCE, MFA and admin validation', () => {
  assert.match(worker, /ADMIN_IDS = new Set/);
  assert.match(worker, /\/internal\/start/);
  assert.match(worker, /\/internal\/resolve/);
  assert.match(worker, /\/internal\/password_login/);
  assert.match(worker, /\/internal\/mfa_start/);
  assert.match(worker, /\/internal\/mfa_verify/);
  assert.match(worker, /code_challenge_method: "S256"/);
  assert.match(worker, /MFA_AAD/);
  assert.match(worker, /flowState/);
  assert.match(worker, /verifiedEmail !== ACCOUNT_EMAIL/);
  assert.match(worker, /ACCOUNT_EMAIL = "arash@nexalabs\.de"/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS app_private.immoscout_central_oauth_flows/);
});

test('the facade proxies central ImmoScout flows to Cloudflare while participant OAuth stays unchanged', () => {
  assert.match(facade, /state\.startsWith\('cfcentral_'\)/);
  assert.match(facade, /isTelegramAdminUser/);
  assert.match(facade, /centralImmoScoutApi\('\/internal\/password_login'/);
  assert.match(facade, /centralImmoScoutApi\('\/internal\/mfa_start'/);
  assert.match(facade, /centralImmoScoutApi\('\/internal\/mfa_verify'/);
  assert.match(facade, /centralImmoScoutApi\('\/internal\/status'/);
  assert.doesNotMatch(participantAuth, /centralImmoScout|central_account/);
  assert.match(facade, /scoutPublic\(\{action:'password_login'/);
});

test('central credentials are encrypted in PostgreSQL and protected by the Cloudflare housing runtime', () => {
  assert.match(worker, /name: "AES-GCM"/);
  assert.match(worker, /CREDENTIAL_AAD = "nexalabs:immoscout:central:v1"/);
  assert.match(worker, /TOKEN_ENCRYPTION_KEY/);
  assert.match(worker, /API_SECRET/);
  assert.match(worker, /INSERT INTO central_credentials/);
  assert.match(worker, /\/internal\/credentials/);
  assert.match(schema, /enabled smallint NOT NULL DEFAULT 0/);
  assert.match(schema, /ciphertext text NOT NULL/);
  assert.match(credentials, /immoscout_central_cloudflare_api_secret/);
  assert.match(credentials, /\/internal\/credentials/);
  assert.match(credentials, /\/internal\/store/);
});

test('central auto-apply is opt-in; participant OAuth remains fallback and contact email remains participant-owned', () => {
  assert.match(schema, /enabled smallint NOT NULL DEFAULT 0/);
  assert.match(worker, /\/internal\/enable/);
  assert.match(adapter, /getCentralImmoScoutConnection/);
  assert.match(adapter, /refreshCentral/);
  assert.match(adapter, /central\.row\.enabled===true/);
  assert.match(adapter, /const connection=await getConnection\(db,userId,PROVIDER\)/);
  assert.match(adapter, /emailaddress:\(\)=>clean\(profile\?\.email,320\)\|\|null/);
  assert.match(adapter, /CENTRAL_ACCOUNT_EMAIL/);
});

test('central refresh preserves activation and revalidates the NexaLabs account', () => {
  assert.match(credentials, /preserveEnabled=true/);
  assert.match(worker, /preserveEnabled \? 1 : 0/);
  assert.match(adapter, /USERINFO='https:\/\/login\.immobilienscout24\.de/);
  assert.match(adapter, /info\?\.email\|\|''\)\.trim\(\)\.toLowerCase\(\)!==CENTRAL_ACCOUNT_EMAIL/);
  assert.match(credentials, /markCentralImmoScoutConnection/);
});

test('the PostgreSQL schema contains the central vault, audit log and short-lived OAuth flows', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS app_private.immoscout_central_credentials/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS app_private.immoscout_central_audit_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS app_private.immoscout_central_oauth_flows/);
  assert.match(worker, /cache-control": "no-store"/);
});

test('central OAuth finalization failures are diagnosable and pre-code failures can retry the same flow', () => {
  assert.match(worker, /central_immoscout_request_failed/);
  assert.match(worker, /oauth_failed:\$\{stage\}:\$\{code\}/);
  assert.match(worker, /releaseFlow\(env, flow\)/);
  assert.match(worker, /stage === "authorize"/);
  assert.match(worker, /authorization_code_missing/);
  assert.match(worker, /authorization_code_missing/);
  assert.match(worker, /oauth_login_failed/);
  assert.match(worker, /token_exchange_failed/);
  assert.match(facade, /'login_failed'/);
  assert.match(facade, /'token_exchange_failed'/);
});


test('central ImmoScout OAuth requests the OIDC email claim used for account verification', () => {
  assert.match(worker, /const SCOPE = "openid profile email offline_access"/);
  assert.match(worker, /scope: SCOPE/);
  assert.match(worker, /validEmail\(info\.body\?\.email\)/);
  assert.match(worker, /verifiedEmail !== ACCOUNT_EMAIL/);
});


test('central refresh test is admin-only, requires auto-apply disabled and preserves that state', () => {
  assert.match(worker, /async function refreshCredentialsForTest/);
  assert.match(worker, /if \(!ADMIN_IDS\.has\(String\(adminId \|\| ""\)\)\) throw new Error\("admin_required"\)/);
  assert.match(worker, /if \(row\.enabled !== 0\) throw new Error\("auto_apply_must_be_disabled"\)/);
  assert.match(worker, /grant_type: "refresh_token"/);
  assert.match(worker, /refresh_test_succeeded/);
  assert.match(worker, /WHERE \?=0 OR central_credentials\.enabled=0/);
  assert.match(worker, /path === "\/internal\/refresh-test"/);
  assert.match(handlers, /mode === "testen" \|\| mode === "refresh-test"/);
  assert.match(handlers, /Auto-Bewerbung: <b>weiterhin deaktiviert<\/b>/);
  assert.match(handlers, /Es wurde keine Bewerbung versendet/);
});

test('all central ImmoScout callers use the housing runtime, not the legacy D1 Worker', () => {
  const endpoint = 'https://traumwohnung-housing-runtime.arash-ce5.workers.dev';
  for (const source of [handlers, credentials, facade]) {
    assert.ok(source.includes(endpoint));
    assert.doesNotMatch(source, /immoscout-central-token-staging\.arash-ce5\.workers\.dev/);
  }
  assert.match(housingRuntime, /createD1Compat\(sql\)/);
  assert.match(housingRuntime, /app_private\.get_housing_runtime_secret/);
  assert.match(d1Compat, /app_private\.immoscout_central_credentials/);
  assert.match(housingRuntime, /migrateLegacyCentralToken/);
  assert.match(housingRuntime, /env\.LEGACY_D1/);
  assert.match(housingRuntime, /verifyLegacyD1SnapshotKey/);
  assert.doesNotMatch(housingRuntime, /immoscout-central-token-staging\.arash-ce5\.workers\.dev/);
  assert.match(runtimeConfig, /"preview_urls": true/);
  assert.match(runtimeConfig, /"binding": "LEGACY_D1"/);
  assert.match(runtimeConfig, /"binding": "HYPERDRIVE"/);
});
