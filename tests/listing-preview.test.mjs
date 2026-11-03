import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import * as facts from '../supabase/functions/notification-dispatcher/source-facts.ts';
import {previewOperations,deliverPreview,sourcePhoto} from '../supabase/functions/notification-dispatcher/preview-delivery.ts';
import {TelegramFailure} from '../supabase/functions/notification-dispatcher/telegram-request.ts';
import {label} from '../supabase/functions/notification-dispatcher/labels.ts';
const base='https://example.test/expose/42';
const source=readFileSync(new URL('../supabase/functions/notification-dispatcher/index.ts',import.meta.url),'utf8');
const scope={...facts,label,URL,Date,console,PREMIUM_LINK:'https://buy.stripe.com/test'};
vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('function esc('),source.indexOf('async function enrich('))),scope);
const listing=(raw={},rest={})=>({id:'l',title:'Wohnung',canonical_url:base,raw,...rest});
test('binary image signatures accept real octet-stream photos, not HTML or spoofed MIME',async()=>{
 const photo=await sourcePhoto(new Response(new Uint8Array([255,216,255,224,0,16]),{headers:{'content-type':'application/octet-stream'}}));
 assert.equal(photo.type,'image/jpeg');
 await assert.rejects(sourcePhoto(new Response('<html>denied</html>',{headers:{'content-type':'image/jpeg'}})));
 await assert.rejects(sourcePhoto(new Response('missing',{status:404})));
});

test('source borough and neighborhood are independent, escaped, and never inferred from prose',()=>{
 const c=scope.cap(listing({address:{borough:'Hamburg-Nord',quarter:'Barmbek <Nord>'}}),'de');
 assert.match(c,/Bezirk:<\/b> Hamburg-Nord/);assert.match(c,/Stadtteil:<\/b> Barmbek &lt;Nord&gt;/);
 assert.doesNotMatch(scope.cap(listing({description:'Bezirk Altona, Stadtteil Ottensen'}),'de'),/Bezirk:|Stadtteil:/);
 const f=facts.htmlFacts('<dl><dt>Bezirk</dt><dd>Altona</dd><dt>Stadtteil</dt><dd>Ottensen</dd></dl>',base);
 assert.equal(f.borough,'Altona');assert.equal(f.district,'Ottensen');
 assert.doesNotMatch(scope.cap(listing({borough:'Altona'}),'de'),/Stadtteil:/);
});
test('confirmed broken source image cannot block the text and offer buttons',async()=>{
 for(const caption of ['facts','facts '.repeat(250)]){
  const calls=[],keyboard={inline_keyboard:[[{text:'Angebot',url:base}]]};
  await deliverPreview(previewOperations(['broken.jpg','second.jpg'],caption,keyboard),null,async()=>{},async(op,upload)=>{
   calls.push({method:op.method,upload,body:op.body});
   if(op.method==='sendPhoto')throw new TelegramFailure(upload?'Source image returned non-image content':'wrong file',false,true);
   return{message_id:42};
  },async()=>{});
  assert.equal(calls.filter(x=>x.method==='sendMessage').length,1);
  assert.equal(calls.at(-1).body.text,caption);assert.deepEqual(calls.at(-1).body.reply_markup,keyboard);
 }
});
test('ambiguous upload outcome never degrades to another Telegram message',async()=>{
 const calls=[];
 await assert.rejects(deliverPreview(previewOperations(['a.jpg'],'facts',{}),null,async()=>{},async(op,upload)=>{
  calls.push(op.method);throw new TelegramFailure('failure',!!upload,!upload);
 },async()=>{}));assert.deepEqual(calls,['sendPhoto','sendPhoto']);
});

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
test('listing previews use one photo and retain full text with buttons',()=>{
 const ops=previewOperations(Array.from({length:23},(_,i)=>`https://example.test/${i}.jpg`),'x'.repeat(1200),{inline_keyboard:[]});
 assert.equal(ops.length,2);assert.equal(ops[0].method,'sendPhoto');assert.equal(ops[0].body.photo,'https://example.test/0.jpg');assert.equal(ops[1].body.text.length,1200);assert.ok(ops[1].body.reply_markup);
});
test('confirmed album failure retries from confirmed checkpoint, not first image',async()=>{
 const ops=[{method:'sendMediaGroup',body:{media:[{type:'photo',media:'a.jpg'},{type:'photo',media:'b.jpg'}]}},{method:'sendPhoto',body:{photo:'c.jpg'}},{method:'sendMessage',body:{text:'facts'}}];let saved,calls=[];
 const save=async s=>{saved=structuredClone(s)};
 await assert.rejects(deliverPreview(ops,null,save,async op=>{calls.push(op.method);if(calls.length===2)throw new TelegramFailure('rate limited',false,false,30);return [{message_id:12}];},async()=>{}));
 assert.equal(saved.next,1);assert.equal(saved.in_flight,false);
 calls=[];await deliverPreview([],saved,save,async op=>{calls.push(op.method);return {message_id:14}},async()=>{});
 assert.deepEqual(calls,['sendMessage']);assert.equal(saved.next,2);
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
 assert.equal(scope.kb(l,'de',true).inline_keyboard[0][0].text,'💎 Premium-Angebot');
 assert.equal(scope.kb({...l,canonical_url:direct},'de',true).inline_keyboard[0][0].url,direct);
 assert.equal(scope.kb({...l,raw:{applicationLink:direct}},'de',true).inline_keyboard[0][0].url,direct);
 assert.equal(scope.kb(l,'de',false).inline_keyboard[0][0].text,'🔒 💎 Premium-Angebot');
 assert.match(scope.kb(l,'de',false,'user').inline_keyboard[0][0].url,/buy\.stripe\.com/);
 assert.equal(scope.kb({...l,sources:{source_type:'Portal'}},'de',true).inline_keyboard[0][0].url,base);
 for(const bad of ['https://tenant.immomio.com.evil.test/de/auth/register/propertyLocation?token=x','http://tenant.immomio.com/de/auth/register/propertyLocation?token=x','https://tenant.immomio.com/de/auth/register/propertyLocation']) {
  sources.source_connectors[0].config.tenant_registration_url=bad;
  assert.equal(scope.kb(l,'de',true).inline_keyboard[0][0].url,base);
 }
});

