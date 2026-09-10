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
  const scope={Deno:{serve(fn){handler=fn}},Response,Request,URL,Number,String,JSON,console,Promise,
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
  const scope={Deno:{serve(fn){handler=fn}},Response,Request,URL,Number,String,JSON,console,Promise,
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

test('telegram-gateway acknowledges callbacks without waiting for the core UI', async () => {
  const source=readFileSync(new URL('../supabase/functions/telegram-gateway/index.ts',import.meta.url),'utf8');
  let handler, resolveCore; const tasks=[];
  const blocked=new Promise(resolve=>{resolveCore=resolve});
  const scope={Deno:{serve(fn){handler=fn}},Response,Request,URL,Number,String,JSON,console,Promise,
    EdgeRuntime:{waitUntil(p){tasks.push(p)}},secret:async()=> 's',cachedWebhookSecret:null,parsed:JSON.parse,
    commandOf:()=>'',FAST_COMMANDS:new Set(),direct:(method,params)=>Response.json({method,...params}),forwardToCore:()=>blocked};
  vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('Deno.serve(')),{mode:'strip'}),scope);
  const response=await Promise.race([handler(request('dossier')),timeout(80)]);
  assert.equal((await response.json()).method,'answerCallbackQuery');
  assert.equal(tasks.length,1);
  resolveCore(new Response('{}'));
  await Promise.all(tasks);
});

test('core callback handler skips duplicate Telegram ACK after upstream pre-ACK', async () => {
  const source=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');
  let acks=0, homes=0; const tasks=[];
  const scope={Number,String,Promise,EdgeRuntime:{waitUntil:p=>tasks.push(p)},acknowledge:async()=>{acks++},home:async()=>{homes++}};
  vm.runInNewContext(source.slice(source.indexOf('export async function handleCallback')).replace('export ',''),scope);
  await scope.handleCallback({id:'q',data:'home',message:{chat:{id:1},message_id:2}},{__callback_acked:true});
  assert.equal(homes,1); assert.equal(acks,0); assert.equal(tasks.length,1); await Promise.all(tasks);
});
