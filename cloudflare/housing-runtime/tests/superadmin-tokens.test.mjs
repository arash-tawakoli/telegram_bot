import test from "node:test";
import assert from "node:assert/strict";
import { handleCoach } from "../src/coach-api.js";

const OWNER_ID="a7777777-4444-4444-8444-111111111111";
const origin="https://login.traumwohnunghamburg.de/connect?ticket=";

function setup(role="super_admin"){
 const queries=[],flowInsertions=[];
 const sql=async(parts,...values)=>{
  const query=parts.join("?");
  queries.push(query);
  if(query.includes("FROM housing.portal_sessions s"))return [{id:"member",role,active:true,display_name:"Test"}];
  if(query.includes("FROM housing.participants WHERE telegram_user_id"))return [{id:OWNER_ID}];
  if(query.includes("SELECT id,status FROM participants WHERE id="))return [{id:OWNER_ID,status:"active"}];
  if(query.includes("FROM housing.provider_connections"))return [
   {provider:"immowelt",status:"connected",account_hint:"account@example.test",expires_at:null},
   {provider:"immomio",status:"needs_login",account_hint:null,expires_at:null}
  ];
  return [];
 };
 const env={
  HOUSING_DB:{prepare(query){
   const methods=values=>({
    first:async()=>query.includes("FROM central_credentials")?{
     account_hint:"account@example.test",status:"connected",enabled:0,expires_at:"2026-12-31T00:00:00Z",last_verified_at:null
    }:null,
    run:async()=>{if(query.includes("INSERT INTO central_oauth_flows"))flowInsertions.push(values);return {meta:{changes:1}}}
   });
   return {...methods([]),bind:(...values)=>methods(values)};
  }},
  CENTRAL_API_SECRET:"test-internal-secret",
  CENTRAL_TOKEN_ENCRYPTION_KEY:"1".repeat(64)
 };
 const request=(action,body={})=>new Request("https://housing.test/edge/coach",{
  method:"POST",headers:{authorization:"Bearer test","content-type":"application/json"},
  body:JSON.stringify({action,...body})
 });
 return {sql,env,request,queries,flowInsertions};
}

test("manager and Admin cannot see or initiate any Super Admin token action",async()=>{
 for(const role of ["coach","admin"]){
  const x=setup(role);
  for(const action of ["admin_token_status","admin_token_start","admin_token_refresh"]){
   await assert.rejects(handleCoach(x.sql,x.request(action,{provider:"immowelt"}),x.env),/super_admin_required/);
  }
  assert.equal(x.flowInsertions.length,0);
  assert.equal(x.queries.some(q=>q.includes("provider_auth_flows")),false);
 }
});

test("Super Admin preview cannot issue or read token actions",async()=>{
 const x=setup();
 await assert.rejects(
  handleCoach(x.sql,x.request("admin_token_start",{provider:"immoscout24",previewMemberId:"coach"}),x.env),
  /preview_read_only/
 );
 assert.equal(x.flowInsertions.length,0);
});

test("Super Admin sees only existing credential metadata, never token secrets",async()=>{
 const x=setup();
 const rows=await handleCoach(x.sql,x.request("admin_token_status"),x.env);
 assert.equal(rows.immoscout24.status,"connected");
 assert.equal(rows.immoscout24.scope,"central");
 assert.equal(rows.immowelt.scope,"central");
 assert.equal(rows.immowelt.status,"connected");
 assert.equal(rows.immomio.status,"needs_login");
 assert.equal(rows.immomio.scope,"central");
 assert.doesNotMatch(JSON.stringify(rows),/access_token|refresh_token|ciphertext|test-internal-secret/);
});

test("login buttons reuse existing one-time central and provider connection flows",async()=>{
 const x=setup();
 for(const provider of ["immoscout24","immowelt","immomio"]){
  const response=await handleCoach(x.sql,x.request("admin_token_start",{provider}),x.env);
  assert.equal(response.provider,provider);
  assert.ok(response.url.startsWith(origin),provider);
  assert.ok(Date.parse(response.expiresAt)>Date.now(),provider);
  assert.equal(response.scope,"central");
 }
 assert.equal(x.flowInsertions.length,1,"Only ImmoScout uses the existing central OAuth flow");
 assert.equal(x.queries.filter(q=>q.includes("INSERT INTO provider_auth_flows")).length,2);
 await assert.rejects(handleCoach(x.sql,x.request("admin_token_start",{provider:"kleinanzeigen"}),x.env),/provider_not_allowlisted/);
});
