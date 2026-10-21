import test from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8'),db=new PGlite(),id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const one=async(sql,args=[]) =>(await db.query(sql,args)).rows[0];
await db.exec(await read('tests/fixtures/coach-management.sql'));
const foundation=await read('supabase/migrations/20260922013434_coach_portal_platform_foundation.sql');await db.exec(foundation.slice(foundation.indexOf('create or replace function app_private.invalidate_participant_tickets()'),foundation.indexOf('create index if not exists application_document_package_items_document_id_idx')));
const service=await read('supabase/migrations/20260922013712_coach_portal_service_rpcs.sql');await db.exec(service.slice(service.indexOf('create or replace function app_private.coaching_actor_can_access('),service.indexOf('create or replace function public.coach_create_participant(')));
await db.query("insert into coaching_workspaces(id,name) values($1,'NexaLabs'),($2,'Other')",[id(90),id(91)]);
for(const n of [1,2,3,4,5]){await db.query('insert into auth.users values($1)',[id(n)]);const role=n===1||n===5?'admin':'coach',displayName=n===1?'Arash':n===5?'Behzad':'Coach '+n;await db.query('insert into coaching_members(id,auth_user_id,workspace_id,display_name,role) values($1,$1,$2,$3,$4)',[id(n),id(n===4?91:90),displayName,role]);}
const superAdmin=await read('supabase/migrations/20261014121529_coach_super_admin_role.sql');await db.exec(superAdmin);
await db.query('insert into bot_users(id,telegram_user_id,chat_id) values($1,20,20)',[id(20)]);
await db.query('insert into coaching_participants(user_id,workspace_id,coach_member_id) values($1,$2,$3)',[id(20),id(90),id(1)]);await test('Super Admin is allowlisted and can manage regular Admin members',async()=>{
 assert.equal((await one('select is_super_admin from coaching_members where id=$1',[id(1)])).is_super_admin,true);
 assert.equal((await one('select is_super_admin from coaching_members where id=$1',[id(5)])).is_super_admin,false);
 await assert.rejects(db.query('select coach_prepare_member_deletion($1,$2,$3)',[id(5),id(1),null]),/super_admin_protected/);
 await db.query('select coach_prepare_member_deletion($1,$2,$3)',[id(1),id(5),null]);
 assert.equal((await one('select is_active from coaching_members where id=$1',[id(5)])).is_active,false);
 await db.query('update coaching_members set is_active=true where id=$1',[id(5)]);
});

