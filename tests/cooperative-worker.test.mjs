import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/immomio-application-worker/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,''));
const target='01234567-89ab-4cde-8123-456789abcdef';
function worker({authorization=true,probeReady=true,throwAfterSend=false,probeTarget=target,connected=true}={}){
 const calls=[],writes=[];let handler;
 const app={id:'app',listing_id:'listing',user_id:'user',lease_token:'lease',attempts:0};
 const db={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='claim_immomio_application')return {data:[app]};
  if(name==='get_bot_secret')return {data:'internal'};
  if(name==='authorize_immomio_application_send')return authorization==='unknown'?{error:Error('timeout')}:{data:authorization};
  if(name==='immomio_application_request_started')return {data:true};
  throw Error(name);
 },from(table){let patch;
  const q={select(){return q},eq(){return q},update(v){patch=v;return q},
   single:async()=>({data:table==='bot_users'?{id:'user',chat_id:null,is_active:true,auto_apply_enabled:true}:{id:'listing',source_id:37,is_active:true,title:'Fixture',raw:{}}}),
   maybeSingle:async()=>({data:table==='platform_connections'?{status:connected?'connected':'disconnected'}:{status:'manual_required',last_error:'duplicate_provider_object'}}),
   then(resolve){if(patch)writes.push(patch);return Promise.resolve({data:[{id:'app'}]}).then(resolve)}};return q;
 }};
 const scope={createClient:()=>db,Deno:{env:{get:()=>undefined},serve:h=>{handler=h}},Response,JSON,Date,Error,AbortSignal,
  fetch:async(_url,options)=>{const body=JSON.parse(options.body);calls.push({name:body.action,args:body});if(body.action==='probe')return {ok:true,json:async()=>({ready:probeReady,sourceIdentifier:probeTarget,error:probeReady?null:'captcha_required'})};if(body.action==='send_authorized'){if(throwAfterSend)throw Error('network interruption');return {ok:true,json:async()=>({status:'sent'})}};throw Error(body.action);}};
 vm.runInNewContext(source,scope);return {...scope,calls,writes,handler:()=>handler};
}
await test('worker sends only with matching probe identity and scoped lease authorization',async()=>{
 const w=worker();assert.equal((await w.processOne()).status,'sent');
 assert.deepEqual(w.calls.map(x=>x.name).filter(n=>n!=='get_bot_secret'),['claim_immomio_application','probe','authorize_immomio_application_send','send_authorized']);
 const send=w.calls.find(x=>x.name==='send_authorized').args;
 assert.equal(send.applicationId,'app');assert.equal(send.leaseToken,'lease');assert.equal(send.sourceIdentifier,target);assert.equal(send.userId,'user');
});
await test('duplicate provider object retains its diagnosis and does not send',async()=>{
 const w=worker({authorization:false});const r=await w.processOne();assert.equal(r.status,'manual_required');assert.equal(r.error,'duplicate_provider_object');assert.ok(!w.calls.some(x=>x.name==='send_authorized'));
});
await test('uncertain authorization or send never becomes a pending retry',async()=>{
 for(const opts of [{authorization:'unknown'},{throwAfterSend:true}]){const w=worker(opts);assert.equal((await w.processOne()).status,'manual_required');assert.equal(w.writes.at(-1).last_error,'submission_unconfirmed');assert.ok(!w.writes.some(x=>x.status==='pending'));}
});
await test('manual provider challenge or invalid identity cannot reach send authorization',async()=>{
 for(const opts of [{probeReady:false},{probeTarget:'not-an-object'}]){const w=worker(opts);await w.processOne();assert.ok(!w.calls.some(x=>x.name==='authorize_immomio_application_send'));assert.ok(!w.calls.some(x=>x.name==='send_authorized'));}
});
await test('disconnected account is rejected before provider access',async()=>{
 const w=worker({connected:false});assert.equal((await w.processOne()).error,'provider_disabled');assert.ok(!w.calls.some(x=>x.name==='probe'));
});
