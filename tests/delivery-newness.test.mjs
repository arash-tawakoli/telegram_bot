import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryNewness,publicationFresh} from '../supabase/functions/notification-dispatcher/newness.ts';

const now=Date.parse('2026-09-19T09:30:00Z');
const base={
  source_id:12,
  first_seen_at:'2026-09-19T09:20:00Z',
  fresh_delivery_eligible:true,
  raw:{},
  sources:{baseline_completed_at:'2026-08-29T18:55:05Z'}
};

test('Kleinanzeigen only qualifies fast-lane source timestamps within 24 hours',()=>{
  const fresh={...base,source_id:2,raw:{lane:'fast',sorting_date:'Heute, 11:25'}};
  assert.equal(deliveryNewness(fresh,'new_listing',null,now).ok,true);
  assert.equal(deliveryNewness({...fresh,raw:{lane:'coverage',sorting_date:'Heute, 11:25'}},'new_listing',null,now).ok,false);
  assert.equal(deliveryNewness({...fresh,raw:{lane:'fast',sorting_date:'Gestern, 11:29'}},'new_listing',null,now).ok,false);
  assert.equal(deliveryNewness({...fresh,raw:{lane:'fast',sorting_date:'Gestern, 11:31'}},'new_listing',null,now).ok,true);
});

test('ImmoScout coverage never qualifies as a new delivery',()=>{
  const fresh={...base,source_id:1,raw:{delivery_lane:'fresh_global'}};
  assert.equal(deliveryNewness(fresh,'new_listing',null,now).ok,true);
  assert.equal(deliveryNewness({...fresh,raw:{delivery_lane:'fresh_borough'}},'new_listing',null,now).ok,true);
  assert.equal(deliveryNewness({...fresh,raw:{delivery_lane:'coverage'}},'new_listing',null,now).ok,false);
  const proven={...fresh,raw:{delivery_lane:'coverage_proven',_newness:{method:'source_timestamp',source_published_at:'2026-09-19T08:30:00Z'}}};
  assert.equal(deliveryNewness(proven,'new_listing',null,now).ok,true);
  assert.equal(deliveryNewness({...proven,raw:{...proven.raw,_newness:{method:'source_timestamp',source_published_at:'2026-09-18T08:30:00Z'}}},'new_listing',null,now).ok,false);
  assert.equal(deliveryNewness({...proven,raw:{...proven.raw,_newness:{method:'poll_delta',previous_success_at:'2026-09-19T08:30:00Z'}}},'new_listing',null,now).ok,false);
});

test('generic sources need baseline, worker newness and a <=24h first observation',()=>{
  assert.equal(deliveryNewness(base,'new_listing',null,now).ok,true);
  assert.equal(deliveryNewness({...base,fresh_delivery_eligible:false},'new_listing',null,now).ok,false);
  assert.equal(deliveryNewness({...base,sources:{baseline_completed_at:null}},'new_listing',null,now).ok,false);
  assert.equal(deliveryNewness({...base,first_seen_at:'2026-09-18T09:29:59Z'},'new_listing',null,now).ok,false);
});

test('source publication evidence is fail-closed when it cannot prove <=24h',()=>{
  assert.equal(publicationFresh('2026-09-19',now).ok,true);
  assert.equal(publicationFresh('2026-09-18',now).ok,false);
  assert.equal(publicationFresh('2026-09-18T10:00:00Z',now).ok,true);
  assert.equal(publicationFresh('2026-09-18T09:29:00Z',now).ok,false);
  assert.equal(deliveryNewness(base,'new_listing','2026-09-18',now).ok,false);
  assert.equal(deliveryNewness(base,'new_listing','not-a-date',now).ok,false);
});

test('saved-listing change events are not reclassified as new listings',()=>{
  const old={...base,first_seen_at:'2026-08-01T00:00:00Z',fresh_delivery_eligible:false};
  assert.equal(deliveryNewness(old,'listing_changed',null,now).ok,true);
});
