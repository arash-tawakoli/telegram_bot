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
  if(name==='claim_platform_session')return {data:[{user_id:'u',source_id:1,lease_token:'session',status:'saved',context_id:'context'}]};
  if(name==='authorize_application_send')return authorized==='uncertain'?{error:Error('timeout')}:{data:authorized};
 },from(table){let write;
  const q={select(){return q},eq(){return q},update(value){write=value;return q},
   single:async()=>({data:table==='bot_users'?{id:'u',auto_apply_enabled:true,applicant_profile:{}}:{id:'l',source_id:1,is_active:true,title:'Wohnung'}}),
   then(resolve){if(write)writes.push({table,write});return Promise.resolve({data:write?[{id:'a',user_id:'u'}]:[],error:null}).then(resolve)}
  };return q;
 }};
 const browser={pages:async()=>[{}],disconnect:()=>events.push('disconnect')};
 const scope={createClient:()=>db,Deno:{env:{get:()=>undefined},serve:()=>{}},browserbase:()=>({start:async()=>({id:'session',connectUrl:'url'}),stop:async()=>events.push('stop')}),
  puppeteer:{connect:async()=>browser},browserUrl:x=>x,identifier:x=>x,generateApplicationMessage:()=> 'Bewerbung',detectDocument:()=> 'application/pdf',FILE_LIMIT:5*1024*1024,Buffer,
  adapters:{1:{applyToListing:async({authorize})=>{
   const permitted=await authorize();if(!permitted)return {success:false,status:'failed',error:'not_eligible'};
   events.push('send');if(failAfterAuthorization)throw Object.assign(Error('timeout'),{name:'TimeoutError'});
   return {success:true,status:'sent'};
  }}}};
 vm.runInNewContext(source,scope);return {...scope,writes,events};
}
test('Premium is rechecked before browser I/O',async()=>{
 const w=worker({premium:false});assert.equal((await w.processApplication()).status,'failed');
 assert.ok(!w.events.includes('claim_platform_session'));assert.ok(!w.events.includes('send'));
});
test('successful send follows durable authorization; uncertain sends are never queued again',async()=>{
 for(const scenario of [{},{failAfterAuthorization:true},{authorized:'uncertain'}]){
  const w=worker(scenario),result=await w.processApplication();
  assert.equal(result.status,Object.keys(scenario).length?'manual_required':'sent');
  const final=w.writes.filter(x=>x.table==='applications').at(-1).write;
  assert.notEqual(final.status,'pending');assert.equal(final.attempts,undefined);
  if(w.events.includes('send'))assert.ok(w.events.indexOf('authorize_application_send')<w.events.indexOf('send'));
  assert.ok(w.events.includes('stop'));assert.ok(w.events.includes('disconnect'));
 }
});
