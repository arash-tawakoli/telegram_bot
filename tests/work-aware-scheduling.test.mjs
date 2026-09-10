import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`
 create schema cron; create schema net; create schema pgmq; create schema app_private;
 create table cron.job(jobid serial primary key,jobname text unique,schedule text,command text);
 create function cron.schedule(text,text,text) returns bigint language sql as $$
  insert into cron.job(jobname,schedule,command) values($1,$2,$3)
  on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid::bigint $$;
 create function cron.unschedule(integer) returns boolean language sql as $$delete from cron.job where jobid=$1 returning true$$;
 create table cron.job_run_details(runid serial primary key,status text,end_time timestamptz);
 create table pgmq.q_source_jobs(vt timestamptz);
 create table public.delivery_events(status text,delivery_outcome_unknown boolean default false,dispatch_attempts int default 0,next_retry_at timestamptz,last_attempt_at timestamptz);
 create table net.requests(id serial primary key,url text);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.requests(url) values($1) returning id::bigint$$;
 create function public.get_bot_secret(text) returns text language sql as $$select 'fixture-only'::text$$;
 create function app_private.enqueue_due_source_jobs(integer) returns integer language plpgsql as $$begin
  if current_setting('fixture.enqueue',true)='true' then insert into pgmq.q_source_jobs values(now()); end if; return 0; end$$;
 create function app_private.prepare_current_delivery_queue() returns integer language plpgsql as $$begin
  if current_setting('fixture.expire',true)='true' then update delivery_events set status='skipped'; end if; return 0; end$$;
 create function app_private.maintenance_cleanup() returns jsonb language sql as $$select '{}'::jsonb$$;
 select cron.schedule('source-worker-every-minute','* * * * *','old-worker');
`);
await db.exec(await readFile(new URL('../supabase/migrations/20260910100251_work_aware_scheduling_and_log_retention.sql',import.meta.url),'utf8'));
const run=async name=>db.exec((await db.query('select command from cron.job where jobname=$1',[name])).rows[0].command);
const requests=async()=>Number((await db.query('select count(*) n from net.requests')).rows[0].n);
const clear=()=>db.exec("truncate net.requests,pgmq.q_source_jobs,delivery_events; set fixture.enqueue='false'; set fixture.expire='false'");
await test('source scheduler owns dispatch; duplicate timer is removed',async()=>{
 assert.equal((await db.query("select count(*)::int n from cron.job where jobname='source-worker-every-minute'")).rows[0].n,0);
 await clear(); await run('source-scheduler-every-minute'); assert.equal(await requests(),0);
 await db.exec("set fixture.enqueue='true'");
 await run('source-scheduler-every-minute'); assert.equal(await requests(),1);
});
await test('visible retries trigger work, invisible leases do not',async()=>{
 await clear(); await db.exec("insert into pgmq.q_source_jobs values(now()+interval '5 minutes')");
 await run('source-scheduler-every-minute'); assert.equal(await requests(),0);
 await db.exec("update pgmq.q_source_jobs set vt=now()-interval '1 second'");
 await run('source-scheduler-every-minute'); assert.equal(await requests(),1);
});
await test('empty, deferred, exhausted and uncertain deliveries do not invoke Edge',async()=>{
 await clear(); await run('notification-dispatcher-every-minute'); assert.equal(await requests(),0);
 await db.exec("insert into delivery_events(status,next_retry_at) values('pending',now()+interval '1 hour'); insert into delivery_events(status,dispatch_attempts) values('failed',5); insert into delivery_events(status,delivery_outcome_unknown) values('failed',true)");
 await run('notification-dispatcher-every-minute'); assert.equal(await requests(),0);
});
await test('pending and due retry events trigger dispatch after freshness preparation',async()=>{
 for(const status of ['pending','failed']){
  await clear(); await db.query("insert into delivery_events(status,next_retry_at) values($1,now()-interval '1 second')",[status]);
  await run('notification-dispatcher-every-minute'); assert.equal(await requests(),1);
 }
 await clear(); await db.exec("insert into delivery_events(status) values('pending');set fixture.expire='true'");
 await run('notification-dispatcher-every-minute'); assert.equal(await requests(),0);
});
await test('expired processing leases still invoke recovery; live leases do not',async()=>{
 await clear(); await db.exec("insert into delivery_events(status,last_attempt_at) values('processing',now())");
 await run('notification-dispatcher-every-minute'); assert.equal(await requests(),0);
 await db.exec("update delivery_events set last_attempt_at=now()-interval '11 minutes'");
 await run('notification-dispatcher-every-minute'); assert.equal(await requests(),1);
});
await test('shadow diagnostics run hourly and history cleanup preserves recent/failing/running jobs',async()=>{
 assert.equal((await db.query("select schedule from cron.job where jobname='source-shadow-probes'")).rows[0].schedule,'12 * * * *');
 await db.exec("insert into cron.job_run_details(status,end_time) values ('succeeded',now()-interval '8 days'),('succeeded',now()-interval '1 day'),('failed',now()-interval '8 days'),('failed',now()-interval '31 days'),('running',null)");
 await run('architecture-maintenance-daily');
 assert.equal((await db.query('select count(*)::int n from cron.job_run_details')).rows[0].n,3);
});
await db.close();
