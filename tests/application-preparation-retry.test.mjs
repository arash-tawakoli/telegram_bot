import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

function worker(folder,method){
  let code=readFileSync(new URL(`../supabase/functions/${folder}/index.ts`,import.meta.url),'utf8').replace(/^import[^;]+;\n/gm,'').replace(/^const BASIC=.*;$/m,"const BASIC='fixture';");
  code=stripTypeScriptTypes(code);
  const application={id:'a',user_id:'u',listing_id:'l',lease_token:'claim',attempts:0,status:'pending',provider_state:{auditFlag:true}},writes=[];
  const user={id:'u',is_active:true,auto_apply_enabled:true},listing={id:'l',is_active:true,source_id:1},profile={first_name:'Test',last_name:'User'};
  const db={rpc:async name=>name.startsWith('claim_')?{data:[{...application}]}:name==='application_user_eligible'?{data:true}:name==='get_bot_secret'?{data:'fixture'}:{data:false},from(table){let write;const row=()=>table==='bot_users'?user:table==='listings'?listing:table==='platform_connections'?{status:'connected'}:table==='applicant_profiles'?profile:application;const q={select(){return q},eq(){return q},update(x){write=x;return q},single:async()=>({data:row()}),maybeSingle:async()=>({data:row()}),then(resolve){if(write){writes.push(write);Object.assign(application,write)}return Promise.resolve({data:write?[{id:'a'}]:[],count:0}).then(resolve)}};return q}};
  const fail=async()=>{throw Error('temporary_network_error')};
  const scope={createClient:()=>db,Deno:{env:{get:()=>undefined},serve:()=>{}},Response,Request,URL,Date,crypto,TextEncoder,TextDecoder,Uint8Array,AbortSignal,setTimeout,clearTimeout,btoa,atob,console,fetch:async()=>Response.json({}),applicationMessageFor:()=>({message:'Hallo'}),providerAttachmentCapability:()=>({supported:false}),providerForListing:()=> 'immoscout',sendApplication:fail};
  vm.runInNewContext(code,scope);
  scope.context=async()=>({u:user,l:listing,p:profile});scope.send=fail;scope.immomio=fail;
  return{invoke:()=>scope[method](),application,writes};
}
for(const [folder,method,maxRetries] of [['application-worker','processApplication',2],['immomio-application-worker','processOne',3]]){
  test(`${folder}: transient preparation errors stop at the existing retry limit`,async()=>{
    const w=worker(folder,method);
    for(let n=1;n<=maxRetries;n++){assert.equal((await w.invoke()).status,'pending');assert.equal(w.application.attempts,n);assert.equal(w.application.provider_state.auditFlag,true);assert.equal(w.application.submission_started_at??null,null);}
    assert.equal((await w.invoke()).status,'failed');assert.equal(w.application.attempts,maxRetries);assert.equal(w.application.last_error,'temporary_network_error');
  });
}
