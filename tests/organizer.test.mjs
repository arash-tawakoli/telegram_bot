import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {structuredFacts,present} from '../supabase/functions/notification-dispatcher/source-facts.ts';
import {quickApplyButton} from '../supabase/functions/telegram-ui/application-message.js';
const code=readFileSync(new URL('../supabase/functions/telegram-ui/organizer.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
const ID1='00000000-0000-4000-8000-000000000001',ID2='00000000-0000-4000-8000-000000000002',ID3='00000000-0000-4000-8000-000000000003';
const owner={id:'owner',is_premium:true,onboarding_step:'rent',onboarding_state:{max_warm_rent:1500}};
const listing=(id,rent=1000)=>({id,title:'Wohnung <gut>',canonical_url:'https://example.test/expose/'+id,is_active:true,raw:{warmRent:rent,coldRent:800,additionalCosts:100,heatingCosts:100,size:50,rooms:2,deposit:2400,address:'Quellstraße 1'}});
function harness(extra=[]){
 const records=[{user_id:'owner',listing_id:ID1,status:'saved',note:null,listings:listing(ID1)},{user_id:'owner',listing_id:ID2,status:'saved',note:null,listings:listing(ID2,1200)},{user_id:'other',listing_id:ID3,status:'saved',note:'private',listings:listing(ID3)},...extra];const calls=[],states=[];
 const db={from(table){assert.equal(table,'saved_listings');const filters=[];let patch;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},update(x){patch=x;return q},async maybeSingle(){return {data:records.find(r=>filters.every(([k,v])=>r[k]===v))||null,error:null}},async range(a,b){const rows=records.filter(r=>filters.every(([k,v])=>r[k]===v));return{data:rows.slice(a,b+1),count:rows.length,error:null}},then(resolve){assert.ok(filters.some(([k,v])=>k==='user_id'&&v==='owner'),'every write is owner scoped');assert.ok(filters.some(([k])=>k==='listing_id'));for(const r of records.filter(r=>filters.every(([k,v])=>r[k]===v)))Object.assign(r,patch);return Promise.resolve({error:null}).then(resolve)}};return q}};
 const out={db,structuredFacts,present,Date,Number,Object,Array,String,URL,Intl,btoa,atob,console,button:(text,callback_data)=>({text,callback_data}),esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),short:(v,n)=>String(v||'Inserat').slice(0,n),money:x=>new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(x)+' €',send:async(c,t,m)=>calls.push({c,t,m}),edit:async(c,id,t,m)=>calls.push({c,id,t,m}),premium:async()=>calls.push({premium:true}),saveState:async(user,step,state)=>states.push({user,step,state})};
 out.quickApplyButton=quickApplyButton;vm.runInNewContext(code,out);return {...out,calls,states,records};
}
test('status tracking persists, private records and forged IDs cannot be accessed or changed',async()=>{
 const h=harness(),token=h.packId(ID1);await h.organizer(owner,1,2,`org:status:${token}:contacted`);assert.equal(h.records[0].status,'contacted');assert.match(h.calls.at(-1).t,/Angefragt/);
 await h.organizer(owner,1,2,`org:status:${h.packId(ID3)}:accepted`);assert.equal(h.records[2].status,'saved');assert.doesNotMatch(h.calls.at(-1).t,/private/);
 await h.organizer(owner,1,2,'org:view:malformed');assert.match(h.calls.at(-1).t,/nicht in deiner Merkliste/);
 await h.organizer({...owner,is_premium:false},1,2,`org:view:${token}`);assert.equal(h.calls.at(-1).premium,true);
});
test('notes are owner scoped, escaped, editable and do not overwrite an unfinished search draft',async()=>{
 const h=harness(),user=structuredClone(owner),token=h.packId(ID1);
 await h.organizer(user,1,2,`org:note:${token}`);assert.equal(h.states[0].step,'rent');assert.equal(h.states[0].state.max_warm_rent,1500);user.onboarding_state=h.states[0].state;
 assert.equal(await h.organizerMessage({chat:{id:1},text:'<Ansprechpartner> & Termin'},user),true);
 assert.equal(h.records[0].note,'<Ansprechpartner> & Termin');assert.match(h.calls.at(-1).t,/&lt;Ansprechpartner&gt; &amp; Termin/);assert.equal(h.states.at(-1).state.max_warm_rent,1500);assert.equal(h.states.at(-1).state.organizer_note,undefined);
 await h.organizer(user,1,2,`org:note:${token}:clear`);assert.equal(h.records[0].note,null);
});
test('expired, oversized and command-cancelled note input cannot silently replace notes',async()=>{
 const h=harness();let user={...owner,onboarding_state:{organizer_note:{token:h.packId(ID1),started_at:Date.now()-700000}}};
 await h.organizerMessage({chat:{id:1},text:'expired'},user);assert.equal(h.records[0].note,null);
 user={...owner,onboarding_state:{organizer_note:{token:h.packId(ID1),started_at:Date.now()}}};
 await h.organizerMessage({chat:{id:1},text:'x'.repeat(1501)},user);assert.equal(h.records[0].note,null);assert.match(h.calls.at(-1).t,/1.500/);
 assert.equal(await h.organizerMessage({chat:{id:1},text:'/start'},user),false);assert.equal(h.states.at(-1).state.organizer_note,undefined);
});
test('comparison uses two owned listings and only compares known costs',async()=>{
 const h=harness();await h.organizer(owner,1,2,`org:compare:${h.packId(ID1)}:${h.packId(ID2)}`);assert.match(h.calls.at(-1).t,/A hat 200 € weniger/);
 await h.organizer(owner,1,2,`org:compare:${h.packId(ID1)}:${h.packId(ID3)}`);assert.match(h.calls.at(-1).t,/andere gespeicherte/);
 const empty={id:ID1,title:'Leer',canonical_url:'https://example.test/1',raw:{}};
 assert.doesNotMatch(h.comparisonText(empty,empty),/Warmmiete:|Kaution:|nicht vorhanden|keine Angabe/);
});
test('cost summary does not double count rent components or use calculated warm rent',()=>{
 const h=harness();const text=h.costText(listing(ID1));assert.match(text,/12 Monatswarmmieten = 12.000 €/);assert.match(text,/Kaution = 3.400 €/);assert.match(text,/Kaltmiete pro m² = 16 €/);
 const l=listing(ID1);delete l.raw.warmRent;l.warm_rent=1000;l.warm_rent_is_calculated=true;assert.doesNotMatch(h.costText(l),/12 Monatswarmmieten|Eine Monatswarmmiete/);
});
test('contact drafts invent no applicant qualifications and escape source titles',()=>{
 const h=harness();const text=h.contactText(listing(ID1),'inquiry');assert.match(text,/&lt;gut&gt;/);assert.match(text,/\[Dein Name\]/);assert.doesNotMatch(text,/unbefristet|Nichtraucher|SCHUFA|Einkommen/);assert.match(h.contactText(listing(ID1),'followup'),/nachfragen/);assert.equal(h.calls.length,0);
});
test('pagination reaches older saved offers and compact comparison callbacks fit Telegram limits',async()=>{
 const extra=Array.from({length:7},(_,i)=>({user_id:'owner',listing_id:`00000000-0000-4000-8000-${String(i+10).padStart(12,'0')}`,status:'saved',listings:listing(ID1)}));const h=harness(extra);
 await h.organizer(owner,1,2,'org:list:0');assert.equal(h.calls.at(-1).m.inline_keyboard[6][0].callback_data,'org:list:1');
 await h.organizer(owner,1,2,'org:list:1');assert.match(h.calls.at(-1).t,/Seite 2/);
 for(const action of ['list:0',`view:${h.packId(ID1)}`,`status:${h.packId(ID1)}`,`pick:${h.packId(ID1)}:0`]){
  await h.organizer(owner,1,2,'org:'+action);
  for(const row of h.calls.at(-1).m.inline_keyboard)for(const b of row)if(b.callback_data)assert.ok(Buffer.byteLength(b.callback_data)<=64,b.callback_data);
 }
 assert.equal(h.unpackId(h.packId(ID1)),ID1);
});

