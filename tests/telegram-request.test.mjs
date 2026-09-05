import test from 'node:test';import assert from 'node:assert/strict';
import {telegramRequest,TelegramFailure} from '../supabase/functions/notification-dispatcher/telegram-request.ts';
import {waitForDispatchSlot} from '../supabase/functions/notification-dispatcher/pacing.ts';
test('ambiguous Telegram response must not trigger image fallback or automatic resend',async()=>{
 await assert.rejects(telegramRequest('https://test',{},async()=>{throw new Error('timeout')}),e=>e instanceof TelegramFailure&&e.outcomeUnknown&&!e.allowImageFallback);
});
test('confirmed image rejection may use image fallback',async()=>{
 await assert.rejects(telegramRequest('https://test',{},async()=>Response.json({ok:false,description:'Bad Request: photo invalid'},{status:400})),e=>e.allowImageFallback&&!e.outcomeUnknown);
});
test('Telegram retry_after is preserved',async()=>{
 await assert.rejects(telegramRequest('https://test',{},async()=>Response.json({ok:false,description:'Too Many Requests',parameters:{retry_after:300}},{status:429})),e=>e.retryAfter===300&&!e.allowImageFallback);
});
test('pacing waits until the persistent slot and refuses slots beyond the run budget',async()=>{
 let now=1000;const db={rpc:async()=>({data:new Date(16000).toISOString(),error:null})};
 assert.equal(await waitForDispatchSlot(db,'owner',20000,()=>now,async ms=>{now+=ms}),true);assert.equal(now,16000);
 assert.equal(await waitForDispatchSlot(db,'owner',15000,()=>now,async()=>{}),false);
});
