import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,''));
const adapterSource=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/_shared/application-profile-adapters.ts',import.meta.url),'utf8').replace(/^export\s+/gm,''));
const adapter=vm.runInNewContext(adapterSource+';({applicationMessageFor,profileAdapterSelfTest})');
function worker({authorized=true,failAfterAuthorization=false,premium=true,provider='immoscout',providerResult=null,profileOverrides={},listingOverrides={}}={}){
 const writes=[],events=[],sentInputs=[];
 const application={id:'a',user_id:'u',listing_id:'l',lease_token:'claim',attempts:0};
 const db={rpc:async(name)=>{
  events.push(name);
  if(name==='claim_application')return {data:[application]};
  if(name==='application_user_eligible')return {data:premium};
  if(name==='authorize_application_send')return authorized==='uncertain'?{error:Error('timeout')}:{data:authorized};
  if(name==='get_bot_secret')return {error:Error('not configured')};
 },from(table){let write;
  const q={select(){return q},eq(){return q},update(value){write=value;return q},
   single:async()=>({data:table==='bot_users'?{id:'u',chat_id:null,is_active:true,auto_apply_enabled:true}:table==='applicant_profiles'?{user_id:'u',first_name:'Test',last_name:'User',email:'test@example.com',phone:'123',city:'Hamburg',household_size:1,message_apartment:'Applicant message for the apartment.',...profileOverrides}:{id:'l',source_id:provider==='kleinanzeigen'?2:1,is_active:true,title:'Wohnung',raw:{},external_id:'1',source_listing_key:'1',...listingOverrides}}),
   then(resolve){if(write)writes.push({table,write});return Promise.resolve({data:write?[{id:'a'}]:[],error:null}).then(resolve)}
  };return q;
 }};
 const scope={createClient:()=>db,Deno:{env:{get:()=>undefined},serve:()=>{}},createProfileToken:async()=>'',handleProfilePage:async()=>{},beginKleinanzeigenLogin:async()=>{},completeKleinanzeigenLogin:async()=>{},completeKleinanzeigenCallback:async()=>{},checkKleinanzeigenConnection:async()=>{},disconnectKleinanzeigen:async()=>{},inspectKleinanzeigenInquiry:async()=>{},checkImmoScoutConnection:async()=>{},disconnectImmoScout:async()=>{},beginImmomioLogin:async()=>{},completeImmomioLogin:async()=>{},checkImmomioConnection:async()=>{},disconnectImmomio:async()=>{},inspectImmomioAccountApplication:async()=>{},markConnection:async()=>{},applicationMessageFor:adapter.applicationMessageFor,profileAdapterSelfTest:adapter.profileAdapterSelfTest,providerAttachmentCapability:()=>({supported:false}),
  providerForListing:()=>provider,sendApplication:async(_provider,input)=>{sentInputs.push(input);const{authorize}=input;events.push('provider_prepare');const permitted=await authorize();if(!permitted)return {success:false,status:'failed',error:'not_eligible'};events.push('send');if(failAfterAuthorization)throw Object.assign(Error('timeout'),{name:'TimeoutError'});return providerResult??{success:true,status:'sent'};},fetch:async()=>({}),AbortSignal,URL,Response,JSON,crypto,Date,setTimeout,clearTimeout,console};
 vm.runInNewContext(source,scope);return {...scope,writes,events,sentInputs};
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
test('Kleinanzeigen unconfirmed submission remains fail-closed',async()=>{
 const w=worker({provider:'kleinanzeigen',providerResult:{success:false,status:'manual_required',error:'xcf_submit_unconfirmed'}});
 const result=await w.processApplication();
 assert.equal(result.status,'manual_required');
 assert.equal(result.error,'xcf_submit_unconfirmed');
 const final=w.writes.filter(x=>x.table==='applications').at(-1).write;
 assert.equal(final.status,'manual_required');
 assert.equal(final.last_error,'xcf_submit_unconfirmed');
 assert.equal(final.sent_at,undefined);
});
test('listing_unavailable is terminal and deactivates the listing',async()=>{
 const w=worker({provider:'kleinanzeigen',providerResult:{success:false,status:'failed',error:'listing_unavailable'}});
 const result=await w.processApplication();
 assert.equal(result.status,'failed');
 const listingWrite=w.writes.find(x=>x.table==='listings')?.write;
 assert.equal(listingWrite?.is_active,false);
 assert.equal(listingWrite?.fresh_delivery_eligible,undefined);
 const final=w.writes.filter(x=>x.table==='applications').at(-1).write;
 assert.equal(final.status,'failed');
 assert.equal(final.last_error,'listing_unavailable');
});

test('missing category template does not fall back to the generic message or authorize a send',async()=>{
 const w=worker({profileOverrides:{message_apartment:'',default_message:'Do not use this fallback'}});
 const result=await w.processApplication();
 assert.equal(result.status,'manual_required');
 assert.equal(result.error,'application_template_missing');
 assert.ok(!w.events.includes('authorize_application_send'));
 assert.ok(!w.events.includes('provider_prepare'));
});
test('Immomio receives no message property and clears stale application text',async()=>{
 const w=worker({provider:'immomio'});
 assert.equal((await w.processApplication()).status,'sent');
 assert.equal(Object.hasOwn(w.sentInputs[0],'message'),false);
 const saved=w.writes.find(x=>x.table==='applications'&&Object.hasOwn(x.write,'application_text'));
 assert.equal(saved?.write.application_text,null);
});
