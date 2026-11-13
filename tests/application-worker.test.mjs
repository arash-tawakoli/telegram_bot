import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,''));
function worker({authorized=true,failAfterAuthorization=false,premium=true,provider='immoscout',providerResult=null,waitReason=null}={}){
 const writes=[],events=[];
 const application={id:'a',user_id:'u',listing_id:'l',lease_token:'claim',attempts:0};
 const db={rpc:async(name)=>{
  events.push(name);
  if(name==='claim_application')return {data:[application]};
  if(name==='application_user_eligible')return {data:premium};
  if(name==='authorize_application_send')return authorized==='uncertain'?{error:Error('timeout')}:{data:authorized};
  if(name==='get_bot_secret')return {error:Error('not configured')};
 },from(table){let write;
  const q={select(){return q},eq(){return q},update(value){write=value;return q},
   maybeSingle:async()=>({data:{status:'pending',wait_reason:waitReason,next_attempt_at:waitReason?'later':null}}),
   single:async()=>({data:table==='bot_users'?{id:'u',chat_id:null,is_active:true,auto_apply_enabled:true}:table==='applicant_profiles'?{user_id:'u',first_name:'Test',last_name:'User',email:'test@example.com',phone:'123',city:'Hamburg',household_size:1}:{id:'l',source_id:provider==='immowelt'?3:1,is_active:true,title:'Wohnung',raw:{},external_id:'1',source_listing_key:'1'}}),
   then(resolve){if(write)writes.push({table,write});return Promise.resolve({data:write?[{id:'a'}]:[],error:null}).then(resolve)}
  };return q;
 }};
 const scope={createClient:()=>db,Deno:{env:{get:()=>undefined},serve:()=>{}},createProfileToken:async()=>'',handleProfilePage:async()=>{},checkImmoScoutConnection:async()=>{},disconnectImmoScout:async()=>{},beginImmomioLogin:async()=>{},completeImmomioLogin:async()=>{},checkImmomioConnection:async()=>{},disconnectImmomio:async()=>{},inspectImmomioAccountApplication:async()=>{},markConnection:async()=>{},
  applicationMessageFor:()=>({field:'message_apartment',message:'Hallo'}),providerAttachmentCapability:()=>({supported:false}),profileAdapterSelfTest:()=>({ok:true}),probeImmomioApplication:async()=>({}),checkImmoweltConnection:async()=>{},disconnectImmowelt:async()=>{},
  providerForListing:()=>provider,sendApplication:async(_provider,{authorize})=>{events.push('provider_prepare');const permitted=await authorize();if(!permitted)return providerResult??{success:false,status:'failed',error:'not_eligible'};events.push('send');if(failAfterAuthorization)throw Object.assign(Error('timeout'),{name:'TimeoutError'});return providerResult??{success:true,status:'sent'};},fetch:async()=>({}),AbortSignal,URL,Response,JSON,crypto,Date,setTimeout,clearTimeout,console};
 vm.runInNewContext(source,scope);return {...scope,writes,events};
}
test('Premium is rechecked before provider I/O',async()=>{
 const w=worker({premium:false});assert.equal((await w.processApplication()).status,'failed');
 assert.ok(!w.events.includes('provider_prepare'));assert.ok(!w.events.includes('send'));
});
test('successful send follows durable authorization; uncertain sends are never queued again',async()=>{
 for(const scenario of [{},{failAfterAuthorization:true},{authorized:'uncertain'}]){
  const w=worker(scenario),result=await w.processApplication();
  assert.equal(result.status,Object.keys(scenario).length?'manual_required':'sent');
  const final=w.writes.filter(x=>x.table==='applications').at(-1).write;
  assert.notEqual(final.status,'pending');assert.equal(final.attempts,undefined);
  if(w.events.includes('send'))assert.ok(w.events.indexOf('authorize_application_send')<w.events.indexOf('send'));
 }
});
test('unauthorized Immowelt sends are deferred only with an explicit wait reason',async()=>{
 const result={success:false,status:'pending',error:'send_not_authorized'};
 const terminal=worker({authorized:false,provider:'immowelt',providerResult:result});
 const stopped=await terminal.processApplication();
 assert.equal(stopped.status,'manual_required');
 const stoppedWrite=terminal.writes.filter(x=>x.table==='applications').at(-1).write;
 assert.equal(stoppedWrite.last_error,'send_not_authorized');
 assert.equal(stoppedWrite.next_attempt_at,undefined);
 const deferred=worker({authorized:false,provider:'immowelt',waitReason:'provider_backoff',providerResult:result});
 assert.equal((await deferred.processApplication()).status,'deferred');
 assert.ok(!deferred.writes.some(x=>x.table==='applications'&&x.write.status==='manual_required'));
});
test('listing_unavailable is terminal and deactivates the listing',async()=>{
 const w=worker({provider:'immowelt',providerResult:{success:false,status:'failed',error:'listing_unavailable'}});
 const result=await w.processApplication();
 assert.equal(result.status,'failed');
 const listingWrite=w.writes.find(x=>x.table==='listings')?.write;
 assert.equal(listingWrite?.is_active,false);
 assert.equal(listingWrite?.fresh_delivery_eligible,undefined);
 const final=w.writes.filter(x=>x.table==='applications').at(-1).write;
 assert.equal(final.status,'failed');
 assert.equal(final.last_error,'listing_unavailable');
});
