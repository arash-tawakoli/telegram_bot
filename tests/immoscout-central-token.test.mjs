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
const worker = read('../cloudflare/immoscout-central-token-staging/index.js');
const schema = read('../cloudflare/immoscout-central-token-staging/schema.sql');

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
  assert.match(schema, /CREATE TABLE IF NOT EXISTS oauth_flows/);
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

test('central credentials are encrypted in Cloudflare D1 and protected by Worker Secrets', () => {
  assert.match(worker, /name: "AES-GCM"/);
  assert.match(worker, /CREDENTIAL_AAD = "nexalabs:immoscout:central:v1"/);
  assert.match(worker, /TOKEN_ENCRYPTION_KEY/);
  assert.match(worker, /API_SECRET/);
  assert.match(worker, /INSERT INTO central_credentials/);
  assert.match(worker, /\/internal\/credentials/);
  assert.match(schema, /enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(schema, /ciphertext TEXT NOT NULL/);
  assert.match(credentials, /immoscout_central_cloudflare_api_secret/);
  assert.match(credentials, /\/internal\/credentials/);
  assert.match(credentials, /\/internal\/store/);
});

test('central auto-apply is opt-in; participant OAuth remains fallback and contact email remains participant-owned', () => {
  assert.match(schema, /enabled INTEGER NOT NULL DEFAULT 0/);
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

test('the Cloudflare D1 schema contains the central vault, audit log and short-lived OAuth flows', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS central_credentials/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS audit_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS oauth_flows/);
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
  assert.match(facade, /'oauth_login_failed'/);
  assert.match(facade, /'token_exchange_failed'/);
});


test('central ImmoScout OAuth requests the OIDC email claim used for account verification', () => {
  assert.match(worker, /const SCOPE = "openid profile email offline_access"/);
  assert.match(worker, /scope: SCOPE/);
  assert.match(worker, /validEmail\(info\.body\?\.email\)/);
  assert.match(worker, /verifiedEmail !== ACCOUNT_EMAIL/);
});
