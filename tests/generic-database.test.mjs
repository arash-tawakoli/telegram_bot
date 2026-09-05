import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync(new URL('../supabase/functions/source-worker/generic.ts',import.meta.url),'utf8');
const api=vm.runInNewContext(stripTypeScriptTypes(source.slice(0,source.indexOf('import ')))+';({databaseQuery,CrawlDatabaseError})');
test('generic adapter does not silently accept PostgREST database errors',async()=>{
  await assert.rejects(api.databaseQuery(Promise.resolve({data:null,error:{message:'connection exhausted'}})),api.CrawlDatabaseError);
  await assert.rejects(api.databaseQuery(Promise.reject(new Error('network unavailable'))),api.CrawlDatabaseError);
});
test('generic adapter preserves successful data including an empty result',async()=>{
  const result={data:[],error:null};assert.equal(await api.databaseQuery(Promise.resolve(result)),result);
});
test('a failed fallback baseline read cannot be reported as a successful crawl',async()=>{
  let successes=0;
  const q={select(){return q},eq(){return q},limit(){return q},then(resolve){return Promise.resolve({data:null,error:{message:'database unavailable'}}).then(resolve)}};
  const executable=source.replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/shared.ts";/,'').replace('export async function','async function');
  const worker=vm.runInNewContext(stripTypeScriptTypes(executable)+';({runGeneric,setParser(fn){parseOne=fn}})',{
    db:{from:()=>q},URL,iso:()=>new Date().toISOString(),
    upsertCandidates:async()=>({seen:1,fresh:1}),
    markSuccess:async()=>{successes++},markFailure:async()=>({ok:false}),
  });
  worker.setParser(async()=>({cands:[{key:'one',url:'https://example.test/one'}]}));
  const result=await worker.runGeneric({id:50,coverage_strategy:'full_page',baseline_completed_at:'2026-08-01'},[
    {priority:1,kind:'html',config:{url:'https://example.test/primary'}},
    {priority:2,kind:'html',config:{url:'https://example.test/fallback'}},
  ]);
  assert.equal(result.ok,false);assert.equal(successes,0);
});
