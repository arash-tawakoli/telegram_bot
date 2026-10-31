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
const worker = read('../cloudflare/immoscout-central-token-staging/index.js');
const schema = read('../cloudflare/immoscout-central-token-staging/schema.sql');

test('the /token command is exposed only in the admin Telegram command scope', () => {
  const publicCommands = handlers.match(/const PUBLIC_COMMANDS = \[([\s\S]*?)\];/)?.[1] || '';
  const adminCommands = handlers.match(/const ADMIN_COMMANDS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.doesNotMatch(publicCommands, /command: "token"/);
  assert.match(adminCommands, /command: "token"/);
  assert.match(handlers, /if \(command === "\/token"\)\s*\{\s*if \(!isAdmin\(user\)\)/);
  assert.match(runtime, /import \{ ADMIN_TELEGRAM_USER_IDS \} from "\.\.\/_shared\/telegram-admin\.ts"/);
});

test('central OAuth flows are admin-scoped and stored in Cloudflare D1', () => {
  assert.match(handlers, /db\.from\("platform_auth_flows"\)\.insert/);
  assert.match(handlers, /central_account: true/);
  assert.match(handlers, /account_hint: "arash@nexalabs\.de"/);
  assert.match(admin, /8538226539/);
  assert.match(admin, /414638980/);
  assert.match(facade, /flow\.context\?\.central_account===true/);
  assert.match(facade, /isTelegramAdminUser/);
  assert.match(auth, /function isCentralFlow/);
  assert.match(auth, /isTelegramAdminUser/);
  assert.match(auth, /CENTRAL_ACCOUNT_EMAIL='arash@nexalabs.de'/);
  assert.match(auth, /verifiedEmail!==CENTRAL_ACCOUNT_EMAIL/);
  assert.match(worker, /ADMIN_IDS = new Set/);

});

test('central credentials are encrypted in Cloudflare D1 and never stored in participant connections', () => {
  assert.match(worker, /name: "AES-GCM"/);
  assert.match(worker, /nexalabs:immoscout:central:v1/);
  assert.match(worker, /TOKEN_ENCRYPTION_KEY/);
  assert.match(worker, /INSERT INTO central_credentials/);
  assert.match(worker, /account_hint: email/);
  assert.match(schema, /enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(auth, /centralImmoScoutApi\('\/internal\/store'/);
  assert.match(credentials, /\/internal\/credentials/);
  assert.match(auth, /centralImmoScoutApi\('\/internal\/store'/);
  assert.match(credentials, /\/internal\/store/);
  assert.match(handlers, /centralImmoScoutApi\("\/internal\/status"\)/);
  assert.match(credentials, /get_bot_secret/);
});

test('central token is used only when explicitly enabled; participant OAuth remains fallback', () => {
  assert.match(worker, /enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(worker, /\/internal\/enable/);
  assert.match(adapter, /getCentralImmoScoutConnection/);
  assert.match(adapter, /refreshCentral/);
  assert.match(adapter, /central.row.enabled===true/);
  assert.match(adapter, /const connection=await getConnection\(db,userId,PROVIDER\)/);
  assert.match(adapter, /emailaddress:\(\)=>clean\(profile\?\.email,320\)\|\|null/);
  assert.match(adapter, /CENTRAL_ACCOUNT_EMAIL/);
});

test('token refresh preserves explicit activation and verifies the central account identity', () => {
  assert.match(worker, /preserve_enabled/);
  assert.match(worker, /enabled=CASE WHEN \?=1 THEN central_credentials.enabled ELSE 0 END/);
  assert.match(adapter, /USERINFO='https:\/\/login\.immobilienscout24\.de/);
  assert.match(adapter, /info\?\.email\|\|''\)\.trim\(\)\.toLowerCase\(\)!==CENTRAL_ACCOUNT_EMAIL/);
  assert.match(credentials, /preserve_enabled:true/);
  assert.match(credentials, /\/internal\/mark/);
});

test('central token service rejects missing credentials and unauthorized requests', () => {
  assert.match(worker, /return json\(\{ error: "unauthorized" \}, 401\)/);
  assert.match(worker, /central_account_mismatch/);
  assert.match(worker, /if \(!row \|\| row.status !== "connected"\)/);
  assert.match(worker, /cache-control": "no-store"/);
});