test('homepage and listing URLs cannot displace a real listing image',()=>{
 const images=facts.collectImages({images:['https://example.test/',base,'https://example.test/photo.jpg']},base);
 assert.deepEqual(images,['https://example.test/photo.jpg']);
 assert.equal(previewOperations(images,'caption',{} )[0].body.photo,'https://example.test/photo.jpg');
});

test('cached detail images are validated before choosing a Telegram photo',()=>{
 const l=listing({}, {enrichment_evidence:{preview:{canonical_url:base,facts:{images:['https://example.test/','https://example.test/photo.jpg']}}}});
 assert.deepEqual(Array.from(scope.knownFacts(l).images),['https://example.test/photo.jpg']);
});

test('Scout gallery, exact address, deposit, publication and extra fields survive detail extraction',()=>{
 const url='https://www.immobilienscout24.de/expose/42';
 const f=facts.htmlFacts('<script>var config={galleryData: {"images":[{"fullSizePictureUrl":"https://pictures.immobilienscout24.de/listings/a.jpg/ORIG/large"},{"fullSizePictureUrl":"https://pictures.immobilienscout24.de/listings/b.jpg/ORIG/large"}]}};</script><div class="is24qa-kaution-o-genossenschaftsanteile">3.000 €</div><dl><dt>Baujahr</dt><dd>1999</dd></dl>',url);
 assert.equal(f.deposit,3000);assert.equal(f.images.length,2);assert.equal(f.extra_facts.Baujahr,'1999');
 scope.walk({'@type':'RealEstateListing',url,address:{streetAddress:'Str. 17 a',postalCode:'20095',addressLocality:'Hamburg'},datePosted:'27-08-2026',offers:{availability:'https://schema.org/InStock'}},f,url);
 assert.equal(f.address,'Str. 17 a, 20095 Hamburg');assert.equal(f.published_text,'27-08-2026');
 assert.equal(facts.collectImages({images:[...f.images,'https://pictures.immobilienscout24.de/listings/a.jpg/ORIG/thumb']},url).length,2);
});
test('unstarted legacy galleries adopt the single-photo policy on retry',async()=>{const ops=previewOperations(['a.jpg','b.jpg'],'facts',{});let saved,calls=[];await deliverPreview(ops,{version:1,operations:[{method:'sendMediaGroup',body:{media:[]}}],next:0,in_flight:false},async s=>saved=structuredClone(s),async op=>{calls.push(op.method);return{message_id:1}},async()=>{});assert.deepEqual(calls,['sendPhoto']);assert.equal(saved.next,1);});

test('preview actions are stacked source-aware and keep requested emojis',()=>{
 const l=listing({address:'Musterstraße 1, 20095 Hamburg'}, {sources:{name:'Immowelt Hamburg',button_label:'Immowelt.de',source_type:'Portal',source_connectors:[]}});
 const rows=scope.kb(l,'de',true).inline_keyboard;
 assert.equal(rows.length,3);
 assert.deepEqual(Array.from(rows, row=>row.length),[1,1,1]);
 assert.equal(rows[0][0].text,'Zu Immowelt');
 assert.equal(rows[1][0].text,'⭐ Speichern');
 assert.equal(rows[2][0].text,'🗺️ Google Map');
 assert.equal(rows.flat().some(button=>/Auto-Bewerbung|Auto-apply|Schnellbewerbung/i.test(button.text||'')),false);
});

