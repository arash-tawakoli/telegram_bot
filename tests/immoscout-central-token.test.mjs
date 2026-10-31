import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const handlers = read('../supabase/functions/telegram-ui/handlers.js');
const runtime = read('../supabase/functions/telegram-ui/runtime.js');
const admin = read('../supabase/functions/_shared/telegram-admin.ts');
const facade = read('../supabase/functions/auth-facade-broker/index.ts');
const auth = read('../supabase/functions/immoscout-auth-bridge/index.ts');
const credentials = read('../supabase/functions/application-worker/credentials.ts');
const adapter = read('../supabase/functions/application-worker/providers/immoscout.ts');
const migration = read('../supabase/migrations/20261031233000_immoscout_central_d1_wrapper.sql');
const d1Schema = read('../cloudflare/immoscout-central-token-staging/schema.sql');

test('the /token command is exposed only in the admin Telegram command scope', () => {
  const publicCommands = handlers.match(/const PUBLIC_COMMANDS = \[([\s\S]*?)\];/)?.[1] || '';
  const adminCommands = handlers.match(/const ADMIN_COMMANDS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(publicCommands, /command: "token"/);
  assert.match(adminCommands, /command: "token"/);
  assert.match(handlers, /if \(command === "\/token"\)\s*\{\s*if \(!isAdmin\(user\)\)/);
  assert.match(runtime, /import \{ ADMIN_TELEGRAM_USER_IDS \} from "\.\.\/_shared\/telegram-admin\.ts"/);
  assert.match(admin, /8538226539/);
  assert.match(admin, /414638980/);
});

test('central OAuth is bound to the NexaLabs admin and exact ImmoScout account', () => {
  assert.match(handlers, /db\.from\("platform_auth_flows"\)\.insert/);
  assert.match(handlers, /central_account: true/);
  assert.match(handlers, /account_hint: "arash@nexalabs\.de"/);
  assert.match(facade, /flow\.context\?\.central_account===true/);
  assert.match(facade, /isTelegramAdminUser/);
  assert.match(auth, /function isCentralFlow/);
  assert.match(auth, /isTelegramAdminUser/);
  assert.match(auth, /CENTRAL_ACCOUNT_EMAIL='arash@nexalabs\.de'/);
  assert.match(auth, /verifiedEmail!==CENTRAL_ACCOUNT_EMAIL/);
});

test('Supabase connects to Cloudflare D1 through the private D1 wrapper server', () => {
  assert.match(migration, /server immoscout_central_staging/);
  assert.match(migration, /options \(\s*table 'central_credentials',\s*rowid_column 'singleton'/);
  assert.match(migration, /options \(\s*table 'audit_events',\s*rowid_column 'id'/);
  assert.match(migration, /app_private\.immoscout_central_credentials/);
  assert.match(migration, /revoke all on app_private\.immoscout_central_credentials from public, anon, authenticated/);
  assert.match(migration, /revoke all on app_private\.immoscout_central_audit_events from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_immoscout_central_credentials\(\) to service_role/);
  assert.match(migration, /grant execute on function public\.store_immoscout_central_credentials/);
  assert.match(d1Schema, /enabled INTEGER NOT NULL DEFAULT 0/);
});

test('central OAuth credentials are AES-GCM encrypted before D1 storage', () => {
  assert.match(auth, /name:'AES-GCM'/);
  assert.match(auth, /nexalabs:immoscout:central:v1/);
  assert.match(auth, /store_immoscout_central_credentials/);
  assert.match(credentials, /name:'AES-GCM'/);
  assert.match(credentials, /nexalabs:immoscout:central:v1/);
  assert.match(credentials, /get_immoscout_central_credentials/);
  assert.match(credentials, /store_immoscout_central_credentials/);
  assert.doesNotMatch(auth, /immoscout-central-token-staging\.arash-ce5\.workers\.dev/);
  assert.doesNotMatch(credentials, /immoscout-central-token-staging\.arash-ce5\.workers\.dev/);
});

test('central token is used only when explicitly enabled; participant OAuth remains fallback', () => {
  assert.match(handlers, /get_immoscout_central_credential_status/);
  assert.match(handlers, /set_immoscout_central_enabled/);
  assert.match(adapter, /getCentralImmoScoutConnection/);
  assert.match(adapter, /refreshCentral/);
  assert.match(adapter, /central\.row\.enabled===true/);
  assert.match(adapter, /const connection=await getConnection\(db,userId,PROVIDER\)/);
  assert.match(adapter, /emailaddress:\(\)=>clean\(profile\?\.email,320\)\|\|null/);
  assert.match(adapter, /CENTRAL_ACCOUNT_EMAIL/);
});

test('central token refresh preserves activation and revalidates account identity', () => {
  assert.match(credentials, /p_preserve_enabled:preserveEnabled/);
  assert.match(auth, /p_preserve_enabled:false/);
  assert.match(migration, /case when p_preserve_enabled then enabled else 0 end/);
  assert.match(adapter, /USERINFO='https:\/\/login\.immobilienscout24\.de/);
  assert.match(adapter, /info\?\.email\|\|''\)\.trim\(\)\.toLowerCase\(\)!==CENTRAL_ACCOUNT_EMAIL/);
  assert.match(credentials, /mark_immoscout_central_credentials/);
});

test('D1 credentials stay private and central auto-apply defaults to disabled', () => {
  assert.match(d1Schema, /enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.get_immoscout_central_credentials\(\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.set_immoscout_central_enabled\(boolean\) from public, anon, authenticated/);
});
