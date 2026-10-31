import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

function loadTs(path,globals,expression){
 const source=readFileSync(new URL(path,import.meta.url),'utf8')
  .replace(/^import\s+.*?;\s*$/gm,'')
  .replaceAll('export ','');
 return vm.runInNewContext(stripTypeScriptTypes(source)+';('+expression+')',{
  URL,URLSearchParams,AbortSignal,Date,TextEncoder,TextDecoder,crypto:webcrypto,
  btoa,atob,console,...globals
 });
}

test('central ImmoScout credentials use a distinct encryption scope',async()=>{
 const db={rpc:async()=>({data:Buffer.alloc(32,19).toString('base64'),error:null})};
 const api=loadTs('../supabase/functions/application-worker/credentials.ts',{},'{encryptCredentials,decryptCredentials,encryptServiceCredentials,decryptServiceCredentials}');
 const central={access_token:'central-token',refresh_token:'central-refresh'};
 const encrypted=await api.encryptServiceCredentials(db,'immoscout',central,1);
 const serviceRow={provider:'immoscout',key_version:1,...encrypted};
 assert.deepEqual(await api.decryptServiceCredentials(db,serviceRow),central);
 await assert.rejects(
  api.decryptCredentials(db,{user_id:'participant-1',provider:'immoscout',key_version:1,...encrypted}),
  /credential_decrypt_failed/
 );
 const personal={access_token:'participant-token',refresh_token:'participant-refresh'};
 const personalEncrypted=await api.encryptCredentials(db,'participant-1','immoscout',personal,1);
 assert.deepEqual(
  await api.decryptCredentials(db,{user_id:'participant-1',provider:'immoscout',key_version:1,...personalEncrypted}),
  personal
 );
 await assert.rejects(
  api.decryptServiceCredentials(db,{provider:'immoscout',key_version:1,...personalEncrypted}),
  /credential_decrypt_failed/
 );
});

test('central ImmoScout session is preferred without reading participant credentials',async()=>{
 let participantReads=0;
 const expiry=new Date(Date.now()+60*60*1000).toISOString();
 const api=loadTs('../supabase/functions/application-worker/providers/immoscout.ts',{
  getServiceConnection:async(_db,provider)=>({row:{provider,status:'connected',account_hint:'arash@nexalabs.de',refresh_attempts:0},credentials:{access_token:'central-token',expires_at:expiry}}),
  getConnection:async()=>{participantReads++;throw new Error('participant credentials must not be read')}
 },'{session,resolveImmoScoutField}');
 const active=await api.session({},'participant-1');
 assert.equal(active.scope,'service');
 assert.equal(active.credentials.access_token,'central-token');
 assert.equal(participantReads,0);
});

test('a participant OAuth connection remains the fallback when no central account is active',async()=>{
 const expiry=new Date(Date.now()+60*60*1000).toISOString();
 const api=loadTs('../supabase/functions/application-worker/providers/immoscout.ts',{
  getServiceConnection:async()=>({row:{status:'needs_login'},credentials:{access_token:'old-central-token'}}),
  getConnection:async()=>({row:{status:'connected'},credentials:{access_token:'participant-token',expires_at:expiry}})
 },'{session}');
 const active=await api.session({},'participant-1');
 assert.equal(active.scope,'participant');
 assert.equal(active.credentials.access_token,'participant-token');
});

test('ImmoScout contact email mapping remains sourced from the applicant profile',()=>{
 const api=loadTs('../supabase/functions/application-worker/providers/immoscout.ts',{},'{resolveImmoScoutField}');
 const profile={first_name:'Test',last_name:'Applicant',email:'participant@example.test'};
 const mapped=api.resolveImmoScoutField('emailAddress',{},profile,'Bewerbungstext');
 assert.equal(mapped.value,'participant@example.test');
});

test('central account migration keeps service credentials server-only and mirrors readiness without copying tokens',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261031200000_immoscout_central_service_account.sql',import.meta.url),'utf8');
 assert.match(sql,/create table if not exists public\.platform_service_connections/i);
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/revoke all on public\.platform_service_connections from public,anon,authenticated/i);
 assert.match(sql,/grant select,insert,update,delete on public\.platform_service_connections to service_role/i);
 assert.match(sql,/connection_scope='service'/i);
 assert.match(sql,/coach_issue_immoscout_central_connect_flow/i);
 assert.match(sql,/complete_platform_service_connect_flow/i);
 assert.match(sql,/account_hint.*account_email/s);
 assert.match(sql,/insert into public\.platform_connections\(\s*user_id,provider,status,connection_scope,account_hint/i);
});

test('participant connection completion stays participant-scoped and cannot consume a central flow',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261031200000_immoscout_central_service_account.sql',import.meta.url),'utf8');
 assert.match(sql,/if v_flow\.origin='admin' then raise exception 'auth_flow_expired'; end if;/i);
 assert.match(sql,/connection_scope='participant'/i);
 assert.match(sql,/origin = any \(array\['telegram'::text,'coach'::text,'shared'::text,'admin'::text\]\)/i);
});
