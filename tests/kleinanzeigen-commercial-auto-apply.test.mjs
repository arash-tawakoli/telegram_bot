import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/kleinanzeigen-application-worker/index.ts',import.meta.url),'utf8');
const route=readFileSync(new URL('../supabase/migrations/20260917081052_route_kleinanzeigen_to_verified_xcf_worker.sql',import.meta.url),'utf8');

test('Kleinanzeigen distinguishes private and commercial seller accounts and uses category text',()=>{
  assert.match(worker,/seller-account-type/);
  assert.match(worker,/sellerKind/);
  assert.match(worker,/provider_accepted_commercial_xcf/);
  assert.match(worker,/applicationMessageFor/);
  assert.match(worker,/application_template_missing/);
  assert.doesNotMatch(worker,/Gewerblicher Anbieter: Die Rückmeldung kann auch per E-Mail erfolgen/);
});

test('commercial property contact forms resolve address and location dynamically',()=>{
  assert.match(worker,/api\/locations\.json\?q=/);
  assert.match(worker,/location\.\?id/);
  assert.match(worker,/p\?\.street,p\?\.house_number/);
  assert.match(worker,/zipcode\|postcode\|postal/);
  assert.match(worker,/resolvedLocationId/);
});

test('Kleinanzeigen has an isolated claim lane and stays fail closed',()=>{
  assert.match(route,/claim_kleinanzeigen_application/);
  assert.match(route,/kleinanzeigen-application-worker/);
  assert.match(worker,/xcf_conversation_id_missing/);
  assert.match(worker,/xcf_submit_unconfirmed/);
  assert.doesNotMatch(worker,/xcf_submit_unconfirmed[^\n]*status:'sent'/);
});
