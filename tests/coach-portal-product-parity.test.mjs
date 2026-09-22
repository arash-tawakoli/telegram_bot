import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const coach=readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8');
const readiness=readFileSync(new URL('../supabase/migrations/20260922131726_coach_portal_readiness_and_adoption.sql',import.meta.url),'utf8');
const creation=readFileSync(new URL('../supabase/migrations/20260922131850_fix_coach_create_participant_public_id.sql',import.meta.url),'utf8');
const activeSearch=readFileSync(new URL('../supabase/migrations/20260922134125_recheck_active_search_before_autoapply.sql',import.meta.url),'utf8');

test('coach portal readiness uses canonical premium and profile predicates',()=>{
  assert.match(readiness,/app_private\.user_is_premium/);
  assert.match(readiness,/app_private\.applicant_profile_complete/);
  assert.match(coach,/coach_readiness_core/);
  assert.match(coach,/readinessView/);
});

test('coach portal exposes analytics and application/document detail without duplicating queue logic',()=>{
  assert.match(coach,/dashboardData/);
  assert.match(coach,/applicationRows/);
  assert.match(coach,/application_events/);
  assert.match(coach,/open_document/);
  assert.match(coach,/createSignedUrl\(data\.storage_path,300\)/);
});

test('admin can adopt an existing bot participant without changing canonical identity',()=>{
  assert.match(readiness,/coach_adopt_participant/);
  assert.match(readiness,/preserved_existing_identity/);
  assert.doesNotMatch(readiness,/update public\.bot_users[\s\S]*participant_adopted/);
  assert.match(coach,/import_candidates/);
  assert.match(coach,/adopt_participant/);
});

test('new coaching participants receive an opaque public id at creation time',()=>{
  assert.match(creation,/v_public_id := 'cp_'/);
  assert.match(creation,/public_id/);
});


test('AutoApply rechecks the current active search before final submission',()=>{
  assert.match(activeSearch,/app_private\.user_listing_matches_active_search/);
  assert.match(activeSearch,/app_private\.matches_property_filters/);
  assert.match(activeSearch,/begin_application_submission/);
  assert.match(activeSearch,/app_private\.user_listing_matches_active_search\(u\.id,l\.id\)/);
});
