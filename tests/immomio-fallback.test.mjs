import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const code=readFileSync(new URL('../supabase/functions/source-worker/immomio-inventory.ts',import.meta.url),'utf8').replace(/import[^;]+;/,'').replaceAll('export ','');
const load=fetch=>vm.runInNewContext(stripTypeScriptTypes(code)+';({fetchImmomioInventory,validateImmomioPage})',{URL,atob,AbortSignal,fetch});
const url=tenant=>'https://homepage.immomio.com/de/properties?token=x.'+Buffer.from(JSON.stringify({customerId:tenant})).toString('base64url')+'.x';
const primary={priority:1,connector_kind:'immomio_tenant',config:{url:url(1)}};
const fallback={priority:2,connector_kind:'immomio_tenant',config:{url:'https://provider.example/offers'}};
const response=(page=0,total=0,nodes=[],size=250)=>({data:{propertyList:{page:{page,size,totalElements:total,totalPages:Math.ceil(total/size)},nodes}}});
test('Immomio validates empty inventory and rejects incomplete or malformed pagination',()=>{
 const api=load();assert.equal(api.validateImmomioPage(response(),0).nodes.length,0);
 assert.throws(()=>api.validateImmomioPage(response(0,1,[]),0),/truncated/);
 assert.throws(()=>api.validateImmomioPage(response(1,0,[]),0),/pagination/);
 assert.throws(()=>api.validateImmomioPage({...response(),errors:[{message:'failed'}]},0),/incomplete/);
});
test('Immomio switches to the official wrapper after a primary transport failure',async()=>{
 let calls=0;const api=load(async()=>{if(++calls===1)throw Error('HTTP 503');return {ok:true,json:async()=>response()}});
 const r=await api.fetchImmomioInventory(primary,[fallback],async()=>url(1));assert.equal(r.picked.priority,2);assert.equal(r.attempts[0].status,'error');assert.equal(r.attempts[1].status,'ok');
});
test('Immomio cannot recover with a different tenant or a shadow fallback',async()=>{
 let calls=0;const api=load(async()=>{calls++;throw Error('HTTP 503')});
 await assert.rejects(api.fetchImmomioInventory(primary,[fallback],async u=>u===primary.config.url?url(1):url(2)),/tenant mismatch/);assert.equal(calls,1);
 await assert.rejects(api.fetchImmomioInventory(primary,[{...fallback,shadow_only:true}],async()=>url(1)),/P1/);assert.equal(calls,2);
});
test('Immomio rejects repeated listing IDs across pages instead of archiving from an incomplete snapshot',async()=>{
 let calls=0;const api=load(async()=>({ok:true,json:async()=>response(calls++,2,[{objectId:'duplicate'}],1)}));
 await assert.rejects(api.fetchImmomioInventory(primary,[],async()=>url(1)),/duplicate/);
});
