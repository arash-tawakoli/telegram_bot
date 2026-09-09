import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {applicationTarget, quickApplyButton, generateApplicationMessage} from '../supabase/functions/telegram-ui/application-message.js';

const id='00000000-0000-4000-8000-000000000001';
const user={id:'owner',telegram_user_id:123,chat_id:123,is_active:true,first_name:'Anna',last_name:'Muster'};
const scout={id,source_id:1,title:'Wohnung <Hamburg>',canonical_url:'https://www.immobilienscout24.de/expose/12345?ref=search',is_active:true};
const klein={...scout,source_id:2,canonical_url:'https://www.kleinanzeigen.de/s-anzeige/wohnung/12345-203-10'};
const query={data:`apply:${id}`,message:{chat:{id:123,type:'private'}}};
const code=readFileSync(new URL('../supabase/functions/telegram-ui/application.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');

function harness({listing=scout,delivered=true,saved=false,errorTable=null}={}) {
 const reads=[],calls=[];
 const db={from(table){
  const filters={}; const q={select(){return q},eq(k,v){filters[k]=v;return q},
   async limit(){
    reads.push({table,filters});
    assert.equal(filters.listing_id,id);
    assert.equal(filters[table==='delivery_events'?'recipient_user_id':'user_id'],user.id);
    if(table==='delivery_events')assert.equal(filters.status,'sent');
    const present=table==='delivery_events'?delivered:saved;
    return {data:present?[{id:'record'}]:[],error:table===errorTable?new Error('database unavailable'):null};
   },
   async maybeSingle(){reads.push({table,filters});assert.equal(table,'listings');assert.equal(filters.id,id);return {data:listing,error:table===errorTable?new Error('database unavailable'):null};}
  };return q;
 }};
 const scope={db,send:async(chat,text)=>calls.push({chat,text}),telegram:async(method,body)=>calls.push({method,...body}),esc:s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),applicationTarget,quickApplyButton,generateApplicationMessage};
 vm.runInNewContext(code,scope);
 return {...scope,reads,calls};
}

test('both platforms produce copyable drafts and their exact listing link; no application is marked sent',async()=>{
 for(const listing of [scout,klein]){
  const h=harness({listing});await h.quickApplication(user,query);
  assert.equal(h.calls.length,1);
  const response=h.calls[0];assert.equal(response.method,'sendMessage');assert.equal(response.chat_id,123);
  assert.match(response.text,/Noch nicht versendet/);assert.match(response.text,/Wohnung &lt;Hamburg&gt;/);
  const rows=response.reply_markup.inline_keyboard;
  assert.equal(rows[0][0].copy_text.text,generateApplicationMessage(user,listing));
  assert.equal(rows[1][0].url,listing.canonical_url.split('?')[0]);
  assert.equal(h.reads.length,2);
 }
});

test('forged, foreign, group and forwarded callbacks disclose no draft',async()=>{
 for(const q of [{...query,data:'apply:not-an-id'},{...query,message:{chat:{id:999,type:'private'}}},{...query,message:{chat:{id:123,type:'group'}}}]){
  const h=harness();await h.quickApplication(user,q);assert.equal(h.reads.length,0);assert.ok(h.calls.every(c=>!c.reply_markup));
 }
 const h=harness({delivered:false});await h.quickApplication(user,query);assert.equal(h.reads.length,1);assert.ok(!h.calls[0].reply_markup);
 const inactive=harness();await inactive.quickApplication({...user,is_active:false},query);assert.equal(inactive.calls.length,0);
});

test('retained saved listings work after delivery retention only for their premium owner',async()=>{
 const h=harness({delivered:false,saved:true});await h.quickApplication({...user,is_premium:true},query);
 assert.equal(h.calls[0].method,'sendMessage');assert.deepEqual(h.reads.map(r=>r.table),['delivery_events','saved_listings','listings']);
 const missing=harness({delivered:false,saved:false});await missing.quickApplication({...user,is_premium:true},query);assert.equal(missing.reads.length,2);assert.ok(!missing.calls[0].reply_markup);
});

