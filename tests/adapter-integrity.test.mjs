import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
function load(name,globals,extra=''){
 if(name==='immomio'){
  const helper=readFileSync(new URL('../supabase/functions/source-worker/immomio-inventory.ts',import.meta.url),'utf8').replace(/import[^;]+;/,'').replaceAll('export ','');
  globals.fetchImmomioInventory=vm.runInNewContext(stripTypeScriptTypes(helper)+';fetchImmomioInventory',{URL,atob,AbortSignal,...globals});
 }
 const source=readFileSync(new URL(`../supabase/functions/source-worker/${name}.ts`,import.meta.url),'utf8').replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/g,'').replaceAll('export async function','async function');
 return vm.runInNewContext(stripTypeScriptTypes(source)+extra,{URL,AbortSignal,SUPABASE_URL:'https://example.test',iso:()=>new Date().toISOString(),...globals});
}
function failingDb(){const q={select(){return q},eq(){return q},maybeSingle(){return q},throwOnError:async()=>{throw new Error('database unavailable')}};return {from:()=>q};}
test('Scout cannot restart coverage after a failed cursor read',async()=>{
 let successes=0;
 const run=load('scout',{db:failingDb(),markFailure:async()=>({ok:false}),markSuccess:async()=>{successes++}},';init=async()=>{};runScout;');
 assert.equal((await run({id:1})).ok,false);assert.equal(successes,0);
});
test('Kleinanzeigen cannot continue crawling after a failed cursor read',async()=>{
 const run=load('klein',{db:failingDb(),internalSecret:async()=>'',markFailure:async()=>({ok:false})},';runKlein;');
 await assert.rejects(run({id:2}),/database unavailable/);
});
test('Immomio fails when it cannot reconcile active inventory',async()=>{
 let successes=0;
 let writes=0;
 const run=load('immomio',{db:failingDb(),fetch:async()=>({ok:true,json:async()=>({data:{propertyList:{page:{page:0,size:250,totalPages:0,totalElements:0},nodes:[]}}})}),upsertCandidates:async()=>{writes++;return {seen:0,fresh:0}},markFailure:async()=>({ok:false}),markSuccess:async()=>{successes++}},';runImmomio;');
 assert.equal((await run({id:23,baseline_completed_at:'2026-08-01'},{config:{url:'https://homepage.immomio.com/?token=fixture'}})).ok,false);assert.equal(successes,0);assert.equal(writes,1);
});
const config={mandator_id:'123',server:'example.test',mandator_hash:'fixture',object_identifiers:[1],presentation_id:'fixture'};
for(const [name,response] of [['missing inventory',{}],['truncated pagination',{immoObjects:[],totalPages:21}],['invalid pagination',{immoObjects:[],totalPages:'invalid'}]]){
 test(`ImmoSolve rejects ${name} before storing or deactivating listings`,async()=>{
  let writes=0;
  const run=load('hpm',{fetchJson:async()=>response,upsertCandidates:async()=>{writes++;return {seen:0,fresh:0}},markFailure:async()=>({ok:false})},';runHpm;');
  assert.equal((await run({id:24},{config})).ok,false);assert.equal(writes,0);
 });
}
test('ImmoSolve accepts an explicit empty inventory',async()=>{
 let successes=0;
 const run=load('hpm',{fetchJson:async()=>({immoObjects:[],totalPages:0}),upsertCandidates:async()=>({seen:0,fresh:0}),markSuccess:async()=>{successes++},markFailure:async()=>({ok:false})},';runHpm;');
 assert.equal((await run({id:24},{config})).ok,true);assert.equal(successes,1);
});
