import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const code=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/immomio-account/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,''));
const id='01234567-89ab-4cde-8123-456789abcdef';
function gateway({valid=true,consume=true,conflict=false}={}){
 const calls=[];let sendCount=0;
 const db={rpc:async(name,args)=>{calls.push(name);
  if(name==='application_user_eligible')return {data:true};
  if(name==='get_bot_secret')return {data:'internal'};
  if(name==='get_immomio_application_listing')return {data:{id,is_active:true,raw:{applicationLink:`https://tenant.immomio.com/apply/${id}`},application_target:{status:conflict?'conflict':'resolved',source_identifier:id}}};
  if(name==='validate_immomio_application_send')return {data:valid};
  if(name==='consume_immomio_application_send')return consume==='unknown'?{error:Error('timeout')}:{data:consume};
  if(name==='cooperative_auto_apply_readiness')return {data:[]};
  throw Error(name);
 }};
 let handler;
 const scope={createClient:()=>db,Deno:{env:{get:()=>undefined},serve:h=>{handler=h}},Response,JSON,Set,Error,
  inspectImmomioAccountApplication:async x=>{calls.push('probe');assert.ok(x.listing.raw.applicationLink);return {ready:true}},
  sendImmomioApplication:async({authorize})=>{calls.push('prepare');if(await authorize()!==true)return {status:'failed'};sendCount++;return {status:'sent'}}};
 vm.runInNewContext(code,scope);
 return {call:scope.handleAction,handler:()=>handler,calls,sendCount:()=>sendCount};
}
const body={action:'send_authorized',userId:id,listingId:id,applicationId:id,leaseToken:id,sourceIdentifier:id};
await test('canonical resolved listing is passed to the existing provider module',async()=>{const g=gateway();assert.equal((await g.call({action:'probe',userId:id,listingId:id})).ready,true);});
await test('send needs scoped validation and one-use consumption before mutation',async()=>{const g=gateway();assert.equal((await g.call(body)).status,'sent');assert.equal(g.sendCount(),1);assert.ok(g.calls.indexOf('validate_immomio_application_send')<g.calls.indexOf('prepare'));assert.ok(g.calls.includes('consume_immomio_application_send'));});
await test('unbound legacy test call and cross-user lease rejection do not send',async()=>{const g=gateway({valid:false});await assert.rejects(g.call(body),/send_not_authorized/);await assert.rejects(g.call({action:'send_test',userId:id,listingId:id,confirm:'SEND_ONE_IMMOMIO_TEST'}),/invalid_user/);assert.equal(g.sendCount(),0);});
await test('already consumed or uncertain permission cannot initiate submission',async()=>{for(const c of [false,'unknown']){const g=gateway({consume:c});if(c==='unknown')await assert.rejects(g.call(body),/submission_unconfirmed/);else assert.equal((await g.call(body)).status,'failed');assert.equal(g.sendCount(),0);}});
await test('conflicting application targets cannot reach provider preparation',async()=>{const g=gateway({conflict:true});await assert.rejects(g.call({action:'probe',userId:id,listingId:id}),/application_target_conflict/);assert.equal(g.calls.includes('probe'),false);});
await test('readiness is read-only and does not log in or submit',async()=>{const g=gateway();assert.equal((await g.call({action:'readiness',userId:id})).ok,true);assert.deepEqual(g.calls,['cooperative_auto_apply_readiness']);assert.equal(g.sendCount(),0);});
await test('gateway still requires existing internal authentication',async()=>{const g=gateway();const h=g.handler();const r=await h(new Request('https://example.test',{method:'POST',body:'{}'}));assert.equal(r.status,401);assert.equal(g.sendCount(),0);});