test('preview source label strips common domains but preserves cooperative names',()=>{
 for(const [button_label,expected] of [['ImmoScout24.de','Zu ImmoScout24'],['Wunderflats.com','Zu Wunderflats'],['SAGA','Zu SAGA']]){
   const rows=scope.kb(listing({}, {sources:{button_label,source_type:'Portal',source_connectors:[]}}),'de',true).inline_keyboard;
   assert.equal(rows[0][0].text,expected);
 }
});

test('cooperative previews keep the offer emoji and show the actual source name',()=>{
 const premium=scope.kb(listing({address:'Musterstraße 1, 20095 Hamburg'},{sources:{name:'SAGA',button_label:'SAGA',source_type:'Baugenossenschaft',source_connectors:[]}}),'de',true).inline_keyboard;
 const free=scope.kb(listing({address:'Musterstraße 1, 20095 Hamburg'},{sources:{name:'SAGA',button_label:'SAGA',source_type:'Baugenossenschaft',source_connectors:[]}}),'de',false).inline_keyboard;
 assert.equal(premium[0][0].text,'💎 Premium-Angebot');
 assert.equal(free[0][0].text,'🔒 💎 Premium-Angebot');
 assert.match(free[0][0].url,/buy\.stripe\.com/);
});


test('preview normalizer drops every legacy extra and leaves the four requested rows',()=>{
 const legacy={inline_keyboard:[
  [{text:'Zu Immowelt',url:base}],
  [{text:'⭐ Speichern',callback_data:'save:l'}],
  [{text:'🗺️ Google Map',url:'https://www.google.com/maps/search/?api=1&query=Hamburg'}],
  [{text:'Schnellbewerbung',callback_data:'apply:l'}],
  [{text:'Legacy',callback_data:'legacy'}]
 ]};
 const rows=previewOperations([], '📍 <b>Adresse:</b> Hamburg', legacy)[0].body.reply_markup.inline_keyboard;
 assert.equal(rows.length,3);
 assert.equal(rows[0][0].text,'Zu Immowelt');
 assert.equal(rows[1][0].text,'⭐ Speichern');
 assert.equal(rows[2][0].text,'🗺️ Google Map');
 assert.equal(rows.flat().some(button=>/Auto-Bewerbung|Auto-apply|Schnellbewerbung/i.test(String(button.text||''))),false);
 assert.equal(rows.flat().some(button=>String(button.callback_data||'').startsWith('apply:')||String(button.callback_data||'')==='platforms'),false);
});


test('tenant Immomio portal links replace only the offer target and label',()=>{
 const tenant='https://tenant.immomio.com/apply/12345678-1234-1234-1234-123456789012';
 for(const [source_id,button_label] of [[1,'ImmoScout24.de'],[3,'Immowelt.de']]){
  const l=listing({applicationLink:tenant,portal_application_target_checked:true},{source_id,sources:{button_label,source_type:'Portal',source_connectors:[]}});
  const button=scope.kb(l,'de',true).inline_keyboard[0][0];
  assert.equal(button.url,tenant);
  assert.equal(button.text,'Zu Immomio');
 }
});

test('portal listings without a tenant link retain the original portal fallback',()=>{
 for(const [source_id,button_label] of [[1,'ImmoScout24.de'],[3,'Immowelt.de']]){
  const l=listing({portal_application_target_checked:true},{source_id,sources:{button_label,source_type:'Portal',source_connectors:[]}});
  const button=scope.kb(l,'de',true).inline_keyboard[0][0];
  assert.equal(button.url,base);
  assert.equal(button.text,source_id===1?'Zu ImmoScout24':'Zu Immowelt');
 }
});

test('checked portal listings do not inherit a tenant link from another SAGA portal',()=>{
 const tenant='https://tenant.immomio.com/apply/12345678-1234-1234-1234-123456789012';
 const l=listing(
  {portal_application_target_checked:true},
  {source_id:1,sources:{button_label:'ImmoScout24.de',source_type:'Portal',source_connectors:[]},enrichment_evidence:{saga_shared:{verified:true,application_url:tenant}}}
 );
 assert.equal(scope.knownFacts(l).applicationLink,undefined);
 const button=scope.kb(l,'de',true).inline_keyboard[0][0];
 assert.equal(button.url,base);
 assert.equal(button.text,'Zu ImmoScout24');
});

test('portal detail extraction detects escaped and percent-encoded tenant links',()=>{
 const uuid='12345678-1234-1234-1234-123456789012';
 const escaped=facts.htmlFacts('<script>var x="https\\u003A\\u002F\\u002Ftenant.immomio.com\\u002Fapply\\u002F'+uuid+'"</script>',base);
 assert.equal(escaped.applicationLink,'https://tenant.immomio.com/apply/'+uuid);
 const encoded=facts.htmlFacts('<div data-url="https%3A%2F%2Ftenant.immomio.com%2Fapply%2F'+uuid+'"></div>',base);
 assert.equal(encoded.applicationLink,'https://tenant.immomio.com/apply/'+uuid);
});
