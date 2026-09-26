import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker=readFileSync(new URL('../supabase/functions/kleinanzeigen-application-worker/index.ts',import.meta.url),'utf8');

test('scheduled Kleinanzeigen worker uses the shared portal value mappings',()=>{
  assert.match(worker,/claim_kleinanzeigen_application/);
  for(const name of ['providerSalutation','providerHousehold','providerEmployment','providerIncome','providerPets','providerSchufa','providerMoveIn']){
    assert.ok(worker.includes(name),`missing shared mapper: ${name}`);
  }
});

test('scheduled Kleinanzeigen worker requires the category template with no generic fallback',()=>{
  assert.match(worker,/applicationMessageFor\(p,l\)/);
  assert.match(worker,/applicationMessageFor\(x\.p,x\.l\)/);
  assert.match(worker,/application_template_missing/);
  assert.doesNotMatch(worker,/function messageFor|default_message/);
});
