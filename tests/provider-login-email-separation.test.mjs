import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const broker=readFileSync(new URL('../supabase/functions/auth-facade-broker/index.ts',import.meta.url),'utf8');

test('provider login email is independent from applicant profile email',()=>{
  const accountHint=broker.match(/async function accountHint\(flow:any\)\{[^\n]+\}/)?.[0]||'';
  assert.match(accountHint,/account_hint/);
  assert.doesNotMatch(accountHint,/profileEmail|applicant_profiles/);
  assert.match(broker,/async function immomioUrl\(flow:any,codeChallenge:string,emailValue:any\)/);
  assert.match(broker,/provider_email_required/);
  assert.match(broker,/providerWeb\(body\.ticket,body\.email\)/);
});

test('credential login forwards the provider email supplied by the login form',()=>{
  assert.match(broker,/immomioPasswordLogin\(value,emailValue,passwordValue\)/);
  assert.match(broker,/scoutPublic\(\{action:'password_login',state:String\(flow\.state\),email:emailValue,password:passwordValue\}\)/);
});
