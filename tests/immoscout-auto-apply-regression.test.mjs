import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const canary=readFileSync(new URL('../supabase/functions/immoscout-send-canary/index.ts',import.meta.url),'utf8');
const provider=readFileSync(new URL('../supabase/functions/application-worker/providers/immoscout.ts',import.meta.url),'utf8');
const allowTypes=readFileSync(new URL('../supabase/migrations/20260916233032_allow_all_listing_types_for_auto_apply.sql',import.meta.url),'utf8');
const plusNotice=readFileSync(new URL('../supabase/migrations/20260916233138_notify_immoscout_plus_required.sql',import.meta.url),'utf8');

test('ImmoScout mandatory fields use adaptive mapping instead of unknown-field rejection',()=>{
  for(const source of[canary,provider]){
    assert.match(source,/provider_prefill/);
    assert.match(source,/numberofresidents/);
    assert.match(source,/incomeamount/);
    assert.match(source,/currentschufainformation/);
    assert.match(source,/phonecalldesired/);
    assert.doesNotMatch(source,/required_field_contract_unverified/);
  }
  assert.match(provider,/prepareImmoScoutForm/);
  assert.match(provider,/submission_unconfirmed/);
});

test('swap, sublet and temporary-rental listing types are not blocked by auto apply',()=>{
  assert.match(allowTypes,/select true/);
  assert.doesNotMatch(canary,/listing_type_excluded/);
  assert.doesNotMatch(provider,/listing_type_excluded/);
});

test('ImmoScout Plus blocks produce a single explicit Telegram notice path',()=>{
  assert.match(provider,/plus_required/);
  assert.match(plusNotice,/applications_notify_immoscout_plus_required/);
  assert.match(plusNotice,/old\.last_error is not distinct from new\.last_error/);
  assert.match(plusNotice,/Automatische Bewerbung nicht zugestellt/);
  assert.match(plusNotice,/ImmoScout Plus erforderlich/);
});


test('ImmoScout mandatory household size and income reuse the completed profile instead of reporting them missing',()=>{
  assert.match(provider,/numberofpersons:\(\)=>householdValue\(profile,configKey\)/);
  assert.doesNotMatch(provider,/\['numberofpersons','numberofresidents'\]\.includes\(key\)\)\)return true/);
  assert.match(provider,/return providerIncome\('immoscout',profile\?\.income_range\)/);
});


test('ImmoScout legacy household aliases normalize to current schema fields and order',()=>{
  assert.match(provider,/numberofpersons\|numberofresidents\|householdsize\|residents/);
  assert.match(provider,/\?'numberOfAdults':\/numberofchildren\|numberofkids/);
  assert.match(provider,/'incomeAmount','employmentStatus','rentArrears','insolvencyProcess','smoker','numberOfAdults','numberOfKids'/);
  assert.doesNotMatch(provider,/'numberOfPersons'/);
  assert.match(provider,/kind==='SINGLE'\)adults=1/);
  assert.match(provider,/kind==='TWO_ADULTS'\)adults=2/);
});
