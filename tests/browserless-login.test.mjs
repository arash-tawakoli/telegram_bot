import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/application-worker/index.ts',import.meta.url),'utf8');

test('Kleinanzeigen login uses Browserless live URL with mobile input support',()=>{
 assert.match(source,/browserless_api_key/);
 assert.match(source,/production-ams\.browserless\.io/);
 assert.match(source,/Browserless\.liveURL/);
 assert.match(source,/interactable:true/);
 assert.match(source,/resizable:true/);
 assert.match(source,/emulateComponents:true/);
 assert.match(source,/automaticCallback:true,transport:'browserless'/);
 assert.doesNotMatch(source,/api\.browserbase\.com|browserbase_api_key|browserbase_project_id/);
});

test('Browserless API token is never returned in the user-facing live URL',()=>{
 assert.match(source,/safeLiveUrl\(live\.liveURL\)/);
 assert.match(source,/url\.hostname\.endsWith\('\.browserless\.io'\)/);
 assert.doesNotMatch(source,/liveURL.*browserless_api_key/);
});
