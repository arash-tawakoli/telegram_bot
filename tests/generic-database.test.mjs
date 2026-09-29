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
  const executable=source.replace(/import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];/g,'').replaceAll('export async function','async function');
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
test('listing persistence failure aborts before fallback, deactivation or success',async()=>{
  let successes=0,parses=0;
  const executable=source.replace(/import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];/g,'').replaceAll('export async function','async function');
  const worker=vm.runInNewContext(stripTypeScriptTypes(executable)+';({runGeneric,setParser(fn){parseOne=fn}})',{
    db:{from(){throw new Error('must not deactivate or record success')}},URL,iso:()=>new Date().toISOString(),
    upsertCandidates:async()=>{throw new Error('upsert unavailable')},
    markSuccess:async()=>{successes++},markFailure:async()=>({ok:false}),
  });
  worker.setParser(async()=>{parses++;return {cands:[{key:'one',url:'https://example.test/one'}]}});
  const result=await worker.runGeneric({id:50,coverage_strategy:'full_page',baseline_completed_at:'2026-08-01'},[
    {priority:1,connector_kind:'html',enumerable:true,config:{url:'https://example.test/primary'}},
    {priority:2,connector_kind:'html',config:{url:'https://example.test/fallback'}},
  ]);
  assert.equal(result.ok,false);assert.equal(successes,0);assert.equal(parses,1);
});
test('an empty generic parse never deactivates inventory or claims completeness',async()=>{
  let metadata;
  const executable=source.replace(/import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];/g,'').replaceAll('export async function','async function');
  const worker=vm.runInNewContext(stripTypeScriptTypes(executable)+';({runGeneric,setParser(fn){parseOne=fn}})',{
    db:{from(){throw new Error('unexpected inventory deactivation')}},URL,iso:()=>new Date().toISOString(),
    upsertCandidates:async()=>({seen:0,fresh:0}),
    markSuccess:async(...args)=>{metadata=args.at(-1)},markFailure:async()=>({ok:false}),
  });
  worker.setParser(async()=>({cands:[]}));
  const result=await worker.runGeneric({id:50,coverage_strategy:'full_page',baseline_completed_at:'2026-08-01'},[
    {priority:1,connector_kind:'html',enumerable:true,config:{url:'https://example.test/primary'}},
  ]);
  assert.equal(result.ok,true);assert.equal(result.complete,false);assert.equal(metadata.empty_result_unverified,true);
});
