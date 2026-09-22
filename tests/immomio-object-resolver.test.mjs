import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeImmomioApply,
  extractImmomioApplyUrlsFromText,
  collectImmomioApplyUrls,
} from '../supabase/functions/source-shadow/immomio-object-resolver.mjs';

const id='3baff237-f979-481f-9c14-69f3eadb86fb';

test('normalizes direct and /de apply URLs but rejects registration URLs',()=>{
  assert.deepEqual(
    normalizeImmomioApply(`https://tenant.immomio.com/de/apply/${id}/?utm_source=x`),
    {sourceIdentifier:id,url:`https://tenant.immomio.com/apply/${id}`},
  );
  assert.equal(
    normalizeImmomioApply('https://tenant.immomio.com/de/auth/register/propertyLocation?token=x'),
    null,
  );
});

test('extracts escaped tenant apply URLs from provider payloads',()=>{
  const text=`{"applicationLink":"https:\\/\\/tenant.immomio.com\\/apply\\/${id}"}`;
  assert.deepEqual(
    extractImmomioApplyUrlsFromText(text),
    [{sourceIdentifier:id,url:`https://tenant.immomio.com/apply/${id}`}],
  );
});

test('preserves multiple distinct tenant object identities for conflict handling',()=>{
  const id2='11111111-2222-3333-4444-555555555555';
  const hits=collectImmomioApplyUrls({
    detail:{application_url:`https://tenant.immomio.com/apply/${id}`},
    other:`https://tenant.immomio.com/de/apply/${id2}`,
  });
  assert.equal(hits.length,2);
});
