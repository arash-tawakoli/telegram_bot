import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const source=folder=>stripTypeScriptTypes(readFileSync(new URL(`../supabase/functions/${folder}`,import.meta.url),'utf8').replace(/^import[^;]+;\n/gm,'').replace(/\bexport (?=(?:async )?function)/g,''));
const globals={Response,Request,URL,Date,crypto,TextEncoder,TextDecoder,Uint8Array,AbortSignal,setTimeout,clearTimeout,btoa,atob,console,Blob,FormData};
const transfer={selected:2,uploaded:1,reused:1,removed:0,verified:true};

function worker(result){
 const application={id:'application',user_id:'user',listing_id:'listing',lease_token:'lease',attempts:0,status:'pending'},writes=[];
 const db={rpc:async name=>name==='claim_immomio_application'?{data:[application]}:name==='authorize_immomio_application_send'?{data:true}:name==='get_bot_secret'?{data:'fixture'}:{data:false},from(table){let value;
  const row=()=>table==='bot_users'?{id:'user',is_active:true,auto_apply_enabled:true}:table==='listings'?{id:'listing',is_active:true}:table==='platform_connections'?{status:'connected'}:application;
  const q={select(){return q},eq(){return q},update(v){value=v;return q},single:async()=>({data:row()}),maybeSingle:async()=>({data:row()}),then(resolve,reject){if(value){writes.push(value);Object.assign(application,value)}return Promise.resolve({data:value?[{id:application.id}]:[]}).then(resolve,reject)}};return q}};
 const scope={...globals,createClient:()=>db,Deno:{env:{get:()=>undefined},serve:()=>{}},fetch:async()=>Response.json({})};
 vm.runInNewContext(source('immomio-application-worker/index.ts'),scope);
 let sendCalls=0;
 scope.immomio=async action=>action==='probe'?{ready:true,sourceIdentifier:'10000000-0000-4000-8000-000000000001'}:(sendCalls++,result);
 return{run:()=>scope.processOne(),state:()=>scope.immomioDocumentState(result),application,writes,sendCalls:()=>sendCalls};
}

test('verified native uploads and reused files reach the stored worker result without sensitive payloads',async()=>{
 const w=worker({status:'sent',applicationId:'remote-application',documentTransfer:{...transfer,token:'must-not-be-stored',files:['private-url']}});
 const result=await w.run();
 assert.equal(result.status,'sent');assert.equal(result.documentResult,'native_uploaded');
 assert.deepEqual(JSON.parse(JSON.stringify(w.application.provider_state.documentTransfer)),transfer);
 assert.equal(w.application.provider_state.document_result,'native_uploaded');assert.equal(w.sendCalls(),1);
 assert.equal(JSON.stringify(w.application).includes('must-not-be-stored'),false);
});

test('no selection is recorded as not provided rather than a successful attachment',async()=>{
 const w=worker({status:'sent',documentTransfer:{selected:0,uploaded:0,reused:0,verified:true}});
 assert.equal((await w.run()).documentResult,'not_provided');
});

test('failed or incomplete uploads cannot be reported as native uploaded',async()=>{
 for(const result of [
  {status:'manual_required',error:'document_transfer_unverified'},
  {status:'manual_required',error:'document_download_failed'},
  {status:'manual_required',documentTransfer:{...transfer,verified:false}},
  {status:'manual_required',documentTransfer:{...transfer,reused:0}}
 ])assert.equal((await worker(result).run()).documentResult,'transfer_failed');
});

test('unknown or malformed transfer results do not fabricate document success',async()=>{
 for(const documentTransfer of [undefined,{selected:'2',uploaded:1,reused:1,verified:true},{selected:-1,uploaded:0,reused:0,verified:true}]){
  assert.equal((await worker({status:'sent',documentTransfer}).run()).documentResult,null);
 }
});

test('a confirmed profile upload survives an unconfirmed application without implying application delivery',async()=>{
 const w=worker({status:'manual_required',error:'submission_unconfirmed',documentTransfer:transfer});
 const result=await w.run();assert.equal(result.status,'manual_required');assert.equal(result.documentResult,'native_uploaded');
 assert.equal(w.application.sent_at,undefined);assert.equal(w.sendCalls(),1);
});

function provider(){
 const scope={...globals,getConnection:async()=>({credentials:{access_token:'fixture-token',expires_at:new Date(Date.now()+3600000).toISOString()}})};
 vm.runInNewContext(source('immomio-account/providers/immomio.ts'),scope);
 return scope;
}

test('every failure after successful profile synchronization retains its upload confirmation',async()=>{
 for(const stage of ['authorization','network','response','missing-id','verification','verification-network']){
  const p=provider();p.prepareAccountApplication=async()=>({ready:true,accountId:'account',propertyId:'property'});p.syncImmomioDocuments=async()=>transfer;
  p.authedGraphql=async()=>{if(stage==='network')throw Error('temporary_network_error');return{response:{ok:stage!=='response'},body:{data:{createApplication:stage==='missing-id'?{}:{id:'remote'}}}}};
  p.verifyApplication=async()=>{if(stage==='verification-network')throw Error('temporary_network_error');return{verified:stage!=='verification',row:{}}};
  const result=await p.sendImmomioApplication({db:{},user:{id:'user'},listing:{id:'listing'},authorize:async()=>stage!=='authorization'});
  assert.notEqual(result.status,'sent');assert.equal(result.documentTransfer,transfer);
 }
});

test('native synchronization uploads actual PDF bytes and reuses a verified transfer on the next application',async()=>{
 const p=provider(),pdf=new Blob(['%PDF-1.4\nfixture'],{type:'application/pdf'});
 const document={id:'doc',document_type:'wbs',original_filename:'WBS.pdf',storage_path:'user/doc.pdf',mime_type:'application/pdf',size_bytes:pdf.size,updated_at:'2026-09-30T00:00:00Z',created_at:'2026-09-30T00:00:00Z'};
 const remote={identifier:'remote-file',title:'WBS.pdf',type:'WB_CERTIFICATE'},cache=[];let attachments=[],uploads=0,downloads=0;
 const db={storage:{from:()=>({download:async()=>{downloads++;return{data:pdf}}})},from(table){const q={select(){return q},eq(){return q},order(){return q},upsert:async value=>{cache.push(value);return{}},then(resolve,reject){return Promise.resolve({data:table==='applicant_documents'?[document]:cache.map((x,i)=>({...x,id:'cache-'+i}))}).then(resolve,reject)}};return q}};
 p.currentImmomioProfile=async()=>({id:'account',address:{},profile:{attachments}});
 p.authedGraphql=async(_db,_user,_query,variables)=>{attachments=variables.user.profile.attachments;return{response:{ok:true},body:{data:{saveUser:{id:'account'}}}}};
 p.fetch=async(url,options)=>{assert.equal(url,'https://gql-ps.immomio.com/tenant/fileUpload');assert.equal(options.body instanceof FormData,true);const file=options.body.get('files');assert.equal(file.name,'WBS.pdf');assert.equal(file.type,'application/pdf');assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from(await pdf.arrayBuffer()));uploads++;return Response.json([remote])};
 const first=await p.syncImmomioDocuments(db,'user');assert.equal(first.uploaded,1);assert.equal(first.verified,true);
 const second=await p.syncImmomioDocuments(db,'user');assert.equal(second.uploaded,0);assert.equal(second.reused,1);assert.equal(second.verified,true);
 assert.equal(uploads,1);assert.equal(downloads,1);assert.equal(attachments[0].identifier,'remote-file');
});
