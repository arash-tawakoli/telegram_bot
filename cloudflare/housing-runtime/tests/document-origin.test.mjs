import test from "node:test";
import assert from "node:assert/strict";
import { handleCoach } from "../src/coach-api.js";
import worker from "../src/index.js";

test("retired document endpoints return 404 without reading or writing stored files",async()=>{
 const cases=[
  ["GET","/documents/package"],
  ["GET","/documents/package-file"],
  ["PUT","/edge/documents/upload"],
  ["GET","/edge/documents/open"]
 ];
 for(const [method,path] of cases){
  const response=await worker.fetch(new Request("https://runtime.example"+path,{method}),{});
  assert.equal(response.status,404,path);
 }
});

test("retired document coach actions cannot create or reveal upload links",async()=>{
 const sql=async parts=>{
  if(parts.join("?").includes("FROM housing.portal_sessions s"))
    return [{id:"member",role:"super_admin",active:true}];
  return [];
 };
 const request=action=>new Request("https://runtime.example/edge/coach",{
  method:"POST",headers:{authorization:"Bearer test","content-type":"application/json"},
  body:JSON.stringify({action,participantId:"6075e235-df06-4923-8000-a653dec275ea"})
 });
 for(const action of ["request_upload","register_upload","open_document","delete_document","toggle_document"]){
  await assert.rejects(()=>handleCoach(sql,request(action)),/invalid_action/);
 }
});
