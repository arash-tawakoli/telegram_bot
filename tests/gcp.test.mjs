import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=readFileSync(new URL('../supabase/functions/source-worker/gcp.ts',import.meta.url),'utf8').replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/shared.ts";/,'').replace('export async function','async function');
const primary={priority:1,config:{adapter:'source-worker/gcp',url:'https://www.grandcityproperty.de/wohnungssuche?cityField=Hamburg'}};
function harness({candidates=[{key:'new'}],errors=[],failure=false,writeFailure=false,baseline=true}={}){
 const writes=[],calls=[],successes=[];
 const api=vm.runInNewContext(stripTypeScriptTypes(source)+`;({runGcp,detailUrls,parseDetail,setDiscover(fn){discover=fn}})`,{
  URL,iso:()=>new Date().toISOString(),
  absolute:(base,url)=>new URL(url,base).href,
  strip:x=>x.replace(/<[^>]+>/g,' '),deNum:x=>x==null?null:Number(x.replace(',','.')),hhZip:x=>x.startsWith('2'),imageFromHtml:()=>null,
  fetchText:async url=>({url,text:'<h1>Wohnung Hamburg</h1> Kaltmiete 800 € 2 Zimmer 50 m² 20095 Hamburg'}),
  upsertCandidates:async(_,rows,eligible)=>{if(writeFailure)throw Error('write unavailable');writes.push({rows,eligible});return{seen:rows.length,fresh:eligible?rows.length:0}},
  markSuccess:async(...args)=>successes.push(args),markFailure:async(_,__,e)=>({ok:false,error:String(e)})
 });
 api.setDiscover(async(url,lane)=>{calls.push({url,lane});if(failure)throw Error('HTTP 503');return{discovered:candidates.length+errors.length,candidates,errors}});
 return{api,writes,calls,successes,run:(cs=[primary])=>api.runGcp({id:8,baseline_completed_at:baseline?'2026-08-01':null},cs)};
}
test('GCP uses only the working primary connector and reports incomplete inventory',async()=>{
 const h=harness();const r=await h.run([primary,{priority:2,config:{adapter:'source-worker/gcp-scout-mirror'}},{priority:3,config:{adapter:'source-worker/gcp-recommendations'}}]);
 assert.equal(r.ok,true);assert.equal(r.new,1);assert.equal(r.complete,false);assert.equal(h.calls.length,1);assert.equal(h.calls[0].lane,'gcp_primary');assert.equal(h.successes[0][5].strategy,'gcp_primary');
});
test('GCP initial baseline does not release inventory',async()=>{
 const h=harness({baseline:false});assert.equal((await h.run()).new,0);assert.equal(h.writes[0].eligible,false);
});
test('GCP refuses shadow-only primary and does not consult inactive mirror lanes',async()=>{
 const h=harness();assert.equal((await h.run([{...primary,shadow_only:true}])).ok,false);assert.equal(h.calls.length,0);
});
test('GCP transport and persistence failure cannot be reported as successful crawls',async()=>{
 for(const options of [{failure:true},{writeFailure:true}]){const h=harness(options);assert.equal((await h.run()).ok,false);assert.equal(h.successes.length,0);}
});
test('GCP all-detail failures cannot be reported as an empty successful inventory',async()=>{
 const h=harness({candidates:[],errors:['detail HTTP 503']});assert.equal((await h.run()).ok,false);assert.equal(h.writes.length,0);
});
test('GCP partial results retain successful candidates and expose detail errors',async()=>{
 const h=harness({errors:['other detail failed']});assert.equal((await h.run()).fetched,1);assert.equal(h.successes[0][5].detail_errors.length,1);assert.equal(h.successes[0][5].complete,false);
});
test('GCP link extraction is scoped to official Hamburg exposes',()=>{
 const h=harness();const links=h.api.detailUrls('<a href="/wohnungssuche/hamburg/altona/expose/42">yes</a><a href="https://evil.test/wohnungssuche/hamburg/altona/expose/43">no</a><a href="/wohnungssuche/berlin/mitte/expose/44">no</a>',primary.config.url);
 assert.equal(links.length,1);assert.equal(links[0].key,'42');
});
test('GCP actual detail parser retains known rent and avoids invented address',async()=>{
 const h=harness();const r=await h.api.parseDetail('https://www.grandcityproperty.de/wohnungssuche/hamburg/altona/expose/42','42','gcp_primary');
 assert.equal(r.cold,800);assert.equal(r.address,undefined);assert.equal(r.raw.provider,'grand_city_property');
});
