import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const categorySource = readFileSync(new URL('../supabase/functions/source-worker/category.ts', import.meta.url), 'utf8');
const kleinSource = readFileSync(new URL('../supabase/functions/source-worker/klein.ts', import.meta.url), 'utf8');

function loadScope(source, extra = {}) {
  const code = stripTypeScriptTypes(source.replace(/^import[^;]+;\n/gm, '').replaceAll('export ', ''));
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
  const queued = new Set([current, 'https://www.wg-gesucht.de/wohnungen-in-Kiel.71.2.1.0.html?page=2']);
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

test('Kleinanzeigen category URLs insert the page segment before the location code', () => {
  const scope = loadScope(kleinSource);
  assert.equal(
    scope.kleinCategoryPageUrl('https://www.kleinanzeigen.de/s-wohnung-mieten/schleswig-holstein/wohnungen--mieten/k0c203l408?sortingField=SORTING_DATE', 2),
    'https://www.kleinanzeigen.de/s-wohnung-mieten/schleswig-holstein/wohnungen--mieten/seite:2/k0c203l408?sortingField=SORTING_DATE',
  );
  assert.equal(
    scope.kleinCategoryPageUrl('https://www.kleinanzeigen.de/s-haus-mieten/schleswig-holstein/c205l408?sortingField=SORTING_DATE', 1),
    'https://www.kleinanzeigen.de/s-haus-mieten/schleswig-holstein/c205l408?sortingField=SORTING_DATE',
  );
});