for(const suffix of ['coaching_participant_sync_and_manager_assignment.sql','platform_connect_atomic_completion.sql']){const name=(await readdir(new URL('supabase/migrations/',root))).find(x=>x.endsWith(suffix));await db.exec(await read('supabase/migrations/'+name));}
let portal;
await test('Telegram enrolment is automatic and unique; portal identity and creation are idempotent',async()=>{
 assert.equal((await one('select coach_member_id from coaching_participants')).coach_member_id,null);
 await db.query('insert into bot_users(id,telegram_user_id,chat_id) values($1,21,21)',[id(21)]);await db.query('insert into search_profiles values($1),($1)',[id(21)]);
 assert.equal((await one('select count(*)::int n from coaching_participants where user_id=$1',[id(21)])).n,1);
 const args=[id(1),null,id(80),'Ada','Example',null,null];portal=(await one('select coach_create_participant_idempotent($1,$2,$3,$4,$5,$6,$7) u',args)).u;assert.equal((await one('select coach_create_participant_idempotent($1,$2,$3,$4,$5,$6,$7) u',args)).u,portal);
 assert.equal((await one('select telegram_user_id from bot_users where id=$1',[portal])).telegram_user_id,null);
 await db.query('update bot_users set telegram_user_id=22,chat_id=22,plan_override=\'premium\' where id=$1',[portal]);assert.equal((await one('select count(*)::int n from coaching_participants where user_id=$1',[portal])).n,1);
});
await test('only active same-workspace managers are assignable; own participants stay isolated',async()=>{
 for(const target of [id(1),id(4)])await assert.rejects(db.query('select coach_reassign_participant($1,$2,$3)',[id(1),portal,target]),/coach_unavailable/);
 await db.query('select coach_reassign_participant($1,$2,$3)',[id(1),portal,id(2)]);
 assert.equal((await one('select app_private.coaching_actor_can_access($1,$2,false) a',[id(2),portal])).a,true);assert.equal((await one('select app_private.coaching_actor_can_access($1,$2,false) a',[id(3),portal])).a,false);
});
const issue=async(provider='immoscout')=>{const state=crypto.randomUUID().replaceAll('-','')+'random';await db.query('select coach_issue_platform_connect_flow($1,$2,$3,$4,$5)',[id(2),portal,provider,state,'v'.repeat(43)]);return one('select * from platform_auth_flows where state=$1',[state]);};
const claim=async f=>(await one('select claim_platform_connect_flow($1,$2,$3) c',[f.id,portal,f.provider])).c;
const complete=(f,c,cipher='cipher')=>db.query('select complete_platform_connect_flow($1,$2,$3,$4,$5)',[f.id,portal,f.provider,c,{credential_ciphertext:cipher,credential_iv:'iv'}]);
await test('all four links last 30 minutes, admit one concurrent claim and atomically complete once',async()=>{
 for(const provider of ['immoscout','kleinanzeigen','immomio','immowelt']){const f=await issue(provider);assert.ok(Math.abs(new Date(f.expires_at)-new Date(f.created_at)-1800000)<1000);const out=await Promise.allSettled([claim(f),claim(f)]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);const c=out.find(x=>x.status==='fulfilled').value;await assert.rejects(complete(f,'wrong'),/auth_flow_expired/);await complete(f,c);await assert.rejects(complete(f,c,'replacement'),/auth_flow_expired/);assert.equal((await one('select credential_ciphertext from platform_connections where user_id=$1 and provider=$2',[portal,provider])).credential_ciphertext,'cipher');}
});
await test('expired, replaced, reassigned and deactivated links cannot complete or overwrite credentials',async()=>{
 let f=await issue(),c=await claim(f);await db.query("update platform_auth_flows set expires_at=now()-interval '1 second' where id=$1",[f.id]);await assert.rejects(complete(f,c),/auth_flow_expired/);
 f=await issue();await issue();await assert.rejects(claim(f),/auth_flow_expired/);
 f=await issue();c=await claim(f);await db.query('select coach_reassign_participant($1,$2,$3)',[id(1),portal,id(3)]);await assert.rejects(complete(f,c),/auth_flow_expired/);await db.query('select coach_reassign_participant($1,$2,$3)',[id(1),portal,id(2)]);
 f=await issue();await db.query('update coaching_members set is_active=false where id=$1',[id(2)]);await db.query('update coaching_members set is_active=true where id=$1',[id(2)]);await assert.rejects(claim(f),/auth_flow_expired/);
});
await test('manager deletion preserves participants and documents, including creator FK',async()=>{
 await db.query('update coaching_participants set created_by_member_id=$1 where user_id=$2',[id(2),portal]);await db.query("insert into storage.objects values($1,$2,'document.pdf')",[id(2),id(2)]);await db.query('select coach_prepare_member_deletion($1,$2,$3)',[id(1),id(2),id(3)]);await db.query('delete from auth.users where id=$1',[id(2)]);assert.deepEqual(await one('select coach_member_id,created_by_member_id from coaching_participants where user_id=$1',[portal]),{coach_member_id:id(3),created_by_member_id:null});assert.equal((await one('select owner from storage.objects')).owner,id(1));
});
await test('connection RPCs reject public and authenticated callers',async()=>{
 for(const f of ['claim_platform_connect_flow(uuid,uuid,text)','complete_platform_connect_flow(uuid,uuid,text,text,jsonb)','coach_issue_platform_connect_flow(uuid,uuid,text,text,text)','coach_prepare_member_deletion(uuid,uuid,uuid)'])assert.deepEqual(await one("select has_function_privilege('anon',$1,'EXECUTE') a,has_function_privilege('authenticated',$1,'EXECUTE') b,has_function_privilege('service_role',$1,'EXECUTE') c",['public.'+f]),{a:false,b:false,c:true});
});await db.close();
