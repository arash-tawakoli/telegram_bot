import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const securedSourceEndpoints=[
 'covivio-feed','immobilie1-transport','immobilien-de-transport','meravis-feed',
 'noncoop-feed','noncoop-new-feed','spacest-feed','vonovia-transport'
];
const retiredEndpoints=[
 'auth-admin-repair','deploy-merge-test','html-render-test','immomio-introspection-probe',
 'immomio-probe','immomio-tenant-inspect','ka-gateway-egress-probe',
 'kleinanzeigen-direct-login-probe','kleinanzeigen-mobile-canary','kleinanzeigen-refresh-probe',
 'mini-app','mini-app-publisher','platform-connect','telegram-webhook-region-switch','wunder-probe'
];

test('direct source transport endpoints require JWT at the gateway and retain in-process routing',async()=>{
 const manifest=JSON.parse(await read('supabase/runtime-manifest.json'));
 const code=await read('supabase/functions/source-worker/provider-fetch.ts');
 for(const slug of securedSourceEndpoints){
  const f=manifest.functions.find(x=>x.slug===slug);
  assert.ok(f,'missing manifest entry '+slug);
  assert.equal(f.observed_live_verify_jwt,true,slug+' must require gateway JWT');
  assert.match(code,new RegExp('/functions/v1/'+slug.replaceAll('-','\\-')));
 }
});

test('retired endpoints are classified as retired and use JWT gateway verification',async()=>{
 const manifest=JSON.parse(await read('supabase/runtime-manifest.json'));
 for(const slug of retiredEndpoints){
  const f=manifest.functions.find(x=>x.slug===slug)||manifest.archived_functions.find(x=>x.slug===slug);
  assert.ok(f,'missing manifest entry '+slug);
  assert.equal(f.classification,'retired',slug);
  assert.equal(f.observed_live_verify_jwt??f.verify_jwt,true,slug);
 }
});

test('all live function bundles have an explicit operational classification',async()=>{
 const manifest=JSON.parse(await read('supabase/runtime-manifest.json'));
 const all=[...manifest.functions,...manifest.archived_functions];
 assert.equal(all.length,114);
 for(const f of all)assert.ok(['production','internal','diagnostic','canary','retired','webhook','public_asset','support_review'].includes(f.classification),f.slug+' classification');
});
