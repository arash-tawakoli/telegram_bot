import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const credentials = read('../supabase/functions/application-worker/credentials.ts');
const scout = read('../supabase/functions/application-worker/providers/immoscout.ts');
const welt = read('../supabase/functions/application-worker/providers/immowelt.ts');
const mioCredentials = read('../supabase/functions/immomio-account/credentials.ts');
const mio = read('../supabase/functions/immomio-account/providers/immomio.ts');

test('connection credentials remain encrypted and refresh telemetry is centralized', () => {
  assert.match(credentials, /AES-GCM/);
  assert.match(credentials, /record_platform_connection_refresh/);
  assert.match(mioCredentials, /AES-GCM/);
  assert.match(mioCredentials, /record_platform_connection_refresh/);
});

test('ImmoScout refreshes once after detail or contact auth rejection', () => {
  assert.match(scout, /async function detailWithRefresh/);
  assert.match(scout, /session\(db,userId,true\)/);
  assert.match(scout, /recordRefreshResult\(db,userId,PROVIDER/);
  assert.match(scout, /contactRefreshed=true/);
});

test('Immomio refreshes once after GraphQL or upload auth rejection', () => {
  assert.match(mio, /async function authedGraphql/);
  assert.match(mio, /session\(db,userId,true\)/);
  assert.match(mio, /document_upload_refresh_failed/);
  assert.match(mio, /recordRefreshResult\(db,userId,'immomio'/);
});

test('Immowelt distinguishes session refresh from listing-level forbidden responses', () => {
  assert.match(welt, /immoweltResponseDiagnostic/);
  assert.match(welt, /session_fallback_forbidden/);
  assert.match(welt, /attempt\.response\.status===401\)await markConnection/);
  assert.doesNotMatch(welt, /attempt\.response\.status===403\)await markConnection/);
});