test('inactive or unsupported offers and database failures fail closed',async()=>{
 for(const listing of [null,{...scout,is_active:false},{...scout,canonical_url:'https://evil.test/expose/12345'}]){
  const h=harness({listing});await h.quickApplication(user,query);assert.ok(!h.calls[0].reply_markup);
 }
 for(const errorTable of ['delivery_events','saved_listings','listings']){
  const h=harness({errorTable,delivered:errorTable!=='saved_listings'});
  await assert.rejects(h.quickApplication({...user,is_premium:true},query),/database unavailable/);assert.equal(h.calls.length,0);
 }
});

test('platform link allowlist rejects redirects, credentials, wrong sources and non-listing paths',()=>{
 for(const canonical_url of ['http://www.immobilienscout24.de/expose/123','https://www.immobilienscout24.de.evil.test/expose/123','https://evil.test@www.immobilienscout24.de/expose/123','https://www.immobilienscout24.de:444/expose/123','https://www.immobilienscout24.de/redirect/123','https://www.immobilienscout24.de/expose/123/../../login','javascript:alert(1)'])assert.equal(applicationTarget({...scout,canonical_url}),null);
 assert.equal(applicationTarget({...klein,source_id:1}),null);
 assert.equal(applicationTarget({...scout,source_id:2}),null);
 assert.equal(quickApplyButton({...scout,id:'bad'}),null);
 assert.equal(quickApplyButton({...scout,is_active:false}),null);
 assert.ok(Buffer.byteLength(quickApplyButton(scout).callback_data)<=64);
});

test('draft stays within copy limits, includes only known identity, and handles Unicode safely',()=>{
 const text=generateApplicationMessage({first_name:'😀'.repeat(80),last_name:'x'.repeat(100),income:5000,wbs:true},{title:'😀'.repeat(100)});
 assert.ok(text.length<=256);assert.ok(text.isWellFormed());
 assert.doesNotMatch(text,/5000|WBS|unbefristet|SCHUFA/);
 assert.match(generateApplicationMessage({},{}),/\[Dein Name\]/);
 assert.doesNotMatch(generateApplicationMessage({first_name:'Anna\nAdmin'},scout),/Anna\nAdmin/);
});

test('new callbacks are acknowledged and routed through the existing core',async()=>{
 const source=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');
 const calls=[];const scope={EdgeRuntime:{waitUntil:()=>calls.push('ack')},acknowledge:async()=>{},quickApplication:async(u,q)=>calls.push([u,q])};
 vm.runInNewContext(source.slice(source.indexOf('export async function handleCallback')).replace('export ',''),scope);
 const q={...query,id:'callback',message:{...query.message,message_id:42}};
 await scope.handleCallback(q,user);assert.equal(calls[0],'ack');assert.equal(calls[1][0],user);assert.equal(calls[1][1],q);
});

test('delivery keyboard adds quick apply for both platforms without changing other source buttons',()=>{
 const source=readFileSync(new URL('../supabase/functions/notification-dispatcher/index.ts',import.meta.url),'utf8');
 const scope={quickApplyButton,offerTarget:l=>({url:l.canonical_url,text:'Angebot'}),mapLoc:()=>null,label:(_,key)=>key};
 vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('function kb('),source.indexOf('async function tg('))),scope);
 for(const listing of [scout,klein])for(const premium of [true,false]){
  const rows=scope.kb(listing,'de',premium).inline_keyboard;
  assert.equal(rows[1][0].callback_data,`apply:${id}`);
  assert.equal(rows.at(-1)[0].callback_data,premium?`save:${id}`:'premium');
 }
 assert.equal(scope.kb({...scout,source_id:3},'de',false).inline_keyboard.length,2);
});
