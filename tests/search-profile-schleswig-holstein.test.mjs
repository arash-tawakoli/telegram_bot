import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const profiles = read('supabase/functions/telegram-ui/profiles.js');
const handlers = read('supabase/functions/telegram-ui/handlers.js');
const coachApi = read('supabase/functions/coach-api/index.ts');

test('Telegram search profile offers statewide, county and municipality selection for Schleswig-Holstein', () => {
  assert.match(profiles, /Ganz Schleswig-Holstein/);
  assert.match(profiles, /Kreise \/ kreisfreie Städte/);
  assert.match(profiles, /Städte \/ Gemeinden/);
  assert.match(profiles, /area_type === "municipality"/);
  assert.match(profiles, /independent_city/);
});

test('Telegram persists selected SH area codes without changing the canonical location modes', () => {
  assert.match(handlers, /value === "counties_sh"/);
  assert.match(handlers, /value === "municipalities_sh"/);
  assert.match(handlers, /location_mode = "schleswig_holstein_areas"/);
  assert.match(profiles, /location_area_codes: Array\.isArray\(current\.location_area_codes\)/);
});

test('Coach API returns SH geography and round-trips selected area codes', () => {
  assert.match(coachApi, /admin\.rpc\('get_schleswig_holstein_areas'\)/);
  assert.match(coachApi, /schleswigHolsteinAreas:Array\.isArray\(sh\)\?sh:\[\]/);
  assert.match(coachApi, /location_state_code,location_area_codes/);
  assert.match(coachApi, /location_area_codes:Array\.isArray\(input\.location_area_codes\)/);
});
