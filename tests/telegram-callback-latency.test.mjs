import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const timeout = ms => new Promise((_, reject) => setTimeout(() => reject(new Error('callback ack waited for background work')), ms));

function request(data='home') {
  return new Request('https://test', {
    method:'POST', headers:{'x-telegram-bot-api-secret-token':'s'},
    body:JSON.stringify({update_id:7,callback_query:{id:'q7',from:{id:3},message:{chat:{id:3},message_id:9},data}}),
  });
}

test('telegram-fast acknowledges exact callbacks before its database RPC finishes', async () => {
  const source=readFileSync(new URL('../supabase/functions/telegram-fast/index.ts',import.meta.url),'utf8');
  let handler, resolveRpc; const tasks=[];
  const blocked=new Promise(resolve=>{resolveRpc=resolve});
  const scope={Deno:{serve(fn){handler=fn},env:{get(){return 'eu-west-1'}}},Response,Request,URL,Number,String,JSON,console,Promise,
    EdgeRuntime:{waitUntil(p){tasks.push(p)}},parse:JSON.parse,commandOf:()=>'',argumentOf:()=>'',
    COMMAND_ACTIONS:{},CALLBACK_ACTIONS:{home:'home'},ADMINS:[],
    rpc:()=>blocked,direct:(method,params)=>Response.json({method,...params}),forwardCore:async()=>new Response('{}'),
    finish:async()=>true,performCallback:async()=>{}};
  vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve(')),{mode:'strip'}),scope);
  const response=await Promise.race([handler(request()),timeout(80)]);
  assert.equal((await response.json()).method,'answerCallbackQuery');
  assert.equal(tasks.length,1);
  resolveRpc({authorized:true,claim:0});
  await Promise.all(tasks);
});

test('telegram-fast acknowledges fallback callbacks before the core function finishes', async () => {
  const source=readFileSync(new URL('../supabase/functions/telegram-fast/index.ts',import.meta.url),'utf8');
  let handler, resolveCore; const tasks=[];
  const blocked=new Promise(resolve=>{resolveCore=resolve});
  const scope={Deno:{serve(fn){handler=fn},env:{get(){return 'eu-west-1'}}},Response,Request,URL,Number,String,JSON,console,Promise,
    EdgeRuntime:{waitUntil(p){tasks.push(p)}},parse:JSON.parse,commandOf:()=>'',argumentOf:()=>'',
    COMMAND_ACTIONS:{},CALLBACK_ACTIONS:{},ADMINS:[],rpc:async()=>{throw Error('RPC must not gate fallback ACK')},
    direct:(method,params)=>Response.json({method,...params}),forwardCore:()=>blocked,finish:async()=>true,performCallback:async()=>{}};
  vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve(')),{mode:'strip'}),scope);
  const response=await Promise.race([handler(request('profile:view:1')),timeout(80)]);
  assert.equal((await response.json()).method,'answerCallbackQuery');
  assert.equal(tasks.length,1);
  resolveCore(new Response('{}'));
  await Promise.all(tasks);
});

test('telegram-gateway acknowledges fallback callbacks without waiting for the core UI', async () => {
  const source=readFileSync(new URL('../supabase/functions/telegram-gateway/index.ts',import.meta.url),'utf8');
  let handler, resolveCore; const tasks=[];
  const blocked=new Promise(resolve=>{resolveCore=resolve});
  const scope={Deno:{serve(fn){handler=fn},env:{get(){return 'eu-west-1'}}},Response,Request,URL,Number,String,JSON,console,Promise,Date,
    EdgeRuntime:{waitUntil(p){tasks.push(p)}},secret:async()=> 's',secretCache:new Map(),parsed:JSON.parse,
    direct:(method,params)=>Response.json({method,...params}),forwardToCore:()=>blocked,
    isAutoApplyCallback:()=>false,isAutoApplyMessage:()=>false,isStaticFastAction:()=>false,likelyFastAction:()=>false};
  vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve(')),{mode:'strip'}),scope);
  const response=await Promise.race([handler(request('legacy-action')),timeout(80)]);
  assert.equal((await response.json()).method,'answerCallbackQuery');
  assert.equal(tasks.length,1);
  resolveCore(new Response('{}'));
  await Promise.all(tasks);
});

test('telegram-gateway common callback returns direct UI edit without core hop or ACK wait', async () => {
  const source=readFileSync(new URL('../supabase/functions/telegram-gateway/index.ts',import.meta.url),'utf8');
  let handler, resolveAck; const tasks=[]; let coreCalls=0, metricCalls=0;
  const ackBlocked=new Promise(resolve=>{resolveAck=resolve});
  const scope={Deno:{serve(fn){handler=fn},env:{get(){return 'eu-west-1'}}},Response,Request,URL,Number,String,JSON,console,Promise,Date,
    EdgeRuntime:{waitUntil(p){tasks.push(p)}},secret:async()=> 's',secretCache:new Map(),parsed:JSON.parse,
    direct:(method,params)=>Response.json({method,...params}),
    forwardToCore:async()=>{coreCalls++;return new Response('{}')},
    isAutoApplyCallback:()=>false,isAutoApplyMessage:()=>false,isStaticFastAction:()=>false,likelyFastAction:()=>true,
    acknowledge:()=>ackBlocked,fastAction:async()=>({fast:true,claim:1,critical:false,view:'home'}),
    renderFast:()=>({method:'editMessageText',chat_id:3,message_id:9,text:'home',reply_markup:{inline_keyboard:[]}}),
    recordMetric:async()=>{metricCalls++},recordStaticNav:async()=>{}};
  vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve(')),{mode:'strip'}),scope);
  const response=await Promise.race([handler(request('home')),timeout(80)]);
  const body=await response.json();
  assert.equal(body.method,'editMessageText');
  assert.equal(coreCalls,0);
  assert.equal(tasks.length,1);
  resolveAck(5);
  await Promise.all(tasks);
  assert.equal(metricCalls,1);
});

test('core callback handler skips duplicate Telegram ACK after upstream pre-ACK', async () => {
  const source=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');
  let acks=0, homes=0; const tasks=[];
  const scope={Number,String,Promise,EdgeRuntime:{waitUntil:p=>tasks.push(p)},acknowledge:async()=>{acks++},home:async()=>{homes++}};
  vm.runInNewContext(source.slice(source.indexOf('export async function handleCallback')).replace('export ',''),scope);
  await scope.handleCallback({id:'q',data:'home',message:{chat:{id:1},message_id:2}},{__callback_acked:true});
  assert.equal(homes,1); assert.equal(acks,0); assert.equal(tasks.length,1); await Promise.all(tasks);
});

test('telegram-gateway static German navigation returns UI before DB telemetry finishes', async () => {
  const source=readFileSync(new URL('../supabase/functions/telegram-gateway/index.ts',import.meta.url),'utf8');
  let handler, resolveMetric; const tasks=[]; let fastCalls=0;
  const blockedMetric=new Promise(resolve=>{resolveMetric=resolve});
  const scope={Deno:{serve(fn){handler=fn},env:{get(){return 'eu-west-1'}}},Response,Request,URL,Number,String,JSON,console,Promise,Date,
    EdgeRuntime:{waitUntil(p){tasks.push(p)}},secret:async()=> 's',secretCache:new Map(),parsed:JSON.parse,
    direct:(method,params)=>Response.json({method,...params}),forwardToCore:async()=>new Response('{}'),
    isAutoApplyCallback:()=>false,isAutoApplyMessage:()=>false,isStaticFastAction:a=>a==='home:de',likelyFastAction:()=>false,
    acknowledge:async()=>5,fastAction:async()=>{fastCalls++;return{}},
    renderStaticFast:()=>({method:'editMessageText',chat_id:3,message_id:9,text:'home',reply_markup:{inline_keyboard:[]}}),
    recordStaticNav:()=>blockedMetric};
  vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve(')),{mode:'strip'}),scope);
  const response=await Promise.race([handler(request('home:de')),timeout(80)]);
  const body=await response.json();
  assert.equal(body.method,'editMessageText');
  assert.equal(fastCalls,0);
  assert.equal(tasks.length,1);
  resolveMetric(true);
  await Promise.all(tasks);
});
