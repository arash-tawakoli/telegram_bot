import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as rules from '../supabase/functions/telegram-ui/dossier-rules.js';
const {profileValue,detectDocument,boundedFile,FILE_LIMIT}=rules;
test('profile input is bounded and preserves unknown versus explicit zero',()=>{
 assert.equal(profileValue('income','0'),0);assert.equal(profileValue('household_size','-'),null);
 assert.equal(profileValue('email',' test@example.org '),'test@example.org');
 for(const [f,v] of [['household_size','1.5'],['income','Infinity'],['email','invalid'],['full_name','x'.repeat(121)],['custom_application_text','x'.repeat(1501)],['admin','true']])assert.throws(()=>profileValue(f,v));
});
test('upload signatures reject mismatched executable content and enforce actual streamed size',async()=>{
 assert.equal(detectDocument(new TextEncoder().encode('%PDF-1.7')),'application/pdf');
 assert.equal(detectDocument(new Uint8Array([255,216,255,1])),'image/jpeg');
 assert.equal(detectDocument(new Uint8Array([137,80,78,71,13,10,26,10])),'image/png');
 assert.throws(()=>detectDocument(new TextEncoder().encode('<html>not PDF</html>')));
 await assert.rejects(boundedFile(new Response(new Uint8Array(FILE_LIMIT+1))),/größer/);
 assert.equal((await boundedFile(new Response('abc'))).length,3);
});
const code=readFileSync(new URL('../supabase/functions/telegram-ui/dossier.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
const user={id:'owner',is_active:true,is_premium:true,telegram_user_id:1,chat_id:1};
function harness({premium=true,rows=[],profile={}}={}){
 const calls=[],writes=[],states=[];
 const db={from(table){const filters={};let update;
  const q={select(){return q},eq(k,v){filters[k]=v;return q},update(p){update=p;return q},delete(){update={deleted:true};return q},
   async single(){assert.equal(filters.id,'owner');return {data:{applicant_profile:profile},error:null}},
   async maybeSingle(){assert.equal(filters.user_id,'owner');return {data:rows.find(r=>r.id===filters.id&&r.user_id===filters.user_id)||null,error:null}},
   async order(){assert.equal(filters.user_id,'owner');return {data:rows,error:null}},
   then(resolve){assert.ok(filters.id||filters.user_id);writes.push({table,filters,update});return Promise.resolve({error:null}).then(resolve)}
  };return q;},storage:{from(name){assert.equal(name,'application-documents');return {remove:async paths=>{calls.push({remove:paths});return {error:null}}}}}};
 const scope={...rules,db,send:async(c,t,m)=>calls.push({c,t,m}),edit:async(c,i,t,m)=>calls.push({c,i,t,m}),esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),button:(text,callback_data)=>({text,callback_data}),premium:async()=>calls.push({premium:true}),saveState:async(...a)=>states.push(a),Date,FormData,AbortSignal};
 vm.runInNewContext(code,scope);return {...scope,calls,writes,states,user:{...user,is_premium:premium}};
}
test('dossier refuses foreign chats and groups; free users retain private overview',async()=>{
 const h=harness();await h.dossier(user,{id:2,type:'private'});await h.dossier(user,{id:1,type:'group'});assert.equal(h.calls.length,0);
 const free=harness({premium:false});await free.dossier(free.user,{id:1,type:'private'});assert.match(free.calls[0].t,/Premium erforderlich/);assert.match(free.calls[0].t,/noch nicht verfügbar/);
});
test('presence statements do not mark documents uploaded or permit sharing',async()=>{
 const h=harness();await h.dossier(user,{id:1,type:'private'},undefined,'dossier:has:wbs:yes');
 assert.equal(h.writes[0].table,'bot_users');assert.equal(h.writes[0].update.applicant_profile.documents.wbs,'yes');assert.equal(h.writes.length,1);
 const free=harness({premium:false});await free.dossier(free.user,{id:1,type:'private'},undefined,'dossier:has:wbs:yes');assert.equal(free.writes.length,0);assert.ok(free.calls[0].premium);
});
test('expired Premium can revoke sharing and delete only an owned document',async()=>{
 const id='00000000-0000-4000-8000-000000000001';const rows=[{id,user_id:'owner',kind:'wbs',filename:'WBS.pdf',ready:true,share_enabled:true}];
 const h=harness({premium:false,rows});await h.dossier(h.user,{id:1,type:'private'},undefined,`dossier:share:${id}:no`);assert.equal(h.writes[0].update.share_enabled,false);
 await h.dossier(h.user,{id:1,type:'private'},undefined,`dossier:remove:${id}`);assert.deepEqual([...h.calls.find(c=>c.remove).remove],[`owner/${id}`]);assert.equal(h.writes.at(-1).filters.user_id,'owner');
 const other=harness({rows:[{...rows[0],user_id:'other'}]});await other.dossier(user,{id:1,type:'private'},undefined,`dossier:remove:${id}`);assert.equal(other.writes.length,0);
});
test('text entry preserves unrelated onboarding state and expires without saving',async()=>{
 const h=harness();const u={...user,onboarding_step:'rooms',onboarding_state:{min_rooms:2,dossier_input:{action:'field',value:'full_name',started_at:Date.now()}}};
 await h.dossierMessage({chat:{id:1,type:'private'},text:'Anna'},u);assert.equal(h.writes[0].update.applicant_profile.full_name,'Anna');assert.equal(h.states[0][1],'rooms');assert.equal(h.states[0][2].min_rooms,2);assert.equal(h.states[0][2].dossier_input,undefined);
 const expired=harness();await expired.dossierMessage({chat:{id:1,type:'private'},text:'Anna'},{...u,onboarding_state:{dossier_input:{started_at:0}}});assert.equal(expired.writes.length,0);
});

test('upload reserves an owned private object before storage and never grants sharing implicitly',async()=>{
 const h=harness();const sequence=[];let row;
 h.db.from=table=>{
  if(table==='bot_users')return {select(){return this},eq(){return this},single:async()=>({data:{applicant_profile:{}},error:null})};
  const filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},
   async upsert(value,options){sequence.push('reserve');assert.equal(value.user_id,'owner');assert.equal(options.ignoreDuplicates,true);row={...value,id:'object',ready:false,share_enabled:false};return {error:null}},
   async single(){assert.equal(filters.user_id,'owner');assert.equal(filters.telegram_message_id,88);return {data:row,error:null}},
   update(value){sequence.push('ready');assert.equal(value.ready,true);row.ready=true;return q},
   async order(){return {data:[row],error:null}},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q;
 };
 h.db.storage.from=()=>({upload:async(path,bytes,options)=>{sequence.push('upload');assert.equal(path,'owner/object');assert.equal(options.contentType,'application/pdf');assert.equal(row.ready,false);return {error:null}}});
 const scope={...h,telegram:async()=>({file_path:'documents/file.pdf'}),secret:async()=>'TEST_ONLY',fetch:async()=>new Response('%PDF-1.7'),Response};
 vm.runInNewContext(code,scope);
 const u={...user,onboarding_state:{dossier_input:{action:'upload',value:'wbs',started_at:Date.now()}}};
 await scope.dossierMessage({message_id:88,chat:{id:1,type:'private'},document:{file_id:'file',file_size:8}},u);
 assert.deepEqual(sequence,['reserve','upload','ready']);assert.equal(row.share_enabled,false);assert.equal(row.filename,'WBS.pdf');
});
