import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const canary=readFileSync(new URL('../supabase/functions/immoscout-send-canary/index.ts',import.meta.url),'utf8');
const allowTypes=readFileSync(new URL('../supabase/migrations/20260916233032_allow_all_listing_types_for_auto_apply.sql',import.meta.url),'utf8');
const plusNotice=readFileSync(new URL('../supabase/migrations/20260916233138_notify_immoscout_plus_required.sql',import.meta.url),'utf8');

test('ImmoScout mandatory fields use adaptive mapping instead of unknown-field rejection',()=>{
  assert.match(canary,/function resolveField\(/);
  assert.match(canary,/source:'provider_prefill'/);
  assert.match(canary,/numberofresidents/);
  assert.match(canary,/incomeamount/);
  assert.match(canary,/currentschufainformation/);
  assert.match(canary,/phonecalldesired/);
  assert.doesNotMatch(canary,/required_field_contract_unverified/);
});

test('swap, sublet and temporary-rental listing types are not blocked by auto apply',()=>{
  assert.match(allowTypes,/select true/);
  assert.doesNotMatch(canary,/listing_type_excluded/);
});

test('ImmoScout Plus blocks produce a single explicit Telegram notice path',()=>{
  assert.match(plusNotice,/applications_notify_immoscout_plus_required/);
  assert.match(plusNotice,/old\.last_error is not distinct from new\.last_error/);
  assert.match(plusNotice,/Automatische Bewerbung nicht zugestellt/);
  assert.match(plusNotice,/ImmoScout Plus erforderlich/);
});
