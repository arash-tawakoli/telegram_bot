import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchProvider} from '../supabase/functions/source-worker/provider-fetch.ts';

test('retained provider fetch delegates directly to native fetch',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(...args)=>{calls.push(args);return new Response('ok')};
 try{
  const init={method:'GET',headers:{accept:'test'}};
  const response=await fetchProvider('https://www.immowelt.de/search',init,'https://project.supabase.co');
  assert.equal(await response.text(),'ok');
  assert.equal(calls.length,1);
  assert.equal(calls[0][1],init);
 }finally{globalThis.fetch=original}
});
