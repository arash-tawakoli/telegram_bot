import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const code=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/coach-api/index.ts',import.meta.url),'utf8').replace(/^import[^;]+;\n/gm,''));
const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const workspace=id(900),otherWorkspace=id(901),now=Date.now();
const date=offset=>new Date(now+offset).toISOString();

function fixture({applications=472,users=20,authMember=1,events,failPage=false}={}){
 const members=[1,2,3].map(n=>({id:id(n),auth_user_id:id(n),workspace_id:workspace,role:n===1?'admin':'coach',is_active:true,display_name:'Member '+n,coaching_workspaces:{id:workspace,name:'Test',is_active:true,operations_paused:false}}));
 const assignments=Array.from({length:users},(_,i)=>({user_id:id(100+i),public_id:'cp_'+String(i).padStart(24,'0'),workspace_id:workspace,coach_member_id:id(i<users/2?2:3),status:'active',bot_users:{first_name:'Participant',last_name:String(i),is_active:true}}));
 // An unrelated workspace must never contribute applications or events.
 assignments.push({user_id:id(999),public_id:'cp_'+String(999).padStart(24,'0'),workspace_id:otherWorkspace,coach_member_id:id(2),status:'active',bot_users:{first_name:'Other'}});
 const apps=Array.from({length:applications},(_,i)=>({id:id(1000+i),user_id:id(100+i%users),status:'sent',created_at:date(-i),listings:{title:'Offer '+i}}));
 apps.push({id:id(9999),user_id:id(999),status:'sent',created_at:date(0)});
 const eventRows=events?events(apps):apps.map((a,i)=>({id:id(20000+i),application_id:a.id,provider:'immowelt',document_result:'link_included',status:'sent',reason:null,created_at:date(-i)}));
 const tables={coaching_members:members,coaching_participants:assignments,applications:apps,application_events:eventRows,applicant_profiles:[],application_preferences:[]};
 const eventRequests=[];
 const db={
  auth:{getUser:async()=>({data:{user:{id:id(authMember)}},error:null})},
  rpc:async(name,args)=>{
   assert.equal(name,'coach_readiness_core');
   return{data:args.p_users.map(user_id=>({user_id,is_premium:true,profile_complete:true,active_search_count:1,connected_providers:['immowelt'],enabled_providers:['immowelt'],ready_providers:['immowelt'],automation_enabled:true})),error:null};
  },
  from(table){
   const filters=[],orders=[];
   let limit=1000,from=0,to=999,selected='*',single=false;
   const q={
    select(value){selected=value;return q},
    eq(key,value){filters.push(row=>row[key]===value);return q},
    in(key,values){filters.push(row=>values.includes(row[key]));q.inKey=key;q.inValues=values;return q},
    gte(key,value){filters.push(row=>row[key]>=value);return q},
    order(key,{ascending=true}={}){orders.push({key,ascending});return q},
    limit(value){limit=value;return q},
    range(start,end){from=start;to=end;return q},
    maybeSingle(){single=true;return q},
    then(resolve,reject){
     let rows=(tables[table]||[]).filter(row=>filters.every(f=>f(row)));
     if(table==='application_events'){
      const url=new URL('https://example.supabase.co/rest/v1/application_events');
      url.searchParams.set('select',selected);
      url.searchParams.set(q.inKey,'in.('+q.inValues.join(',')+')');
      url.searchParams.set('order',orders.map(o=>o.key+(o.ascending?'.asc':'.desc')).join(','));
      url.searchParams.set('offset',String(from));
      url.searchParams.set('limit',String(to-from+1));
      eventRequests.push({ids:[...q.inValues],from,to,urlLength:url.href.length});
      // Model the production HTTP/2 header limit, independent of batching strategy.
      if(url.href.length>16384)return Promise.resolve({data:null,error:{message:'HTTP/2 response header exceeds 16 KB'}}).then(resolve,reject);
      if(failPage&&from>=1000)return Promise.resolve({data:null,error:{message:'event page unavailable'}}).then(resolve,reject);
     }
     rows.sort((a,b)=>{for(const {key,ascending} of orders){if(a[key]!==b[key])return(a[key]<b[key]?-1:1)*(ascending?1:-1)}return 0});
     rows=rows.slice(from,Math.min(to+1,from+limit));
     return Promise.resolve({data:single?(rows[0]||null):rows,error:null}).then(resolve,reject);
    }
   };
   return q;
  }
 };
 const context={createClient:()=>db,providerStaticMissing:()=>[],Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://example.supabase.co':undefined},serve:()=>{}},Request,Response,console,Date};
 vm.runInNewContext(code+';globalThis.subject={applicationRows,dashboardData,handle};',context);
 const actor={member:members[authMember-1],user:{id:id(authMember)},workspace:members[0].coaching_workspaces};
 const invoke=body=>context.subject.handle(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)}));
 return{...context.subject,actor,apps,eventRows,eventRequests,invoke};
}

