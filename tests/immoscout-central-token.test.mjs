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
const migration = read('../supabase/migrations/20261031194500_immoscout_central_account_token.sql');

test('the /token command is exposed only in the admin Telegram command scope', () => {
  const publicCommands = handlers.match(/const PUBLIC_COMMANDS = \[([\s\S]*?)\];/)?.[1] || '';
  const adminCommands = handlers.match(/const ADMIN_COMMANDS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(publicCommands, /command: "token"/);
  assert.match(adminCommands, /command: "token"/);
  assert.match(handlers, /if \(command === "\/token"\)\s*\{\s*if \(!isAdmin\(user\)\)/);
  assert.match(runtime, /import \{ ADMIN_TELEGRAM_USER_IDS \} from "\.\.\/_shared\/telegram-admin\.ts"/);
});

test('central OAuth flow is scoped to the configured NexaLabs ImmoScout account', () => {
  assert.match(handlers, /central_account: true/);
  assert.match(handlers, /account_hint: "arash@nexalabs\.de"/);
  assert.match(handlers, /platform_auth_flows/);
  assert.match(handlers, /15 \* 60_000/);
  assert.match(admin, /8538226539/);
  assert.match(admin, /414638980/);
  assert.match(facade, /isTelegramAdminUser/);
  assert.match(auth, /isTelegramAdminUser/);
  assert.match(auth, /CENTRAL_ACCOUNT_EMAIL='arash@nexalabs\.de'/);
  assert.match(auth, /verifiedEmail!==CENTRAL_ACCOUNT_EMAIL/);
});

test('central OAuth tokens are encrypted and never saved in participant platform_connections', () => {
  assert.match(auth, /nexalabs:immoscout:central:v1/);
  assert.match(auth, /name:'AES-GCM'/);
  assert.match(auth, /complete_immoscout_central_auth_flow/);
  assert.match(migration, /create table if not exists app_private\.immoscout_central_credentials/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on app_private\.immoscout_central_credentials from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.complete_immoscout_central_auth_flow[\s\S]*?to service_role/);
});

test('central token is used first with participant OAuth retained as fallback', () => {
  assert.match(credentials, /get_immoscout_central_credentials/);
  assert.match(credentials, /nexalabs:immoscout:central:v1/);
  assert.match(adapter, /getCentralImmoScoutConnection/);
  assert.match(adapter, /refreshCentral/);
  assert.match(adapter, /const connection=await getConnection\(db,userId,PROVIDER\)/);
  assert.match(adapter, /emailaddress:\(\)=>clean\(profile\?\.email,320\)\|\|null/);
  assert.match(adapter, /CENTRAL_ACCOUNT_EMAIL/);
  assert.match(adapter, /central.row.enabled===true/);
});

test('central credential refresh preserves account identity and updates encrypted storage', () => {
  assert.match(adapter, /USERINFO='https:\/\/login\.immobilienscout24\.de/);
  assert.match(adapter, /info\?\.email\|\|''\)\.trim\(\)\.toLowerCase\(\)!==CENTRAL_ACCOUNT_EMAIL/);
  assert.match(credentials, /update_immoscout_central_credentials/);
  assert.match(credentials, /mark_immoscout_central_credentials/);
});

test('database RPCs are service-role only and central account email is constrained', () => {
  assert.match(migration, /lower\(account_hint\) = 'arash@nexalabs\.de'/);
  assert.match(migration, /telegram_user_id in \(8538226539,414638980\)/);
  assert.match(migration, /revoke all on function public\.get_immoscout_central_credentials\(\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_immoscout_central_credentials\(\) to service_role/);
});
