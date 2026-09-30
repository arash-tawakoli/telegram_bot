import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {runClaimedJob} from '../supabase/functions/source-worker/job-runner.ts';

const code=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/source-worker/index.ts',import.meta.url),'utf8').replace(/^import[^;]+;\n/gm,''));
function worker(ids,clock=Date){
  const queue=ids.map((source_id,i)=>({job_id:String(i),source_id,attempt:1})),processed=[],claims=[];
  let handler,current;
  const db={rpc:async(name,args)=>{if(name==='claim_source_jobs'){claims.push(args.p_qty);return{data:queue.splice(0,args.p_qty)}}return{data:true}},from(){const q={select(){return q},eq(key,value){if(key==='id')current=value;return q},single:async()=>({data:{id:current,source_connectors:[]}})};return q}};
  const run=async s=>{processed.push(s.id);return{ok:true}};
  vm.runInNewContext(code,{db,runScout:run,runKlein:run,runGeneric:run,runGcp:run,runImmomio:run,runHpm:run,runCatalog:run,runPublicInventory:run,runNestpick:run,runCategoryStreams:async()=>[],runClaimedJob,internalSecret:async()=>'fixture',emsg:e=>String(e),Deno:{serve:h=>handler=h},Request,Response,Date:clock,console});
  return{invoke:()=>handler(new Request('https://example.test',{method:'POST',headers:{'x-internal-secret':'fixture'},body:'{}'})),queue,processed,claims};
}
test('each large portal crawl finishes before another portal can share its invocation budget',async()=>{
  for(const id of [1,2,3]){const w=worker([id,1,2,3,8]);assert.equal((await w.invoke()).status,200);assert.deepEqual(w.processed,[id]);assert.equal(w.queue.length,4);assert.deepEqual(w.claims,[1]);}
});
test('small sources drain available work without an artificial three-job limit',async()=>{
  const w=worker([8,20,22,23]);assert.equal((await w.invoke()).status,200);assert.deepEqual(w.processed,[8,20,22,23]);assert.equal(w.queue.length,0);assert.deepEqual(w.claims,[1,1,1,1,1]);
});
test('small sources still respect the existing invocation time budget',async()=>{
  let now=-10000;
  const w=worker(Array(10).fill(20),{now:()=>now+=10000});
  assert.equal((await w.invoke()).status,200);
  assert.equal(w.processed.length,4);
  assert.equal(w.queue.length,6);
});
