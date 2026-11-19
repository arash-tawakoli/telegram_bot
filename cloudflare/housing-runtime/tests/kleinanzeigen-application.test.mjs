import test from "node:test";
import assert from "node:assert/strict";
import { kleinanzeigenListingId, personalizedKleinanzeigenMessage, sendKleinanzeigenApplication } from "../src/kleinanzeigen-application.js";

const listing = {
  canonical_url: "https://www.kleinanzeigen.de/s-anzeige/wohnung-in-hamburg/3575968302",
  external_id: "3575968302",
  profile: {
    first_name: "Mina", last_name: "Beispiel", email: "mina@example.test",
    phone: "+4915112345678", street: "Beispielstrasse", postcode: "20099",
    message: "Guten Tag, ich interessiere mich für Ihre Wohnung.",
  },
};
const central = { credentials: { access_token: "central-private-token" }, accountHint: "operator@example.test" };
const enabled = { CENTRAL_KLEINANZEIGEN_SEND_ENABLED: "1" };
const form = {
  schema: {
    type: "object",
    properties: {
      message: { type: "string" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
    },
    required: ["message", "firstName", "lastName", "email"],
  },
};

async function withFetch(mock, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test("listing identity accepts only the exact Kleinanzeigen target",()=>{
  assert.equal(kleinanzeigenListingId(listing), "3575968302");
  assert.equal(kleinanzeigenListingId({ ...listing, canonical_url: "https://fake.example/s-anzeige/foo/3575968302" }), null);
  assert.equal(kleinanzeigenListingId({ ...listing, external_id:"1234567890" }), null);
});

test("applicant name and contact email are retained even with a central account",()=>{
  const value = personalizedKleinanzeigenMessage(listing.profile, listing.profile.message);
  assert.match(value,/Bewerber\/in: Mina Beispiel/);
  assert.match(value,/mina@example\.test/);
  assert.doesNotMatch(value,/operator@example\.test/);
  assert.equal(personalizedKleinanzeigenMessage({...listing.profile,email:""},listing.profile.message),null);
});

test("transport gate never calls a private provider endpoint when unverified",async()=>{
  await withFetch(()=>{ throw Error("provider must not be called"); },async()=>{
    const result=await sendKleinanzeigenApplication(listing,{},null,central);
    assert.equal(result.status,"manual_required");
    assert.equal(result.error,"provider_contract_unverified");
  });
});

test("dynamic contact form uses the participant's own identity and returns provider conversation reference",async()=>{
  const network=[];
  const result=await withFetch(async(url,request)=>{
    network.push({url:String(url),request});
    if(request.method==="GET")return Response.json(form);
    const payload=JSON.parse(request.body);
    assert.equal(payload.firstName,"Mina");
    assert.equal(payload.lastName,"Beispiel");
    assert.equal(payload.email,"mina@example.test");
    assert.match(payload.message,/Mina Beispiel/);
    assert.match(payload.message,/mina@example\.test/);
    assert.equal(request.headers.authorization,"Bearer central-private-token");
    return Response.json({conversationId:"conv_12345",success:true});
  },()=>sendKleinanzeigenApplication(listing,enabled,null,central));
  assert.equal(network.length,2);
  assert.equal(network[0].request.method,"GET");
  assert.equal(network[1].request.method,"POST");
  assert.equal(result.status,"sent");
  assert.equal(result.conversationId,"conv_12345");
});

test("missing advertiser-required field stops before external POST",async()=>{
  let posts=0;
  const result=await withFetch(async(_url,request)=>{
    if(request.method==="POST"){posts++;throw Error("unexpected");}
    return Response.json({schema:{type:"object",properties:{
      message:{type:"string"},customBesichtigungDate:{type:"string"}
    },required:["message","customBesichtigungDate"]}});
  },()=>sendKleinanzeigenApplication(listing,enabled,null,central));
  assert.equal(posts,0);
  assert.equal(result.status,"manual_required");
  assert.equal(result.error,"required_field_contract_unverified");
});

test("a provider response without a conversation reference is never called delivered",async()=>{
  const result=await withFetch(async(_url,request)=>request.method==="GET"
    ?Response.json(form):Response.json({status:"ok"}),()=>sendKleinanzeigenApplication(listing,enabled,null,central));
  assert.equal(result.status,"manual_required");
  assert.equal(result.error,"submission_unconfirmed");
});

test("test mode requires a one-time authorization before the irreversible POST",async()=>{
  let posts=0;
  const result=await withFetch(async(_url,request)=>{
    if(request.method==="GET")return Response.json(form);
    posts++;return Response.json({conversationId:"c_1234"});
  },()=>sendKleinanzeigenApplication({...listing,test_mode:true,authorizeTestSend:async()=>false},enabled,null,central));
  assert.equal(posts,0);
  assert.equal(result.error,"test_send_not_authorized");
});

test("unknown POST outcome cannot cause an automatic repeat",async()=>{
  let posts=0;
  const result=await withFetch(async(_url,request)=>{
    if(request.method==="GET")return Response.json(form);
    posts++;throw Error("connection lost after submit");
  },()=>sendKleinanzeigenApplication(listing,enabled,null,central));
  assert.equal(posts,1);
  assert.equal(result.status,"manual_required");
  assert.equal(result.error,"submission_unconfirmed");
});
