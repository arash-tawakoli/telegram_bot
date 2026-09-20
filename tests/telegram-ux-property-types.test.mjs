import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';

const files=[
 'supabase/functions/telegram-ui/runtime.js',
 'supabase/functions/telegram-ui/profiles.js',
 'supabase/functions/telegram-ui/handlers.js',
 'supabase/functions/telegram-ui/navigation.js',
 'supabase/functions/telegram-ui/index.ts',
 'supabase/functions/telegram-gateway/index.ts',
 'supabase/functions/source-worker/shared.ts',
 'supabase/functions/source-worker/scout.ts',
 'supabase/functions/source-worker/klein.ts',
 'supabase/functions/source-worker/category.ts',
 'supabase/functions/source-worker/index.ts',
];

test('changed JavaScript and TypeScript files parse',()=>{
 for(const file of files){
  const args=file.endsWith('.ts')?['--experimental-strip-types','--check',file]:['--check',file];
  const r=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(r.status,0,`${file}: ${r.stderr}`);
 }
});

function profileApi(){
 let code=readFileSync('supabase/functions/telegram-ui/profiles.js','utf8')
  .replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const scope={
  crypto:webcrypto,
  PROPERTY_TYPES:['Wohnung','Haus','WG','Tauschwohnung'],
  RENT_PRESETS:new Set([800,1000,1250,2000]),
  ROOM_PRESETS:new Set([1,2,3,4]),
  AREA_PRESETS:new Set([20,50,70,90]),
  ROOM_AREA_PRESETS:new Set([0,8,10,12,15,20]),
  NEIGHBORHOODS_PER_PAGE:12,
  finiteOrNull:v=>v==null||v===''?null:Number(v),
  button:(text,callback_data)=>({text,callback_data}),
  saveState:async()=>{},
  edit:async(_c,_m,text,markup)=>({text,markup}),
  send:async(_c,text,markup)=>({text,markup}),
  backRow:(callback_data='home')=>[{text:'back',callback_data}],
  cancelRow:()=>[{text:'cancel',callback_data:'cancel'}],
  esc:String,money:v=>String(v),db:{},geography:async()=>({boroughs:[],neighborhoods:[]}),
 };
 const api=vm.runInNewContext(code+';({emptyDraft,normalizeDraft,validateDraft,includesWG,includesWholeHome,nextSizeStep,renderTypes})',scope);
 return api;
}

test('WG validates its own room size without whole-apartment room filters',()=>{
 const a=profileApi(),d=a.emptyDraft();
 Object.assign(d,{property_types:['WG'],location_mode:'all_hamburg',max_warm_rent:800,min_room_area_sqm:10});
 assert.equal(a.validateDraft(d),null);
 assert.equal(a.includesWG(d),true);assert.equal(a.includesWholeHome(d),false);assert.equal(a.nextSizeStep(d),'roomarea');
});

test('house and mixed searches keep correct sizing requirements',()=>{
 const a=profileApi(),h=a.emptyDraft();
 Object.assign(h,{property_types:['Haus'],location_mode:'all_hamburg',max_warm_rent:1250,min_rooms:3,min_area_sqm:70});
 assert.equal(a.validateDraft(h),null);assert.equal(a.nextSizeStep(h),'rooms');
 const mixed=a.emptyDraft();
 Object.assign(mixed,{property_types:['WG','Haus'],location_mode:'all_hamburg',max_warm_rent:1250,min_rooms:3,min_area_sqm:70});
 assert.equal(a.validateDraft(mixed),'roomarea');
 mixed.min_room_area_sqm=12;assert.equal(a.validateDraft(mixed),null);
});

test('type chooser is compact 2x2 and preserves all four canonical values',async()=>{
 const a=profileApi(),d=a.emptyDraft();
 const r=await a.renderTypes({id:'u'},1,2,d);
 assert.equal(r.markup.inline_keyboard[0].length,2);
 assert.equal(r.markup.inline_keyboard[1].length,2);
 const callbacks=r.markup.inline_keyboard.flat().map(x=>x.callback_data);
 for(const type of ['Wohnung','Haus','WG','Tauschwohnung'])assert.ok(callbacks.includes('type:'+type));
});

test('source classification stops treating unknown property types as apartments',()=>{
 const shared=readFileSync('supabase/functions/source-worker/shared.ts','utf8');
 assert.match(shared,/return null;\s*\}\)\(\),\s*furnished:/);
 assert.match(shared,/Einfamilienhaus\|Reihenhaus/);
});

test('category runner uses isolated leases and never marks a first baseline as fresh by itself',async()=>{
 let code=readFileSync('supabase/functions/source-worker/category.ts','utf8')
  .replace(/^import .*;\n/gm,'').replaceAll('export ','');
 code=stripTypeScriptTypes(code);
 const calls=[];
 const stream={source_id:2,category:'house',adapter:'kleinanzeigen',lease_token:'lease',baseline_at:null,cursor:{}};
 const db={rpc:async(name,args)=>{calls.push([name,args]);if(name==='claim_source_category_streams')return{data:[stream],error:null};if(name==='finish_source_category_stream')return{data:true,error:null};throw Error(name)}};
 const scope={db,Date,Intl,Error,console,
  runKleinCategory:async(_source,s)=>({requests:1,candidates:4,fresh:s.baseline_at?1:0,cursor:{ok:true}}),
  runScoutCategory:async()=>{throw Error('wrong adapter')},
  fetchText:async()=>{throw Error('wrong adapter')},parseHtml:()=>[],strip:x=>x,iso:()=>new Date().toISOString(),upsertCandidates:async()=>({seen:0,fresh:0,keys:[]})};
 const api=vm.runInNewContext(code+';({runCategoryStreams})',scope);
 const result=await api.runCategoryStreams({id:2});
 assert.equal(result[0].fresh,0);
 assert.equal(calls[0][0],'claim_source_category_streams');
 assert.equal(calls.at(-1)[0],'finish_source_category_stream');
 assert.equal(calls.at(-1)[1].p_success,true);
});
