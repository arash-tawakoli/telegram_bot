import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const path=new URL('../supabase/functions/source-worker/scout.ts',import.meta.url);
const source=readFileSync(path,'utf8').replace(/^import[^;]+;\s*/gm,'').replaceAll('export ','');
test('Scout keeps all fresh calls, limits coverage to one and avoids overwriting fresh IDs',async()=>{
 const calls=[],writes=[];let telemetry;
 const state={status:'running',cycle_id:'cycle',cycle_started_at:'2026-09-19T15:00:00Z',seen_count:0,request_count:0,cursor:{queue:[{borough:'Altona'},{borough:'Harburg'},{borough:'Wandsbek'},{borough:'Bergedorf'}],fresh_borough_index:0}};
 const db={from(table){const q={select(){return q},eq(){return q},in(){return q},maybeSingle(){return q},update(){return q},upsert(){return q},throwOnError:async()=>({data:table==='source_coverage_state'?state:[]})};return q}};
 const fetch=async(_url,options)=>{const payload=JSON.parse(options.body);calls.push(payload);if(payload.method!=='tools/call')return new Response('{}');const entry={id:'same-offer',title:'Wohnung',address:{city:'Hamburg',postcode:'20095'},price:{value:650},totalRent:750};return new Response(JSON.stringify({result:{structuredContent:{entries:[entry],total:1}}}))};
 const api=vm.runInNewContext(stripTypeScriptTypes(source)+';({runScout})',{db,fetch,crypto:webcrypto,AbortSignal,Response,Date,UA:'audit-test',deNum:x=>x==null?null:Number(x),iso:()=>new Date().toISOString(),markSuccess:async(...args)=>{telemetry=args[5]},markFailure:async(_,__,e)=>{throw e},coverageTimestampProof:()=>null,upsertCandidates:async(_s,rows,fresh)=>{if(!rows.length)return{seen:0,fresh:0,keys:[]};writes.push({rows,fresh});return{seen:rows.length,fresh:0,keys:[]}}});
 await api.runScout({id:1,last_success_at:new Date().toISOString()});
 assert.equal(calls.length,10); // two handshake + six fresh + two coverage
 const toolCalls=calls.filter(x=>x.method==='tools/call');
 assert.equal(toolCalls.filter(x=>x.params.arguments.query.includes('neueste Inserate')).length,6);
 assert.equal(telemetry.coverage_partitions,1);assert.equal(telemetry.requests,10);
 assert.equal(writes.length,1); // empty duplicate coverage batches are no-op in upsertCandidates
 assert.ok(writes[0].fresh);assert.ok(writes[0].rows.some(row=>row.key==='same-offer'));
});
