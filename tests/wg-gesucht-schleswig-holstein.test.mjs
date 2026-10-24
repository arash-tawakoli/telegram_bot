import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const categorySource = readFileSync(new URL('../supabase/functions/source-worker/category.ts', import.meta.url), 'utf8');
const kleinSource = readFileSync(new URL('../supabase/functions/source-worker/klein.ts', import.meta.url), 'utf8');
const genericSource = readFileSync(new URL('../supabase/functions/source-worker/generic.ts', import.meta.url), 'utf8');
const sharedSource = readFileSync(new URL('../supabase/functions/source-worker/shared.ts', import.meta.url), 'utf8');

function loadScope(source, extra = {}) {
  const code = stripTypeScriptTypes(source.replace(/^import[^;]+;\n/gm, '').replace(/^export\s+\{[^}]+\}\s+from[^;]+;\n/gm, '').replaceAll('export ', ''));
  const scope = { URL, Map, Set, Date, Intl, console, AbortSignal, Response, ...extra };
  vm.runInNewContext(code, scope);
  return scope;
}

test('WG-Gesucht directory parser extracts unique Schleswig-Holstein city IDs', () => {
  const scope = loadScope(categorySource);
  const html = [
    '<a href="/anzeigen-in-Eckernfoerde.1280.html">Eckernförde</a>',
    '<a href="https://www.wg-gesucht.de/anzeigen-in-Neuendorf-b.-Elmshorn.3456.html">Neuendorf b. Elmshorn</a>',
    '<a href="/anzeigen-in-Eckernfoerde.1280.html">duplicate</a>',
    '<a href="/anzeigen-in-Hamburg.55.html">outside SH</a>',
    '<a href="/other-page.html">not a city</a>',
  ].join('');
  const cities = scope.parseWgGesuchtSHCities(html, 'https://www.wg-gesucht.de/staedte-in-schleswig-holstein.13.html', ['Eckernförde', 'Neuendorf b. Elmshorn']);
  assert.deepEqual(JSON.parse(JSON.stringify(cities)), [
    { slug: 'Eckernfoerde', id: '1280' },
    { slug: 'Neuendorf-b.-Elmshorn', id: '3456' },
  ]);
});

test('WG-Gesucht category URLs match the provider city/category URL contract', () => {
  const scope = loadScope(categorySource);
  const city = { slug: 'Eckernfoerde', id: '1280' };
  assert.equal(scope.wgGesuchtSHCategoryUrl(city, 'room'), 'https://www.wg-gesucht.de/wg-zimmer-in-Eckernfoerde.1280.0.1.0.html');
  assert.equal(scope.wgGesuchtSHCategoryUrl(city, 'one_room'), 'https://www.wg-gesucht.de/1-zimmer-wohnungen-in-Eckernfoerde.1280.1.1.0.html');
  assert.equal(scope.wgGesuchtSHCategoryUrl(city, 'apartment'), 'https://www.wg-gesucht.de/wohnungen-in-Eckernfoerde.1280.2.1.0.html');
  assert.equal(scope.wgGesuchtSHCategoryUrl(city, 'house'), 'https://www.wg-gesucht.de/haeuser-in-Eckernfoerde.1280.3.1.0.html');
  assert.throws(() => scope.wgGesuchtSHCategoryUrl(city, 'unknown'), /Unsupported WG-Gesucht/);
});

test('WG-Gesucht pagination only queues later pages of the same city/category', () => {
  const scope = loadScope(categorySource);
  const current = 'https://www.wg-gesucht.de/wohnungen-in-Kiel.71.2.1.0.html';
  const queued = new Set([current, 'https://www.wg-gesucht.de/wohnungen-in-Kiel.71.2.1.0.html?page=2&city_id=71']);
  const html = [
    '<a href="?page=2&amp;city_id=71">2</a>',
    '<a href="?page=3&amp;city_id=71">3</a>',
    '<a href="/wg-zimmer-in-Kiel.71.0.1.0.html?page=4">WG</a>',
    '<a href="?page=1">1</a>',
  ].join('');
  const pages = scope.wgGesuchtPaginationUrls(html, current, queued);
  assert.deepEqual(JSON.parse(JSON.stringify(pages)), [
    'https://www.wg-gesucht.de/wohnungen-in-Kiel.71.2.1.0.html?page=3&city_id=71',
  ]);
});

