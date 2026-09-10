import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

test('dispatcher processes a queued event using its lease UUID, not the profile owner', async () => {
  const source = readFileSync(process.env.DISPATCHER_SOURCE || new URL('../supabase/functions/notification-dispatcher/index.ts', import.meta.url), 'utf8');
  const handlerSource = stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve(')));
  const leaseOwner = '00000000-0000-4000-8000-000000000001';
  const profileOwner = { id: 'different-user', is_active: true };
  const event = { id: 'event', search_profiles: { is_active: true, profile_slot: 1, owner: profileOwner }, recipient: { chat_id: 123, is_active: true }, listings: { id: 'listing' } };
  const calls = [], finishes = [];
  const query = { select() { return this; }, in() { return this; }, eq() { return this; }, lt() { return this; }, or() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [event], error: null }); } };
  const db = { from(name) { return name === 'user_subscriptions' ? { select() { return this; }, async in(column, ids) { assert.equal(column, 'user_id'); assert.deepEqual(Array.from(ids), [profileOwner.id]); return { data: [], error: null }; } } : query; }, async rpc(name, args) { calls.push({ name, args }); assert.equal(args.p_owner, leaseOwner); return { data: true, error: null }; } };
  let handler, sends = 0;
  vm.runInNewContext(handlerSource, {
    Deno: { serve(fn) { handler = fn; } }, crypto: { randomUUID: () => leaseOwner }, Response, Date, Map, Set, Number, String, console,
    db, sec: async name => name === 'internal_worker_secret' ? 'test-secret' : 'test-token',
    recoverDeliveries: async () => {}, waitForDispatchSlot: async (_db, owner) => { assert.equal(owner, leaseOwner); return true; },
    claimDelivery: async () => ({ id: 'event', attempt: 1 }), finishDelivery: async (_db, _lease, result) => finishes.push(result),
    premium: owner => { assert.equal(owner, profileOwner); return false; }, enrich: async listing => ({...listing,_availability:"online"}),
    send: async () => { sends++; return { message_id: 987 }; }, TelegramFailure: class extends Error {},
  });
  const response = await handler(new Request('https://test', { method: 'POST', headers: { 'x-internal-secret': 'test-secret' }, body: '{}' }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).totals, { sent: 1, failed: 0, skipped: 0 });
  assert.equal(sends, 1);
  assert.equal(finishes[0].status, 'sent');
  assert.equal(finishes[0].telegram_message_id, 987);
  assert.equal(calls.at(-1).name, 'release_dispatcher');
});

test('idle dispatcher skips token and subscription reads but still recovers leases and releases its lock',async()=>{
 const source=readFileSync(process.env.DISPATCHER_SOURCE || new URL('../supabase/functions/notification-dispatcher/index.ts',import.meta.url),'utf8');
 const calls=[];let handler;
 const query={select(){return this},in(){return this},eq(){return this},lt(){return this},or(){return this},order(){return this},limit:async()=>({data:[],error:null})};
 const db={from(name){calls.push(name);return name==='user_subscriptions'?{select:async()=>({data:[],error:null})}:query},rpc:async name=>{calls.push(name);return {data:true,error:null}}};
 vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve('))),{
 Deno:{serve(fn){handler=fn}},crypto:{randomUUID:()=> 'lease'},Response,Date,Map,Set,Number,String,console,db,
 sec:async name=>{calls.push(name);return 'test'},recoverDeliveries:async()=>{calls.push('recover')}
 });
 const response=await handler(new Request('https://test',{method:'POST',headers:{'x-internal-secret':'test'},body:'{}'}));
 assert.equal(response.status,200);assert.deepEqual((await response.json()).totals,{sent:0,failed:0,skipped:0});
 assert.ok(calls.includes('recover'));assert.equal(calls.at(-1),'release_dispatcher');
 assert.equal(calls.filter(x=>['telegram_bot_token_runtime','user_subscriptions'].includes(x)).length,0,JSON.stringify(calls));
});

test('unknown availability is retried without sending a message', async () => {
  const source = readFileSync(process.env.DISPATCHER_SOURCE || new URL('../supabase/functions/notification-dispatcher/index.ts', import.meta.url), 'utf8');
  const handlerSource = stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve(')));
  const leaseOwner = '00000000-0000-4000-8000-000000000001';
  const profileOwner = { id: 'different-user', is_active: true };
  const event = { id: 'event', search_profiles: { is_active: true, profile_slot: 1, owner: profileOwner }, recipient: { chat_id: 123, is_active: true }, listings: { id: 'listing' } };
  const calls = [], finishes = [];
  const query = { select() { return this; }, in() { return this; }, eq() { return this; }, lt() { return this; }, or() { return this; }, order() { return this; }, limit() { return Promise.resolve({ data: [event], error: null }); } };
  const db = { from(name) { return name === 'user_subscriptions' ? { select() { return this; }, async in(column, ids) { assert.equal(column, 'user_id'); assert.deepEqual(Array.from(ids), [profileOwner.id]); return { data: [], error: null }; } } : query; }, async rpc(name, args) { calls.push({ name, args }); assert.equal(args.p_owner, leaseOwner); return { data: true, error: null }; } };
  let handler, sends = 0;
  vm.runInNewContext(handlerSource, {
    Deno: { serve(fn) { handler = fn; } }, crypto: { randomUUID: () => leaseOwner }, Response, Date, Map, Set, Number, String, console,
    db, sec: async name => name === 'internal_worker_secret' ? 'test-secret' : 'test-token',
    recoverDeliveries: async () => {}, waitForDispatchSlot: async (_db, owner) => { assert.equal(owner, leaseOwner); return true; },
    claimDelivery: async () => ({ id: 'event', attempt: 1 }), finishDelivery: async (_db, _lease, result) => finishes.push(result),
    premium: owner => { assert.equal(owner, profileOwner); return false; }, enrich: async listing => ({...listing,_availability:"unknown"}),
    send: async () => { sends++; return { message_id: 987 }; }, TelegramFailure: class extends Error { retryAfter=300;outcomeUnknown=false; },
  });
  const response = await handler(new Request('https://test', { method: 'POST', headers: { 'x-internal-secret': 'test-secret' }, body: '{}' }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).totals, { sent: 0, failed: 1, skipped: 0 });
  assert.equal(sends, 0);
  assert.equal(finishes[0].status, 'failed');
  assert.match(finishes[0].error_message,/availability/);assert.ok(finishes[0].next_retry_at);
  assert.equal(calls.at(-1).name, 'release_dispatcher');
});
