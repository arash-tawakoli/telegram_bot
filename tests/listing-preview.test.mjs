import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import * as facts from '../supabase/functions/notification-dispatcher/source-facts.ts';
import {previewOperations,deliverPreview} from '../supabase/functions/notification-dispatcher/preview-delivery.ts';
import {TelegramFailure} from '../supabase/functions/notification-dispatcher/telegram-request.ts';
import {label} from '../supabase/functions/notification-dispatcher/labels.ts';
const base='https://example.test/expose/42';
const source=readFileSync(new URL('../supabase/functions/notification-dispatcher/index.ts',import.meta.url),'utf8');
const scope={...facts,label,URL,Date,console};
vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('function esc('),source.indexOf('async function enrich('))),scope);
const listing=(raw={},rest={})=>({id:'l',title:'Wohnung',canonical_url:base,raw,...rest});

test('all explicit facts including zero costs and floor, flexible dates and deposit text are rendered',()=>{
 const caption=scope.cap(listing({warmRent:'1.250,50',coldRent:900,heatingCosts:0,additionalCosts:100,deposit:'3 Kaltmieten',rooms:2.5,size:72.1,floor:0,apartmentType:'Maisonette',moveInDate:'nach Vereinbarung',availableFrom:'01.11.2026',address:'Straße 1 a, 20095 Hamburg'}),'de');
 for(const value of ['1250.5','900','Heizkosten:</b> 0 €','Nebenkosten','3 Kaltmieten','2.5','72.1','Etage:</b> 0','Maisonette','Einzugsdatum','nach Vereinbarung','01.11.2026','Straße 1 a'])assert.ok(caption.includes(value),value);
});
test('missing fields and unverified/default addresses and property types stay hidden',()=>{
 const caption=scope.cap(listing({description:'Kontakt Musterstraße 9, Hamburg',floor:'keine Angabe',deposit:'nicht vorhanden'}, {address:'Invented 42',postal_code:'20095',city:'Hamburg',property_type:'Wohnung'}),'de');
 assert.equal(caption,'🏠 <b>Wohnung</b>');assert.equal(scope.loc(listing({description:'Musterstraße 5'},{address:'Musterstraße 5'})),null);
});
test('source spelling overrides stale database values and no city is invented',()=>{
 assert.equal(scope.loc(listing({address:'  Str. 17 a\n22419 Hamburg  '},{address:'Straße 17A'})),'  Str. 17 a\n22419 Hamburg  ');
 assert.equal(facts.exactAddress({street:'Str.',houseNumber:'17 a'}),'Str. 17 a');
 assert.equal(scope.cap(listing({warmRent:1200},{warm_rent:900}),'de').includes('1200'),true);
});
test('calculated rent is hidden unless explicitly present in source',()=>{
 assert.ok(!scope.cap(listing({}, {warm_rent:1200,warm_rent_is_calculated:true}),'de').includes('Warmmiete'));
 assert.ok(scope.cap(listing({warmRent:1200},{warm_rent_is_calculated:true}),'de').includes('1200'));
});
test('HPM retains every photo, correct origin path, source costs and availability',()=>{
 const f=facts.structuredFacts({provider:'immosolve_hpm_rest',detail:{firm:{address:'WRONG'},images:Array.from({length:8},(_,i)=>({filename:`/mandatorRoot/2205841/images/${i}.jpg`})),immoObject:{labels:{strasse:'Ochsenweberstraße',hausnummer:'17 a',plz:'22419',ort:'Hamburg',monatlGesamtkosten:'1.572,00',heizkosten:'67,00',betriebskosten:'245,00',kaution:'3.780,00',etage:'4. Etage',availableStart:'01.11.2026'}}}},'https://hpm2.immosolve.eu/immo.jsp?objectId=1');
 assert.equal(f.images.length,8);assert.equal(f.images[0],'https://hpm2.immosolve.eu/mandatorRoot/2205841/images/0.jpg');assert.equal(f.warm_rent,1572);assert.equal(f.heating_costs,67);assert.equal(f.floor,'4. Etage');assert.equal(f.available_text,'01.11.2026');assert.ok(!f.address.includes('WRONG'));
});
test('HTML fields require labels; description/contact addresses and unrelated images are ignored',()=>{
 const f=facts.htmlFacts('<p>Kontakt Musterstraße 9</p><footer><dl><dt>Adresse</dt><dd>Falsch 1</dd></dl></footer><dl><dt>Warmmiete</dt><dd>1.200,00 €</dd><dt>Objektadresse</dt><dd>Str. 17 a, Hamburg</dd><dt>Etage</dt><dd>EG</dd><dt>Verfügbar ab</dt><dd>sofort</dd></dl><img src="/logo.png"><img class="gallery-image" data-src="/1.jpg"><img class="gallery-image" data-src="/2.jpg">',base);
 assert.equal(f.warm_rent,1200);assert.equal(f.address,'Str. 17 a, Hamburg');assert.equal(f.floor,'EG');assert.equal(f.images.length,2);
});
test('JSON-LD scopes facts to exact listing and ignores publisher and related objects',()=>{
 const out={};scope.walk({'@graph':[{'@type':'Organization',address:'wrong',image:'/logo.jpg'},{'@type':'Apartment',url:base,address:'right',image:['/1.jpg','/2.jpg'],numberOfRooms:3,floorSize:{value:75}},{'@type':'Apartment',url:'https://example.test/expose/43',address:'other',image:'/3.jpg'}]},out,base);
 assert.equal(out.address,'right');assert.equal(out.images.length,2);assert.equal(out.rooms,3);
});
test('listing previews use only the first image and keep full text with buttons',()=>{
 const ops=previewOperations(Array.from({length:23},(_,i)=>`https://example.test/${i}.jpg`),'x'.repeat(1200),{inline_keyboard:[]});
 assert.equal(ops.length,2);assert.equal(ops[0].method,'sendPhoto');assert.equal(ops[0].body.photo,'https://example.test/0.jpg');assert.equal(ops[1].body.text.length,1200);assert.ok(ops[1].body.reply_markup);
});
test('confirmed album failure retries from confirmed checkpoint, not first image',async()=>{
 const ops=previewOperations(Array.from({length:11},(_,i)=>`${i}.jpg`),'facts',{},Infinity);let saved,calls=[];
 const save=async s=>{saved=structuredClone(s)};
 await assert.rejects(deliverPreview(ops,null,save,async op=>{calls.push(op.method);if(calls.length===2)throw new TelegramFailure('rate limited',false,false,30);return [{message_id:12}];},async()=>{}));
 assert.equal(saved.next,1);assert.equal(saved.in_flight,false);
 calls=[];await deliverPreview([],saved,save,async op=>{calls.push(op.method);return {message_id:14}},async()=>{});
 assert.deepEqual(calls,['sendPhoto','sendMessage']);assert.equal(saved.next,3);
});
test('unknown send outcome or checkpoint failure never automatically duplicates images',async()=>{
 let saved;await assert.rejects(deliverPreview([{method:'sendPhoto',body:{photo:'a'}}],null,async s=>{saved=structuredClone(s)},async()=>{throw new TelegramFailure('timeout',true)},async()=>{}));
 assert.equal(saved.in_flight,true);let sent=0;
 await assert.rejects(deliverPreview([],saved,async()=>{},async()=>{sent++},async()=>{}),e=>e.outcomeUnknown===true);assert.equal(sent,0);
 let saves=0;await assert.rejects(deliverPreview([{method:'sendPhoto',body:{photo:'a'}}],null,async()=>{if(++saves===2)throw Error('db')},async()=>({message_id:1}),async()=>{}),e=>e.outcomeUnknown===true);
});
test('confirmed Telegram URL rejection falls back to binary upload without dropping image',async()=>{
 const calls=[];await deliverPreview([{method:'sendPhoto',body:{photo:'a'}}],null,async()=>{},async(op,upload)=>{calls.push(!!upload);if(!upload)throw new TelegramFailure('bad photo',false,true);return {message_id:1}},async()=>{});assert.deepEqual(calls,[false,true]);
});