test('new menu command and callback reach the organizer, with callback acknowledgement scheduled first',async()=>{
 const handlers=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const calls=[];const scope={Number,String,EdgeRuntime:{waitUntil:p=>{calls.push('ack');}},acknowledge:async()=>{},organizerMessage:async()=>false,organizer:async(...args)=>calls.push(args),clearOrganizerNote:async()=>{}};
 vm.runInNewContext(handlers,scope);
 await scope.handleMessage({chat:{id:1},text:'/planer'},owner);assert.equal(calls[0][0],owner);
 calls.length=0;await scope.handleCallback({id:'q',data:'org:list:0',message:{message_id:2,chat:{id:1}}},owner);
 assert.equal(calls[0],'ack');assert.equal(calls[1][3],'org:list:0');
});
test('fast menus advertise the planner and planner commands fall through to the authenticated core',()=>{
 const s=readFileSync(new URL('../supabase/functions/telegram-fast/index.ts',import.meta.url),'utf8');
 assert.match(s,/button\("🗂 Wohnungsplaner", "org:list:0"\)/);
 assert.match(s,/if \(!action\) return forwardCore\(body, supplied\)/);
 assert.match(s,/fast_eligible === false \|\| user.onboarding_state\?\.organizer_note/);
 assert.doesNotMatch(s.slice(s.indexOf('const COMMAND_ACTIONS'),s.indexOf('let cachedWebhookSecret')),/"\/planer":/);
});
