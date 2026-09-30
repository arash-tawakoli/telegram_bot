import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const clean=s=>stripTypeScriptTypes(s).replace(/^(?:import|export\s*\{)[^;]*;/gm,'').replaceAll('export ','');
const generic=readFileSync(new URL('../supabase/functions/source-worker/generic.ts',import.meta.url),'utf8');
const sharedSource=readFileSync(new URL('../supabase/functions/source-worker/shared.ts',import.meta.url),'utf8');
function fixture(rows=[],html=''){
 const q={select(){return q},eq(){return q},then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve)}};
 const db={from:()=>q};
 const shared=vm.runInNewContext(clean(sharedSource)+';({parseFields,strip,absolute,deNum,imageFromHtml,collectJson,parseHtml,strongUrl})',{createClient:()=>db,Deno:{env:{get:()=>undefined}},URL,HH_ZIPS:new Set(),TextEncoder,crypto});
 const normCalls=[];
 const api=vm.runInNewContext(clean(generic)+';const originalNorm=providerNorm;providerNorm=value=>{normCalls.push(String(value));return originalNorm(value)};({applyCooperativeRegistry,parseOne})',{...shared,db,URL,crypto,normCalls,fetchText:async()=>({text:html,url:'https://www.immowelt.de/search'})});
 return{api,normCalls};
}
test('provider matching normalizes long candidate text once, with many aliases',async()=>{
 const rows=Array.from({length:55},(_,i)=>({provider_entity:'Provider '+i,aliases:['Other '+i,'Unmatched '+i],source_id:i}));
 const {api,normCalls}=fixture(rows);
 const text='Unrelated listing text '.repeat(350);
 const result=await api.applyCooperativeRegistry([{title:'Wohnung',raw:{_provider_text:text}}]);
 assert.equal(result[0].raw.provider_entity,undefined);
 assert.equal(normCalls.filter(s=>s.includes(text)).length,1);
 assert.equal(result[0].raw._provider_text,undefined);
});
test('provider aliases keep punctuation, umlaut and short-name boundary behavior',async()=>{
 const rows=[{provider_entity:'Finkenwärder-Hoffnung',aliases:['Finkenwärder Hoffnung'],source_id:42,registry_mode:'portal'},{provider_entity:'SAGA',aliases:['SAGA'],source_id:7,registry_mode:'portal'}];
 const {api}=fixture(rows);
 const result=await api.applyCooperativeRegistry([{title:'FINKENWÄRDER-HOFFNUNG Wohnung',raw:{}},{title:'SAGASTRASSE Wohnung',raw:{}},{title:'SAGA Wohnung',raw:{}}]);
 assert.equal(result[0].raw.provider_entity,'Finkenwärder-Hoffnung');
 assert.equal(result[0].raw.provider_source_id,42);
 assert.equal(result[1].raw.provider_entity,undefined);
 assert.equal(result[2].raw.provider_entity,'SAGA');
});
test('redirected Immowelt searches use the card parser regardless of source ID',async()=>{
 const html='<title>Wohnungen - 1 Angebote</title><div id="classified-card-one"><a href="/expose/fixture" title="Wohnung Hamburg">Details</a><p>2 Zimmer 60 m² 22339 Hamburg</p></div>';
 const {api}=fixture([],html);
 const result=await api.parseOne({id:99},{connector_kind:'html_discovery',config:{}},'https://fixture.test/');
 assert.equal(result.cands.length,1);
 assert.equal(result.cands[0].url,'https://www.immowelt.de/expose/fixture');
 assert.equal(result.total,1);
});
