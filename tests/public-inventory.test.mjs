import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const root=new URL('../supabase/functions/source-worker/',import.meta.url);
const shared=readFileSync(new URL('shared.ts',root),'utf8');
const helpers=shared.slice(shared.indexOf('export function deNum'),shared.indexOf('export function absolute')).replaceAll('export ','');
const source=readFileSync(new URL('public-inventory.ts',root),'utf8').replace(/import[^;]+;/,'').replaceAll('export ','');
export const parsers=vm.runInNewContext(stripTypeScriptTypes(helpers+'\n'+source)+';({parseTagInventory,parseUrbanInventory,parseHeimInventory})',{URL});
test('TAG validates zero hits and rejects truncated or malformed inventory',()=>{
 assert.equal(parsers.parseTagInventory(JSON.stringify({response:{results:[],meta:{hits:0}}})).complete,true);
 assert.throws(()=>parsers.parseTagInventory('{}'),/schema/);
 assert.throws(()=>parsers.parseTagInventory(JSON.stringify({response:{results:[],meta:{hits:1}}})),/coverage/);
});
test('TAG filters outside Hamburg and preserves explicitly named rents',()=>{
 const result=parsers.parseTagInventory(JSON.stringify({response:{meta:{hits:2},results:[{id:'1/2/3',title:'Wohnung',address:'Teststraße 1, 22763 Hamburg',number_of_rooms:2,living_space:50,netto_cold:600,overall_warm:800},{id:'outside',address:'09127 Chemnitz'}]}}));
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].cold,600);assert.equal(result.candidates[0].warm,800);assert.match(result.candidates[0].url,/object_id=1%2F2%2F3/);
});
const card=status=>`<a title="Komfort-Apartment Nr. 0.19" id="btn19" data-img="/plan.png" data-text="Gr&amp;ouml;&amp;szlig;e: 23.90 m&amp;sup2;&lt;br&gt;Kaltmiete: 644 &amp;euro;&lt;br&gt;Nebenkosten: 184 &amp;euro;&lt;br&gt;Status: &lt;span class=unit_reserved&gt;${status}&lt;/span&gt;" class="btn apartment">`;
test('Urban distinguishes reserved, occupied and free units and deduplicates mobile markup',()=>{
 assert.equal(parsers.parseUrbanInventory(card('reserviert')+card('reserviert')).enumerated,1);
 assert.equal(parsers.parseUrbanInventory(card('vermietet')).candidates.length,0);
 const row=parsers.parseUrbanInventory(card('frei')).candidates[0];
 assert.equal(row.key,'0.19');assert.equal(row.cold,644);assert.equal(row.additional,184);assert.equal(row.area,23.9);assert.equal(row.warm,undefined);
 assert.throws(()=>parsers.parseUrbanInventory(card('frei')+card('reserviert')),/conflicting/);
 assert.throws(()=>parsers.parseUrbanInventory('<html>unavailable</html>'),/missing/);
});
test('Heimstaden requires Hamburg scope and an explicit empty response',()=>{
 assert.equal(parsers.parseHeimInventory('Hamburg Leider konnten keine Angebote mit den gew&uuml;nschten Kriterien gefunden werden.').complete,true);
 assert.throws(()=>parsers.parseHeimInventory('Hamburg loading...'),/schema/);
 assert.throws(()=>parsers.parseHeimInventory('Berlin Leider konnten keine Angebote mit den gewünschten Kriterien gefunden werden.'),/filter/);
});
test('public inventory warms a changed route before releasing new apartments',async()=>{
 for(const warmed of [false,true]){
  const url='https://www.urban-living-hamburg.de/mieten',adapter='source-worker/urban-public',writes=[];
  const db={from(table){let read=false;const q={select(){read=true;return q},eq(){return q},in(){return q},maybeSingle(){return q},upsert(){return q},update(){return q},throwOnError:async()=>({data:read?(table==='source_coverage_state'?{cursor:warmed?{adapter,url}:{}}:[]):null,error:null})};return q}};
  const run=vm.runInNewContext(stripTypeScriptTypes(helpers+'\n'+source)+';runPublicInventory',{URL,crypto:webcrypto,db,iso:()=>new Date().toISOString(),fetchText:async()=>({text:card('frei')}),upsertCandidates:async(_,rows,fresh)=>{if(rows.length)writes.push(fresh);return {seen:rows.length,fresh:rows.length}},markSuccess:async()=>{},markFailure:async(_,__,e)=>{throw e}});
  const result=await run({id:50,baseline_completed_at:'2026-09-01'},{config:{adapter,url}});
  assert.equal(result.ok,true);assert.deepEqual(writes,[warmed]);
 }
});
