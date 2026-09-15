import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,''));
function worker({authorized=true,failAfterAuthorization=false,premium=true}={}){
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
   single:async()=>({data:table==='bot_users'?{id:'u',chat_id:null,is_active:true,auto_apply_enabled:true}:table==='applicant_profiles'?{user_id:'u',first_name:'Test',last_name:'User',email:'test@example.com',phone:'123',city:'Hamburg',household_size:1}:{id:'l',source_id:1,is_active:true,title:'Wohnung',raw:{},external_id:'1',source_listing_key:'1'}}),
   then(resolve){if(write)writes.push({table,write});return Promise.resolve({data:write?[{id:'a'}]:[],error:null}).then(resolve)}
  };return q;
 }};
 const scope={createClient:()=>db,Deno:{env:{get:()=>undefined},serve:()=>{}},createProfileToken:async()=>'',handleProfilePage:async()=>{},beginKleinanzeigenLogin:async()=>{},checkKleinanzeigenConnection:async()=>{},disconnectKleinanzeigen:async()=>{},checkImmoScoutConnection:async()=>{},disconnectImmoScout:async()=>{},probeImmomioApplication:async()=>{},
  providerForListing:()=> 'immoscout',sendApplication:async(_provider,{authorize})=>{events.push('provider_prepare');const permitted=await authorize();if(!permitted)return {success:false,status:'failed',error:'not_eligible'};events.push('send');if(failAfterAuthorization)throw Object.assign(Error('timeout'),{name:'TimeoutError'});return {success:true,status:'sent'};},fetch:async()=>({}),AbortSignal,URL,Response,JSON,crypto,Date,setTimeout,clearTimeout,console};
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
