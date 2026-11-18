import test from "node:test";
import assert from "node:assert/strict";
import { createD1Client } from "../src/d1-database.js";
import { handleCoach } from "../src/coach-api.js";

function fixture(role="coach") {
  const reads=[];
  const db={
    prepare(query) {
      return {
        bind(...values) { return {all:()=>run(query,values)}; },
        all() { return run(query,[]); },
      };
    },
  };
  const run=async (query,values)=>{
    reads.push({query,values});
    if(query.includes("FROM portal_sessions s"))return{results:[{
      id:"coach-id",email:"coach@example.test",display_name:"Coach",role,active:1,
    }]};
    if(query.includes("SELECT COUNT(*) AS total"))return{results:[{total:3}]};
    if(query.includes("SELECT a.id,a.participant_id"))return{results:[{
      id:"app-id",participant_id:"participant-id",provider:"immoscout24",
      status:"sent",first_name:"Ada",last_name:"Test",coach:"Coach",
      facts:JSON.stringify({title:"Wohnung am Park",city:"Hamburg",postal_code:"22041"}),
      canonical_url:"https://www.immobilienscout24.de/expose/12345",
      source_name:"ImmoScout24",event_id:"event-id",event_provider:"immoscout24",
      event_type:"provider_submission",event_status:"sent",document_result:"native_uploaded",
    }]};
    if(query.includes("SELECT a.status, COUNT(*) AS count"))return{results:[
      {status:"sent",count:1},{status:"failed",count:2},
    ]};
    if(query.includes("FROM participants p")&&query.includes("participant_assignments"))return{results:[]};
    return{results:[]};
  };
  const request=(body)=>new Request("https://housing.example/edge/coach",{
    method:"POST",headers:{authorization:"Bearer mock-access", "content-type":"application/json"},
    body:JSON.stringify(body),
  });
  return {sql:createD1Client(db),request,reads};
}

test("legacy coach applications stay scoped even when requesting all",async()=>{
  const {sql,request,reads}=fixture("coach");
  const res=await handleCoach(sql,request({action:"applications",scope:"all",days:30}),{});
  assert.equal(res.total,3);
  assert.equal(res.applications.length,1);
  assert.equal(res.applications[0].listings.title,"Wohnung am Park");
  assert.equal(res.applications[0].listings.city,"Hamburg");
  assert.equal(res.applications[0].latestEvent.document_result,"native_uploaded");
  const count=reads.find(x=>x.query.includes("SELECT COUNT(*) AS total"));
  const list=reads.find(x=>x.query.includes("SELECT a.id,a.participant_id"));
  assert.match(count.query,/AND pa.member_id = \?/);
  assert.match(list.query,/AND pa.member_id = \?/);
  assert.deepEqual(count.values,["-30 days","coach-id"]);
  assert.deepEqual(list.values.slice(-2),[50,0]);
  assert.doesNotMatch(list.query,/DISTINCT ON|::interval|FOR UPDATE/);
});

test("admin applications see all by default but mine only when requested",async()=>{
  for(const [scope,expectedScoped] of [["all",false],["mine",true]]){
    const {sql,request,reads}=fixture("admin");
    await handleCoach(sql,request({action:"applications",scope}),{});
    const count=reads.find(x=>x.query.includes("SELECT COUNT(*) AS total"));
    assert.equal(count.query.includes("AND pa.member_id = ?"),expectedScoped);
  }
});

test("legacy dashboard application metrics are scoped to the authenticated member",async()=>{
 const {sql,request,reads}=fixture("coach");
 const d=await handleCoach(sql,request({action:"dashboard",scope:"all"}),{});
 assert.equal(d.applications,3);
 assert.equal(d.sent,1);
 assert.equal(d.failed,2);
 const query=reads.find(x=>x.query.includes("SELECT a.status, COUNT(*) AS count"));
 assert.deepEqual(query.values,[0,"coach-id"]);
 assert.match(query.query,/participant_assignments pa/);
});
