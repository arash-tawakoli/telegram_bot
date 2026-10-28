import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const category=readFileSync(new URL('../supabase/functions/source-worker/category.ts',import.meta.url),'utf8');
const klein=readFileSync(new URL('../supabase/functions/source-worker/klein.ts',import.meta.url),'utf8');
const categoryPersist=readFileSync(new URL('../supabase/functions/source-worker/category-persist.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20260920170532_enable_verified_category_streams.sql',import.meta.url),'utf8');

test('category discovery uses all verified production adapters',()=>{
  assert.match(category,/stream\.adapter==='scout'/);
  assert.match(category,/stream\.adapter==='kleinanzeigen'/);
  assert.match(category,/\['wg-gesucht','ohne-makler'\]\.includes\(stream\.adapter\)/);
  assert.match(category,/stream\.adapter==='immowelt'/);
  assert.match(category,/method:'source_timestamp'/);
  assert.match(categoryPersist,/category_stream:category/);
  assert.match(categoryPersist,/old\?\.raw\?\.category_stream!==category/);
  assert.match(categoryPersist,/poll_delta/);
  assert.match(categoryPersist,/complete_snapshot_delta/);
  assert.match(categoryPersist,/stream\?\.baseline_at/);
  assert.match(categoryPersist,/86400000/);
});

test('Kleinanzeigen apartment reconciliation cannot deactivate category rows',()=>{
  assert.match(klein,/property_kind\.is\.null,property_kind\.eq\.apartment/);
});

test('Kleinanzeigen room stream rejects complete apartments without a room signal',()=>{
  assert.match(klein,/wholeUnit/);
  assert.match(klein,/strongRoom/);
  assert.match(klein,/Zimmer\\b\.\{0,40\}\\bWohnung/);
});

function kleinCategory(html,upstream=200){
  let saved;
  const code=stripTypeScriptTypes(klein.replace(/^import[^;]+;\n/gm,'').replaceAll('export ',''));
  const scope={Response,AbortSignal,Date,URL,console,iso:()=>new Date().toISOString(),HH_ZIPS:new Set(['20095']),decode:s=>s,strip:s=>s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),deNum:s=>{const n=Number(String(s??'').replace(/[^\d.,]/g,'').replace(',','.'));return Number.isFinite(n)?n:null},fetchListingPage:async()=>new Response(html,{headers:{'x-upstream-status':String(upstream)}}),persistCategoryListings:async(_source,_stream,rows,complete)=>{saved={rows,complete};return{seen:rows.length,fresh:0}}};
  vm.runInNewContext(code,scope);
  return{run:category=>scope.runKleinCategory({id:2,search_capabilities:{region_state_code:'HH'}},{category,url:category==='house'?'https://www.kleinanzeigen.de/s-haus-mieten/hamburg/c205l20095':'https://www.kleinanzeigen.de/s-zimmer-mieten/hamburg/c199l20095'}),saved:()=>saved};
}
const card=(id,title)=>`<article data-adid="${id}" data-href="/s-anzeige/test/${id}-203-1"><div class="aditem-main--top--left">20095 Hamburg</div><a class="ellipsis">${title}</a><p class="aditem-main--middle--price-shipping--price">800 €</p><div class="aditem-main--middle--tags">2 Zi 50 m²</div></article>`;
test('Kleinanzeigen house and room discovery execute the existing transport and parser',async()=>{
  const html=card('123456789','Einfamilienhaus zur Miete')+card('123456790','WG Zimmer zur Miete')+card('123456791','2 Zimmer Wohnung');
  for(const [category,title] of [['house','Einfamilienhaus zur Miete'],['room','WG Zimmer zur Miete']]){const w=kleinCategory(html),r=await w.run(category);assert.equal(r.candidates,1);assert.equal(w.saved().rows[0].title,title);assert.equal(w.saved().complete,false);}
});
test('Kleinanzeigen category discovery rejects unsuccessful upstream responses',async()=>{
  const w=kleinCategory(card('123456789','Einfamilienhaus zur Miete'),403);await assert.rejects(w.run('house'),/upstream HTTP 403/);assert.equal(w.saved(),undefined);
});

test('category migration preserves baselines and reconciles all verified streams',()=>{
  for(const pair of ["(1::smallint,'house')","(2::smallint,'house')","(2::smallint,'room')","(6::smallint,'room')","(12::smallint,'house')"])
    assert.match(migration,new RegExp(pair.replace(/[()]/g,'\\$&')));
  assert.match(migration,/wg-zimmer\/k0c199l9409/);
  assert.doesNotMatch(migration,/baseline_at\s*=\s*null/i);
  assert.doesNotMatch(migration,/last_success_at\s*=\s*null/i);
  assert.match(migration,/whole_unit_misclassified_as_room/);
});
