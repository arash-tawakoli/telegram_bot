import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageTimestampProof} from '../supabase/functions/source-worker/coverage-newness.ts';

const now=Date.parse('2026-09-22T19:00:00Z');
test('coverage promotion accepts only a current provider publication timestamp',()=>{
  assert.deepEqual(coverageTimestampProof({publishedAt:'2026-09-22T18:50:00Z'},now),{
    method:'source_timestamp',source_published_at:'2026-09-22T18:50:00.000Z'
  });
  for(const entry of [{},{publishedAt:'2026-09-20T18:50:00Z'},{publishedAt:'tomorrow'},{publishedAt:'2026-09-22T19:10:00Z'}])
    assert.equal(coverageTimestampProof(entry,now),null);
});