test('WG-Gesucht detail URLs are recognized and mapped to the listing locality', () => {
  const scope = loadScope(categorySource);
  assert.equal(
    scope.wgGesuchtListingCity('https://www.wg-gesucht.de/wg-zimmer-in-Ahrensburg-Ahrensburg.14216536.html', 'Ahrensburg'),
    'Ahrensburg',
  );
  assert.equal(
    scope.wgGesuchtListingCity('https://www.wg-gesucht.de/wg-zimmer-in-Ahrensburg-Nienwohld.3923634.html', 'Ahrensburg'),
    'Nienwohld',
  );
  assert.equal(
    scope.wgGesuchtListingCity('https://www.wg-gesucht.de/wohnung-in-Bad-Bramstedt-Bad-Bramstedt.1234567.html', 'Bad Bramstedt'),
    'Bad Bramstedt',
  );
  const shared = loadScope(sharedSource, {
    Deno: { env: { get: (key) => key === 'SUPABASE_URL' ? 'https://example.supabase.co' : key === 'SUPABASE_SECRET_KEYS' ? '{"default":"test"}' : 'test' } },
    createClient: () => ({}),
    HH_ZIPS: new Set(),
    fetchProvider: async () => new Response(''),
    checked: (value) => value,
  });
  assert.equal(shared.strongUrl('https://www.wg-gesucht.de/wg-zimmer-in-Ahrensburg-Ahrensburg.14216536.html'), true);
});

test('WG-Gesucht only accepts category-specific empty headings as verified empty results', () => {
  const scope = loadScope(categorySource, {
    strip: (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim(),
  });
  assert.equal(
    scope.wgGesuchtVerifiedEmptyResult('<h2>2 WG-Zimmer | 4 Angebote in allen Kategorien in Ahrensburg</h2><a href="/14216536.html">Zimmer</a>', 'room'),
    false,
  );
  assert.equal(
    scope.wgGesuchtVerifiedEmptyResult('<h2>0 WG-Zimmer | 0 Angebote in Ahlefeld-Bistensee</h2>', 'room'),
    true,
  );
  assert.equal(
    scope.wgGesuchtVerifiedEmptyResult('<h2>3 Wohnungen | 5 Angebote in Kiel</h2>', 'apartment'),
    false,
  );
  assert.equal(
    scope.wgGesuchtVerifiedEmptyResult('<h2>0 Häuser | 0 Angebote in Ahneby</h2>', 'house'),
    true,
  );
  assert.equal(
    scope.wgGesuchtVerifiedEmptyResult('<h2>1 Angebot in allen Kategorien in Ammersbek</h2>', 'house'),
    true,
  );
  assert.equal(
    scope.wgGesuchtVerifiedEmptyResult('<h2>1 Angebot in allen Kategorien in Ammersbek</h2><a href="/14216536.html">Hausangebot</a>', 'house'),
    false,
  );
});

test('regional crawl batch limits remain bounded', () => {
  assert.match(categorySource, /const WG_SH_BATCH_SIZE = 10;/);
  assert.match(kleinSource, /const maxPagesPerRun=6;/);
});

test('Kleinanzeigen category pagination supports both provider route layouts', () => {
  const scope = loadScope(kleinSource);
  const base = 'https://www.kleinanzeigen.de/s-wohnung-mieten/schleswig-holstein/wohnungen--mieten/k0c203l408?sortingField=SORTING_DATE';
  assert.deepEqual(
    JSON.parse(JSON.stringify(scope.kleinCategoryPageUrls(base, 2))),
    [
      'https://www.kleinanzeigen.de/s-wohnung-mieten/schleswig-holstein/wohnungen--mieten/seite:2/k0c203l408?sortingField=SORTING_DATE',
      'https://www.kleinanzeigen.de/s-wohnung-mieten/schleswig-holstein/seite:2/wohnungen--mieten/k0c203l408?sortingField=SORTING_DATE',
    ],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(scope.kleinCategoryPageUrls('https://www.kleinanzeigen.de/s-haus-mieten/schleswig-holstein/c205l408?sortingField=SORTING_DATE', 1))),
    ['https://www.kleinanzeigen.de/s-haus-mieten/schleswig-holstein/c205l408?sortingField=SORTING_DATE'],
  );
});