test('Immomio public details preserve costs, half rooms, gallery and hidden addresses',()=>{
 const f=facts.structuredFacts({property:{data:{showAddress:false,address:{street:'Hidden',houseNumber:'9'},basePrice:285.75,totalRentGross:405.75,serviceCharge:60,heatingCost:60,bailment:1050,rooms:1,halfRooms:1,floor:0,flatType:'RAISED_GROUND_FLOOR',attachments:[{url:'/1.jpg',encrypted:false},{url:'/2.jpg',encrypted:false},{url:'/private.jpg',encrypted:true}]}}},base);
 assert.equal(f.address,null);assert.equal(f.rooms,1.5);assert.equal(f.images.length,2);assert.equal(f.cold_rent,285.75);assert.equal(f.heating_costs,60);assert.equal(f.deposit,1050);assert.equal(f.property_type,'Hochparterre');
 const l=listing({address:'Legacy leaked address'},{enrichment_evidence:{preview:{canonical_url:base,facts:f}}});assert.equal(scope.loc(l),null);
});

test('HPM presentation translation templates cannot override its actual API fields',()=>{
 const l=listing({provider:'immosolve_hpm_rest',detail:{immoObject:{labels:{etage:'4. Etage',availableStart:'01.11.2026',kaution:'3.780,00'}}}},{deposit_text:'Bond Bond type',enrichment_evidence:{preview:{canonical_url:base,facts:{floor:'Floor',available_text:'Availability start',deposit_text:'Bond Bond type'}}}});
 const c=scope.cap(l,'de');assert.match(c,/4. Etage/);assert.match(c,/01.11.2026/);assert.doesNotMatch(c,/Floor|Availability|Bond/);
});

test('tenant destination prefers concrete offers and validates registration fallback without bypassing premium',()=>{
 const direct='https://tenant.immomio.com/de/apply/12345678-1234-1234-1234-123456789012';
 const portal='https://tenant.immomio.com/de/auth/register/propertyLocation?token=public';
 const sources={source_type:'Baugenossenschaft',source_connectors:[{enabled:true,priority:1,config:{tenant_registration_url:portal}}]};
 const l=listing({}, {sources});
 assert.equal(scope.kb(l,'de',true).inline_keyboard[0][0].url,portal);
 assert.equal(scope.kb(l,'de',true).inline_keyboard[0][0].text,'ImmoMio-Registrierung');
 assert.equal(scope.kb({...l,canonical_url:direct},'de',true).inline_keyboard[0][0].url,direct);
 assert.equal(scope.kb({...l,raw:{applicationLink:direct}},'de',true).inline_keyboard[0][0].url,direct);
 assert.equal(scope.kb(l,'de',false).inline_keyboard[0][0].callback_data,'premium');
 assert.equal(scope.kb({...l,sources:{source_type:'Portal'}},'de',true).inline_keyboard[0][0].url,base);
 for(const bad of ['https://tenant.immomio.com.evil.test/de/auth/register/propertyLocation?token=x','http://tenant.immomio.com/de/auth/register/propertyLocation?token=x','https://tenant.immomio.com/de/auth/register/propertyLocation']) {
  sources.source_connectors[0].config.tenant_registration_url=bad;
  assert.equal(scope.kb(l,'de',true).inline_keyboard[0][0].url,base);
 }
});
