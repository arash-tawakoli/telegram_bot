import test from "node:test";
import assert from "node:assert/strict";
import {handleStripeWebhook,verifyStripeSignature} from "../src/stripe-webhook.js";
const key="whsec_test_stripe_signature";
const participantId="6075e235-df06-4923-8000-a653dec275ea";
const checkout=(id="evt_testcheckout01")=>({id,type:"checkout.session.completed",created:1770000000,data:{object:{
  payment_link:"plink_1UAy8Z2NorDNIWqI9h5j73q0",metadata:{plan:"premium_monthly"},
  client_reference_id:participantId,payment_status:"paid",customer:"cus_123",subscription:"sub_123"
}}});
async function signedEvent(event,secret=key,timestamp=Math.floor(Date.now()/1000)){
 const body=JSON.stringify(event);
 const imported=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const digest=new Uint8Array(await crypto.subtle.sign("HMAC",imported,new TextEncoder().encode(timestamp+"."+body)));
 const hex=Array.from(digest,x=>x.toString(16).padStart(2,"0")).join("");
 return new Request("https://worker.example/edge/stripe/webhook",{
  method:"POST",headers:{"stripe-signature":"t="+timestamp+",v1="+hex,"content-type":"application/json"},body
 });
}
class FakeD1 {
 constructor(){this.events=new Map();this.subscriptions=new Map();this.participant=true;this.override="free";this.queries=[];}
 prepare(sql){const db=this;return {bind(...p){return {
  async first(){
   db.queries.push({sql,p,op:"first"});
   if(sql.includes("FROM stripe_webhook_events"))return db.events.get(p[0])||null;
   if(sql.includes("FROM participants"))return db.participant?{id:participantId}:null;
   if(sql.includes("FROM user_subscriptions"))return [...db.subscriptions.values()].some(s=>
    (sql.includes("stripe_subscription_id")&&s.subscription===p[0])||
    (sql.includes("stripe_customer_id")&&s.customer===p[0]))?{participant_id:participantId}:null;
   return null;
  },
  async run(){
   db.queries.push({sql,p,op:"run"});
   if(sql.startsWith("INSERT INTO stripe_webhook_events")){
    if(db.events.has(p[0]))return {meta:{changes:0}};
    db.events.set(p[0],{event_id:p[0],event_type:p[1],event_created:p[2],status:"processing",attempts:1});
    return {meta:{changes:1}};
   }
   if(sql.includes("SET status='processing'")){
    const e=db.events.get(p[0]);if(e?.status!=="failed")return {meta:{changes:0}};
    e.status="processing";e.attempts++;return {meta:{changes:1}};
   }
   if(sql.includes("SET status='failed'")){
    const e=db.events.get(p[0]);if(e?.status!=="processing")return {meta:{changes:0}};
    e.status="failed";return {meta:{changes:1}};
   }
   if(sql.includes("SET status='processed'")){
    const e=db.events.get(p[0]);if(e?.status!=="processing")return {meta:{changes:0}};
    e.status="processed";return {meta:{changes:1}};
   }
   if(sql.startsWith("INSERT INTO user_subscriptions")){
    const [id,user,customer,subscription,status,periodEnd,cancel,eventCreated]=p;
    const prior=db.subscriptions.get(user);
    if(!prior||prior.created<=eventCreated){
     db.subscriptions.set(user,{id,participant_id:user,customer:customer||prior?.customer,
      subscription:subscription||prior?.subscription,status,periodEnd:periodEnd||prior?.periodEnd,
      cancel,created:eventCreated});return {meta:{changes:1}};
    }
    return {meta:{changes:0}};
   }
   if(sql.startsWith("UPDATE participants SET plan_override=NULL")){db.override=null;return {meta:{changes:1}};}
   return {meta:{changes:0}};
  }
 };}}}
 async batch(statements){const result=[];for(const x of statements)result.push(await x.run());return result}
}
test("Stripe signature accepts genuine payload and rejects spoofed signatures",async()=>{
 const req=await signedEvent(checkout()),body=await req.clone().text(),signature=req.headers.get("stripe-signature");
 assert.equal(await verifyStripeSignature(body,signature,key),true);
 assert.equal(await verifyStripeSignature(body,signature,"incorrect"),false);
 assert.equal(await verifyStripeSignature(body,signature,key,Date.now()/1000+700),false);
});
test("Native Stripe webhook rejects unsigned requests without querying D1",async()=>{
 const db=new FakeD1();
 const req=new Request("https://worker.example/edge/stripe/webhook",{method:"POST",body:JSON.stringify(checkout())});
 const result=await handleStripeWebhook(req,{HOUSING_DB:db,STRIPE_WEBHOOK_SIGNING_SECRET:key});
 assert.equal(result.status,400);assert.equal(db.queries.length,0);
});
test("Missing signing key fails closed",async()=>{
 const db=new FakeD1(),r=await handleStripeWebhook(await signedEvent(checkout()),{HOUSING_DB:db});
 assert.equal(r.status,503);assert.equal(db.queries.length,0);
});
test("Paid checkout grants Premium and duplicate event is idempotent",async()=>{
 const db=new FakeD1(),env={HOUSING_DB:db,STRIPE_WEBHOOK_SIGNING_SECRET:key};
 const first=await handleStripeWebhook(await signedEvent(checkout()),env);
 assert.equal(first.status,200);assert.equal(db.subscriptions.get(participantId).status,"active");
 assert.equal(db.override,null);
 const replay=await handleStripeWebhook(await signedEvent(checkout()),env);
 assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
 assert.equal(db.events.get("evt_testcheckout01").status,"processed");
});
test("Unpaid checkout never grants Premium",async()=>{
 const db=new FakeD1(),event=checkout("evt_unpaid123");event.data.object.payment_status="unpaid";
 const r=await handleStripeWebhook(await signedEvent(event),{HOUSING_DB:db,STRIPE_WEBHOOK_SIGNING_SECRET:key});
 assert.equal(r.status,200);assert.equal(db.subscriptions.size,0);assert.equal(db.override,"free");
});
test("Subscription updates retain period-end and cancellation",async()=>{
 const db=new FakeD1(),env={HOUSING_DB:db,STRIPE_WEBHOOK_SIGNING_SECRET:key};
 await handleStripeWebhook(await signedEvent(checkout()),env);
 const event={id:"evt_subscription01",type:"customer.subscription.updated",created:1770000010,
  data:{object:{id:"sub_123",customer:"cus_123",status:"active",cancel_at_period_end:true,current_period_end:1780000000}}};
 const r=await handleStripeWebhook(await signedEvent(event),env);
 assert.equal(r.status,200);assert.equal(db.subscriptions.get(participantId).cancel,1);
 assert.equal(db.subscriptions.get(participantId).periodEnd,new Date(1780000000*1000).toISOString());
});
test("Out-of-order unlinked subscription returns retryable error",async()=>{
 const db=new FakeD1(),event={id:"evt_unlinked",type:"customer.subscription.created",created:1770000000,
  data:{object:{id:"sub_missing",customer:"cus_unknown",status:"active"}}};
 const r=await handleStripeWebhook(await signedEvent(event),{HOUSING_DB:db,STRIPE_WEBHOOK_SIGNING_SECRET:key});
 assert.equal(r.status,503);assert.equal(db.subscriptions.size,0);assert.equal(db.events.get(event.id).status,"failed");
});
