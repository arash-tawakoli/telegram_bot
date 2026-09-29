import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const root=new URL('../supabase/functions/telegram-ui/',import.meta.url);
const source=readFileSync(new URL('index.ts',root),'utf8');
async function invoke({claim=1,secretValue='s',fail=false}={}) {
 const calls=[];let handler;
 const scope={Deno:{serve(fn){handler=fn}},Response,URL,Number,String,console,setTimeout,secret:async()=> 's',secretCache:new Map(),chatLanguages:new Map(),isAdmin:()=>false,
 db:{rpc:async(name)=>{calls.push(name);return {data:{claim,user:{id:'u',is_active:true,ui_language:'de'},subscription:null},error:null}}},
 withPlan:async(user,subscription)=>{assert.equal(subscription,null);return user},
 handleCallback:async()=>{calls.push('handle');if(fail)throw Error('render failed')},finishUpdate:async(id,attempt,ok)=>calls.push(['finish',id,attempt,ok])};
 vm.runInNewContext(source.slice(source.indexOf('Deno.serve(')),scope);
 const response=await handler(new Request('https://test',{method:'POST',headers:{'x-telegram-bot-api-secret-token':secretValue},body:JSON.stringify({update_id:5,callback_query:{id:'q',from:{id:3},message:{chat:{id:3},message_id:9},data:'type:flat'}})}));
 return {response,calls};
}
test('detail buttons prepare ownership, user and subscription in one RPC',async()=>{
 const {response,calls}=await invoke();assert.equal(response.status,200);assert.deepEqual(calls,['prepare_telegram_update','handle',['finish',5,1,true]]);
});
test('button shortcut preserves auth, duplicate/busy guards and failed processing',async()=>{
 assert.equal((await invoke({secretValue:'wrong'})).response.status,401);
 assert.deepEqual((await invoke({claim:0})).calls,['prepare_telegram_update']);
 assert.equal((await invoke({claim:-1})).response.status,503);
 const {response,calls}=await invoke({fail:true});assert.equal(response.status,500);assert.deepEqual(calls.at(-1),['finish',5,1,false]);
});
test('supplied subscription avoids lookup while preserving free override and subscription expiry',async()=>{
 const runtime=readFileSync(new URL('runtime.js',root),'utf8');let reads=0;
 const scope={Date,Boolean,String,db:{from(){reads++;return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null})}}}};
 vm.runInNewContext(runtime.slice(runtime.indexOf('export async function withPlan('),runtime.indexOf('export async function saveState(')).replace('export ',''),scope);
 assert.equal((await scope.withPlan({}, {status:'active',current_period_end:'2099-01-01'})).is_premium,true);
 assert.equal((await scope.withPlan({plan_override:'free'},{status:'active'})).is_premium,false);
 assert.equal((await scope.withPlan({},{status:'active',current_period_end:'2000-01-01'})).is_premium,false);
 assert.equal((await scope.withPlan({},null)).is_premium,false);assert.equal(reads,0);
 await scope.withPlan({});assert.equal(reads,1);
});
test('navigation updates do not wait for empty Telegram acknowledgement; save result remains awaited',async()=>{
 const s=readFileSync(new URL('handlers.js',root),'utf8');let pendingResolve;const pending=new Promise(r=>pendingResolve=r);const tasks=[];let edited=false;
 const scope={Number,String,EdgeRuntime:{waitUntil:p=>tasks.push(p)},acknowledge:()=>pending,home:async()=>{edited=true}};
 vm.runInNewContext(s.slice(s.indexOf('export async function handleCallback')).replace('export ',''),scope);
 await scope.handleCallback({id:'q',data:'home',message:{chat:{id:1},message_id:2}},{});
 assert.equal(edited,true);assert.equal(tasks.length,1);pendingResolve();await Promise.all(tasks);
});


test('platform login opens provider auth inside Telegram WebApp instead of a direct URL button',()=>{
 const platforms=readFileSync(new URL('platform-sessions.js',root),'utf8');
 assert.match(platforms,/\{text:loginLabel,web_app:\{url:result\.url\}\}/);
 assert.doesNotMatch(platforms,/\{text:loginLabel,url:result\.url\}/);
});


test('command menu parity keeps German users on the canonical command list',()=>{
 const handlers=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');
 assert.match(handlers,/language_code:\s*"de"/);
 assert.match(handlers,/command === "\/start" \|\| command === "\/commands"/);
 assert.match(handlers,/command:\s*"suche"/);
 assert.match(handlers,/command:\s*"premium"/);
});
