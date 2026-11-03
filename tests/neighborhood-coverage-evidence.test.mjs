import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const scoutPath=new URL('../supabase/functions/source-worker/scout.ts',import.meta.url);
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

test('source worker entrypoint remains the shared source-worker runtime',async()=>{
  const entry=await readFile(sourceWorkerPath,'utf8');
  assert.match(entry,/runScout/);
  assert.doesNotMatch(entry,/runKlein/);
  assert.match(entry,/claim_source_jobs/);
});
