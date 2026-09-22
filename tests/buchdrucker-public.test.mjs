import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countBuchdruckerFeedItems,
  extractBuchdruckerApplicationRefs,
  normalizeBuchdruckerApply,
  normalizeBuchdruckerRedirect,
} from '../supabase/functions/source-worker/buchdrucker-refs.mjs';

test('Buchdrucker feed inventory count distinguishes valid empty RSS',()=>{
  assert.equal(countBuchdruckerFeedItems('<?xml version="1.0"?><rss><channel><title>Immobilien</title></channel></rss>'),0);
  assert.equal(countBuchdruckerFeedItems('<html>not a feed</html>'),null);
});

test('Buchdrucker application refs accept only trusted Immomio hosts',()=>{
  const id='3baff237-f979-481f-9c14-69f3eadb86fb';
  const refs=extractBuchdruckerApplicationRefs(
    `https://tenant.immomio.com/de/apply/${id}?utm_source=x https://rdr.immomio.com/J9tiu https://evil.example/J9tiu`
  );
  assert.deepEqual(refs.applies,[`https://tenant.immomio.com/apply/${id}`]);
  assert.deepEqual(refs.redirects,['https://rdr.immomio.com/J9tiu']);
});

test('Buchdrucker URL normalization is fail closed',()=>{
  const id='3baff237-f979-481f-9c14-69f3eadb86fb';
  assert.equal(normalizeBuchdruckerApply(`https://tenant.immomio.com/apply/${id}`),`https://tenant.immomio.com/apply/${id}`);
  assert.equal(normalizeBuchdruckerApply(`http://tenant.immomio.com/apply/${id}`),null);
  assert.equal(normalizeBuchdruckerApply('https://tenant.immomio.com/de/auth/register/propertyLocation'),null);
  assert.equal(normalizeBuchdruckerRedirect('https://rdr.immomio.com/J9tiu?tracking=x'),'https://rdr.immomio.com/J9tiu');
  assert.equal(normalizeBuchdruckerRedirect('https://example.com/J9tiu'),null);
});
