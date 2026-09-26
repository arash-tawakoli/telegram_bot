import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const broker=readFileSync(new URL('../supabase/functions/auth-facade-broker/index.ts',import.meta.url),'utf8');

test('provider login email is independent from applicant profile email',()=>{
  assert.match(broker,/async function accountHint\(flow:any\).*account_hint/s);
  const accountHintBody=broker.match(/async function accountHint\(flow:any\)\{([\s\S]*?)\}/)?.[1]||null;
  assert.ok(accountHintBody);
  assert.doesNotMatch(accountHintBody,/profileEmail/);
  assert.match(broker,/async function immomioUrl\(flow:any,codeChallenge:string,emailValue:any\)/);
  assert.match(broker,/provider_email_required/);
  assert.match(broker,/providerWeb\(body\.ticket,body\.email\)/);
});

test('credential login forwards the provider email supplied by the login form',()=>{
  assert.match(broker,/immomioPasswordLogin\(value,emailValue,passwordValue\)/);
  assert.match(broker,/scoutPublic\(\{action:'password_login',state:String\(flow\.state\),email:emailValue,password:passwordValue\}\)/);
});
