import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchImmoweltSource} from '../cloudflare/housing-runtime/src/immowelt-source.js';

const card = (id, address, extra = '') => `<div id="classified-card-${id}"><a href="/expose/${id}" title="Wohnung zur Miete - Ort - 900 € - 2 Zimmer, 60 m²">x</a>900 € Kaltmiete 2 Zimmer · 60 m² ${address} ${extra}</div>`;

async function postalCodes(html) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Object.defineProperty(new Response(html, {status: 200}), 'url', {value: 'https://www.immowelt.de/suche/x'});
  try {
    const result = await fetchImmoweltSource({id: 3}, {url: 'https://www.immowelt.de/suche/mieten/wohnung/x'});
    return result.nodes.map((node) => node.facts.postal_code);
  } finally {
    globalThis.fetch = original;
  }
}

test('postal code is read outside Hamburg ranges (Schleswig-Holstein 24xxx/25xxx)', async () => {
  const codes = await postalCodes(card('a1', 'Wik, Kiel (24106)') + card('a2', 'Sylt, Westerland (25980)') + card('a3', 'Altona, Hamburg (22765)'));
  assert.deepEqual(codes, ['24106', '25980', '22765']);
});

test('postal code falls back to the Hamburg-range scan without parentheses', async () => {
  assert.deepEqual(await postalCodes(card('b1', 'Hamburg 20535')), ['20535']);
});

test('postal code is null when none is present', async () => {
  assert.deepEqual(await postalCodes(card('c1', 'Hamburg')), [null]);
});