test('the production-sized 472-application read avoids oversized response headers and keeps every latest event',async()=>{
 const f=fixture(),rows=await f.applicationRows(f.actor);
 assert.equal(rows.length,472);
 assert.ok(rows.every(row=>row.latestEvent?.status==='sent'));
 assert.equal(f.eventRequests.reduce((n,r)=>n+r.ids.length,0),472);
 assert.ok(f.eventRequests.every(r=>r.urlLength<5000));
 assert.ok(!f.eventRequests.some(r=>r.ids.includes(id(9999))));
 const dashboard=await f.dashboardData(f.actor);
 assert.equal(dashboard.applications.total,472);
 assert.equal(dashboard.applications.sent,472);
 assert.equal(dashboard.providers.immowelt,472);
});

const crowdedEvents=apps=>[
 ...Array.from({length:1100},(_,i)=>({id:id(30000+i),application_id:apps[0].id,provider:'immowelt',status:'sent',created_at:date(-i)})),
 ...apps.slice(1).map((a,i)=>({id:id(40000+i),application_id:a.id,provider:'immoscout',status:'sent',created_at:date(-2000-i)}))
];

test('events beyond the 1000-row API page still include older applications and preserve the newest event',async()=>{
 const f=fixture({applications:100,events:crowdedEvents}),rows=await f.applicationRows(f.actor);
 assert.equal(rows.length,100);
 assert.ok(rows.every(row=>row.latestEvent));
 assert.equal(rows.find(row=>row.id===id(1000)).latestEvent.created_at,date(0));
 assert.equal(rows.find(row=>row.id===id(1099)).latestEvent.provider,'immoscout');
 assert.deepEqual(f.eventRequests.map(r=>[r.from,r.to]),[[0,999],[1000,1999]]);
});

test('a failed later event page rejects the read instead of returning incomplete dashboard data',async()=>{
 const f=fixture({applications:100,events:crowdedEvents,failPage:true});
 await assert.rejects(f.applicationRows(f.actor),/applications_read_failed/);
});

test('manager and admin-preview reads only query events for their assigned participants',async()=>{
 for(const authMember of [1,2]){
  const f=fixture({authMember}),expected=f.apps.filter(a=>Number(a.user_id.slice(-12))<110&&a.user_id!==id(999));
  const result=await f.invoke({action:'applications',pageSize:100,scope:'all',...(authMember===1?{previewMemberId:id(2)}:{})});
  assert.equal(result.total,expected.length);
  const allowed=new Set(expected.map(a=>a.id));
  assert.ok(f.eventRequests.every(r=>r.ids.every(applicationId=>allowed.has(applicationId))));
 }
});

test('equal event timestamps use deterministic ordering while empty scope avoids event requests',async()=>{
 const f=fixture({applications:1,events:apps=>[
  {id:id(1),application_id:apps[0].id,provider:'immowelt',status:'pending',created_at:date(0)},
  {id:id(2),application_id:apps[0].id,provider:'immowelt',status:'sent',created_at:date(0)}
 ]});
 assert.equal((await f.applicationRows(f.actor))[0].latestEvent.status,'sent');
 f.eventRequests.length=0;
 assert.equal((await f.applicationRows(f.actor,'mine')).length,0);
 assert.equal(f.eventRequests.length,0);
});
