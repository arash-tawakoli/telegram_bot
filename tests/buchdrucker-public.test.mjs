import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBuchdruckerApplicationRefs,
  parseBuchdruckerFeed,
} from '../supabase/functions/source-worker/buchdrucker-public.ts';

test('Buchdrucker empty RSS is a complete empty inventory seed set',()=>{
  const rss='<?xml version="1.0"?><rss><channel><title>Immobilienangebot</title></channel></rss>';
  const parsed=parseBuchdruckerFeed(rss);
  assert.equal(parsed.enumerated,0);
  assert.deepEqual(parsed.seeds,[]);
});

test('Buchdrucker RSS preserves listing identity and Hamburg fields',()=>{
  const rss=`<?xml version="1.0"?><rss><channel><item>
    <title><![CDATA[2 Zimmer Wohnung Hamburg]]></title>
    <link>https://buchdrucker.immomio.de/immobilien/test-wohnung/</link>
    <guid>buchdrucker-123</guid>
    <description><![CDATA[Beispielstraße 12, 22303 Hamburg 2 Zimmer 55 m² Kaltmiete 700 € https://rdr.immomio.com/J9tiu]]></description>
  </item></channel></rss>`;
  const parsed=parseBuchdruckerFeed(rss);
  assert.equal(parsed.enumerated,1);
  assert.equal(parsed.seeds.length,1);
  assert.equal(parsed.seeds[0].key,'buchdrucker-123');
  assert.equal(parsed.seeds[0].zip,'22303');
  assert.equal(parsed.seeds[0].rooms,2);
  assert.equal(parsed.seeds[0].area,55);
});

test('Buchdrucker application refs accept only Immomio apply and redirect hosts',()=>{
  const id='3baff237-f979-481f-9c14-69f3eadb86fb';
  const refs=extractBuchdruckerApplicationRefs(
    `https://tenant.immomio.com/de/apply/${id}?utm_source=x https://rdr.immomio.com/J9tiu https://evil.example/J9tiu`
  );
  assert.deepEqual(refs.applies,[`https://tenant.immomio.com/apply/${id}`]);
  assert.deepEqual(refs.redirects,['https://rdr.immomio.com/J9tiu']);
});
