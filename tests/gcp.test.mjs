import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source = readFileSync(new URL('../supabase/functions/source-worker/gcp.ts', import.meta.url), 'utf8')
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/shared.ts";/, '').replace('export async function', 'async function');
const primary = {priority:1,config:{adapter:'source-worker/gcp',url:'https://example.test/search'}};
const fallback = {priority:3,config:{adapter:'source-worker/gcp-recommendations',url:'https://example.test/recommendations'}};
const mirror = {priority:2,config:{adapter:'source-worker/gcp-scout-mirror'}};
function harness({warmed=true, cursor, known=[], primaryRows=[], fallbackRows=[{key:'new'}], failPrimary=false, failFallback=false, failWrite=false}={}) {
  const writes=[], calls=[];
  const db={from(table){
    let writing=false;
    const q={select(){return q},eq(){return q},in(){return q},update(){writing=true;return q},upsert(){writing=true;return q},maybeSingle(){return q},
      throwOnError(){if(failWrite) return Promise.reject(new Error('write unavailable'));return q},
      then(resolve,reject){return Promise.resolve({error:null,data:writing?null:table==='listings'?known:{cursor:cursor??{fallback_2_url:fallback.config.url,connector_attempts:warmed?[{role:'fallback_2',status:'ok'}]:[]}}}).then(resolve,reject)}};
    return q;
  }};
  const api=vm.runInNewContext(stripTypeScriptTypes(source)+`;({runGcp,n,sameNum,setDiscover(fn){discover=fn},setMirror(fn){scoutMirrorStatus=fn}})`, {
    db,crypto:webcrypto,URL,iso:()=>new Date().toISOString(),
    upsertCandidates:async(_,rows,eligible)=>{writes.push({keys:rows.map(r=>r.key),eligible});return {seen:rows.length,fresh:rows.length}},
    markSuccess:async()=>{},markFailure:async(_,__,error)=>({ok:false,error:String(error)}),
  });
  api.setDiscover(async(url,lane)=>{calls.push(lane);if(lane==='gcp_primary'?failPrimary:failFallback)throw new Error('HTTP 503');return {url,discovered:1,candidates:lane==='gcp_primary'?primaryRows:fallbackRows,errors:[]}});
  api.setMirror(async()=>({checked:1,matches:[{gcp_key:'cached'}]}));
  return {api,writes,calls,run:(connectors=[primary,fallback])=>api.runGcp({id:8,baseline_completed_at:'2026-08-01'},connectors)};
}
test('GCP delivers new verified fallback IDs after fallback baseline',async()=>{
  const h=harness();const result=await h.run();assert.equal(result.ok,true);assert.equal(result.new,1);assert.equal(h.writes[0].eligible,true);
});
test('GCP first fallback snapshot and changed URL cannot release old inventory',async()=>{
  for(const options of [{warmed:false},{cursor:{fallback_baseline_url:'https://old.test'}}]){
    const h=harness(options);const result=await h.run();assert.equal(result.new,0);assert.equal(h.writes[0].eligible,false);
  }
});
test('GCP retains the fallback baseline across a temporary lane failure',async()=>{
  const h=harness({cursor:{fallback_baseline_url:fallback.config.url,connector_attempts:[{role:'fallback_2',status:'error'}]}});
  assert.equal((await h.run()).new,1);
});
test('GCP never re-promotes an existing blocked listing',async()=>{
  const h=harness({known:[{source_listing_key:'new',fresh_delivery_eligible:false}]});
  assert.equal((await h.run()).new,0);assert.equal(h.writes[0].eligible,false);
});
test('GCP respects shadow fallback configuration',async()=>{
  const h=harness({primaryRows:[{key:'primary'}]});await h.run([primary,{...fallback,shadow_only:true}]);assert.deepEqual(h.calls,['gcp_primary']);
});
test('GCP cached portal mirrors cannot mask failure of both direct lanes',async()=>{
  const h=harness({failPrimary:true,failFallback:true});assert.equal((await h.run([primary,fallback,mirror])).ok,false);assert.equal(h.writes.length,0);
});
test('GCP fails the crawl when coverage cannot be stored',async()=>{
  const h=harness({failWrite:true});assert.equal((await h.run()).ok,false);
});
test('GCP missing numeric fields do not create false zero-valued mirror matches',()=>{
  const {api}=harness();assert.equal(api.n(null),null);assert.equal(api.n(' '),null);assert.equal(api.sameNum(null,null,1),false);assert.equal(api.sameNum('45',45,1),true);
});
