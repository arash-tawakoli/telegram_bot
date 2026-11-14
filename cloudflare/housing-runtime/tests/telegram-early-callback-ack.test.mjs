import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("Cloudflare acknowledges Telegram navigation before an outstanding D1 claim resolves",async()=>{
 const originalFetch=globalThis.fetch;
 let releaseClaim,acknowledged,claimReached=false;
 const heldClaim=new Promise(resolve=>{releaseClaim=resolve;});
 const ackSeen=new Promise(resolve=>{acknowledged=resolve;});
 const tasks=[];
 try{
  globalThis.fetch=async(url,options={})=>{
   assert.equal(String(url),"https://api.telegram.org/botfake/answerCallbackQuery");
   assert.deepEqual(JSON.parse(options.body),{callback_query_id:"callback-88"});
   acknowledged();
   return Response.json({ok:true,result:true});
  };
  const env={
   TELEGRAM_BOT_TOKEN:"fake",TELEGRAM_WEBHOOK_SECRET:"test-secret",
   HOUSING_DB:{prepare(query){
    assert.match(query,/INSERT INTO telegram_updates/);
    return {bind(){return {async all(){claimReached=true;return heldClaim;}}}};
   }}
  };
  const request=new Request("https://intern.traumwohnunghamburg.de/edge/telegram/webhook",{
   method:"POST",
   headers:{"x-telegram-bot-api-secret-token":"test-secret","content-type":"application/json"},
   body:JSON.stringify({update_id:88,callback_query:{
    id:"callback-88",data:"platforms",from:{id:777},
    message:{message_id:12,chat:{id:777,type:"private"}}
   }}),
  });
  const ctx={waitUntil(promise){tasks.push(promise);}};
  const responsePromise=worker.fetch(request,env,ctx);
  await Promise.race([ackSeen,new Promise((_,reject)=>setTimeout(()=>reject(new Error("ack blocked by D1")),500))]);
  assert.equal(tasks.length,1);
  assert.equal(claimReached,false,"ack starts even before the first D1 claim completes");
  // The claim is a duplicate, so no user data or outbound messages are touched.
  await new Promise(resolve=>setTimeout(resolve,5));
  releaseClaim({results:[],meta:{changes:0}});
  const response=await responsePromise;
  assert.equal(response.status,200);
  assert.equal((await response.json()).duplicate,true);
  await Promise.all(tasks);
 }finally{
  releaseClaim?.({results:[],meta:{changes:0}});
  globalThis.fetch=originalFetch;
 }
});
