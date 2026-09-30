import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../supabase/migrations/20260930221821_record_native_document_delivery_result.sql',import.meta.url),'utf8');

test('application status events atomically retain validated document results without inventing legacy delivery',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   create schema app_private;
   create function app_private.application_provider_target(integer,jsonb,text) returns text language sql as $$ select 'immomio'::text $$;
   create table listings(id uuid primary key,source_id integer,raw jsonb,canonical_url text);
   create table applications(id uuid primary key,user_id uuid,listing_id uuid,source_id integer,status text,attempts integer default 0,wait_reason text,last_error text,provider_state jsonb default '{}'::jsonb);
   create table application_events(id bigserial primary key,application_id uuid,user_id uuid,provider text,event_type text,status text,attempt integer,reason text,document_result text,metadata jsonb);
   ${migration}
   create trigger applications_log_event after insert or update of status,wait_reason on applications for each row execute function app_private.log_application_event();
   insert into listings values('10000000-0000-4000-8000-000000000001',4,'{}','https://tenant.immomio.com/');
  `);
  let n=0;
  for(const [documentResult,status,error] of [
   ['native_uploaded','sent',null],['native_uploaded','manual_required','submission_unconfirmed'],
   ['not_provided','sent',null],['transfer_failed','manual_required','document_transfer_unverified'],
   [null,'sent',null],['unverified-upload-claim','sent',null]
  ]){
   const id='20000000-0000-4000-8000-'+String(++n).padStart(12,'0');
   await db.query(`insert into applications(id,user_id,listing_id,source_id,status) values($1,$1,'10000000-0000-4000-8000-000000000001',4,'pending')`,[id]);
   const before=await db.query('select document_result from application_events where application_id=$1',[id]);assert.equal(before.rows[0].document_result,null);
   await db.query('update applications set status=$2,last_error=$3,provider_state=$4 where id=$1',[id,status,error,JSON.stringify(documentResult?{document_result:documentResult}:{} )]);
   const after=await db.query('select status,reason,document_result from application_events where application_id=$1 order by id desc limit 1',[id]);
   assert.deepEqual(after.rows[0],{status,reason:error,document_result:documentResult==='unverified-upload-claim'?null:documentResult});
  }
  await db.exec('begin');
  await db.query(`update applications set status='failed',provider_state='{"document_result":"transfer_failed"}' where id='20000000-0000-4000-8000-000000000001'`);
  await db.exec('rollback');
  const rolledBack=await db.query(`select status,document_result from application_events where application_id='20000000-0000-4000-8000-000000000001' order by id desc limit 1`);
  assert.deepEqual(rolledBack.rows[0],{status:'sent',document_result:'native_uploaded'});
 }finally{await db.close()}
});
