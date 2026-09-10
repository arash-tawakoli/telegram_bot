import test from 'node:test';
import assert from 'node:assert/strict';
import {pageAvailability,recentInventory} from '../supabase/functions/notification-dispatcher/availability.ts';
test('unavailable and blocked detail pages cannot be treated as online',()=>{
  for(const status of [404,410])assert.equal(pageAvailability(status,true,''),'unavailable');
  assert.equal(pageAvailability(200,true,'<h1>Diese Anzeige ist nicht mehr verfügbar</h1>'),'unavailable');
  assert.equal(pageAvailability(200,true,'<title>Verify you are human</title>'),'unknown');
  assert.equal(pageAvailability(403,true,''),'unknown');
  assert.equal(pageAvailability(200,false,'<title>Wohnungen</title>'),'unknown');
  assert.equal(pageAvailability(200,true,'<title>Wohnung mieten</title><p>Andere Anzeige nicht mehr verfügbar</p>'),'online');
});
test('inventory fallback needs a fresh positive native source observation, never just first-seen time',()=>{
  const now=Date.parse('2026-09-08T21:00:00Z');
  const l={is_active:true,fresh_delivery_eligible:true,last_seen_at:'2026-09-08T20:55:00Z',raw:{provider:'immowelt',is_new:true}};
  assert.equal(recentInventory(l,now),true);
  assert.equal(recentInventory({...l,source_id:6,raw:{}},now),true);
  assert.equal(recentInventory({...l,source_id:6,last_seen_at:'2026-09-08T20:01:00Z',raw:{}},now),true);
  assert.equal(recentInventory({...l,source_id:6,last_seen_at:'2026-09-08T19:59:59Z',raw:{}},now),false);
  assert.equal(recentInventory({...l,source_id:7,raw:{}},now),false);
  for(const override of [{is_active:false},{last_seen_at:'2026-09-08T20:40:00Z'},{last_seen_at:'bad'},{fresh_delivery_eligible:false},{raw:{provider:'tauschwohnung_catalog',catalog_baseline_verified:true}},{raw:{provider:'immowelt',is_new:false}}])assert.equal(recentInventory({...l,...override},now),false);
});
