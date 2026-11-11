import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const scoutPath=new URL('../supabase/functions/source-worker/scout.ts',import.meta.url);
const kleinPath=new URL('../supabase/functions/source-worker/klein.ts',import.meta.url);
const sourceWorkerPath=new URL('../supabase/functions/source-worker/index.ts',import.meta.url);
const targets=['Hamburg-Altstadt','Neuwerk','Steinwerder','Neuallermöhe','Tatenberg','Altenwerder','Gut Moor'];

test('ImmobilienScout prioritizes exact searches for all seven previously unverified neighborhoods',async()=>{
  const source=await readFile(scoutPath,'utf8');
  for(const target of targets)assert.ok(source.includes("name:'"+target+"'"),'missing exact target '+target);
  assert.match(source,/immoscout_mcp_exact_neighborhood_query/);
  assert.match(source,/exactNeighborhoodQuery:true/);
  assert.match(source,/TARGET_NEIGHBORHOODS\.map\(target=>\(\{borough:target\.borough,neighborhood:target\.name/);
  assert.match(source,/if\(cursor\.neighborhood_targets_seeded!==true\)/);
  assert.match(source,/queued\.filter\(\(x:any\)=>x\?\.coverage_target===true\)/);
  assert.match(source,/neighborhood_targets_seeded:true/);
});

test('Kleinanzeigen borough results are recorded as ambiguous, never as verified zero results',async()=>{
  const source=await readFile(kleinPath,'utf8');
  for(const target of targets)assert.ok(source.includes("name:'"+target+"'"),'missing borough evidence target '+target);
  assert.match(source,/kleinanzeigen_borough_level_page_not_neighborhood_specific/);
  assert.match(source,/p_search_status:'ambiguous'/);
  assert.match(source,/p_result_count:null/);
  assert.match(source,/exactNeighborhoodQuery:false/);
  assert.doesNotMatch(source,/D\.find\(\(\[,\],index\)=>false\)/);
});

test('source worker entrypoint remains the shared source-worker runtime',async()=>{
  const entry=await readFile(sourceWorkerPath,'utf8');
  assert.match(entry,/runScout/);
  assert.match(entry,/runKlein/);
  assert.match(entry,/claim_source_jobs/);
});
