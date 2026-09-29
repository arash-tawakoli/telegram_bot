import test from 'node:test';
import assert from 'node:assert/strict';
import {likelyFastAction,renderFast} from '../supabase/functions/telegram-gateway/fast-ui.ts';
import {readFileSync} from 'node:fs';

const update={callback_query:{message:{chat:{id:1},message_id:2}}};
const base={fast:true,claim:1,user:{id:'u',ui_language:'de'},is_premium:false,state:{property_types:['Haus'],location_mode:'all_hamburg',max_warm_rent:2000,min_rooms:2,min_area_sqm:50},data:{}};

test('stable navigation stays fast while onboarding uses the canonical Telegram UI',()=>{
 for(const a of ['home','settings','profile','status','referral','saved','premium','new','draft','cancel','types','location','boroughs','neighborhoods','rent','rent:custom','loc:all','rent:2000','rooms:2','area:50','profile:save','platforms','profile:view:1','profile:pause:1']){
  assert.equal(likelyFastAction(a),true,a);
 }
 for(const a of ['platforms:login:3','platforms:profile-set:move_in_preference:EXACT_DATE','apply:123','admin:list','lang:en','portal']){
  assert.equal(likelyFastAction(a),false,a);
 }
});

test('house toggle renders compact 2x2 property grid',()=>{
 const r=renderFast({...base,view:'types'},{callback_query:{data:'type:Haus',message:{chat:{id:1},message_id:2}}});
 assert.equal(r.method,'editMessageText');
 assert.equal(r.reply_markup.inline_keyboard[0][1].text,'✅ 🏡 Haus');
 assert.equal(r.reply_markup.inline_keyboard[1][0].callback_data,'type:WG');
});

test('main menu stays text-only to avoid photo/delete roundtrips',()=>{
 const r=renderFast({...base,view:'premium'},update);
 assert.equal(r.method,'editMessageText');
 assert.match(r.text,/Premium/);
 const home=renderFast({...base,view:'home'},update);
 assert.equal(home.method,'editMessageText');
});

test('review preserves house filters and activation action',()=>{
 const r=renderFast({...base,view:'review',data:{boroughs:[],neighborhoods:[]}},update);
 assert.match(r.text,/Haus/);
 assert.match(r.text,/2\+/);
 assert.match(r.text,/50 m²/);
 assert.equal(r.reply_markup.inline_keyboard[0][0].callback_data,'profile:save');
});

test('referral uses one editable message with share URL',()=>{
 const r=renderFast({...base,view:'referral',data:{code:'ABC123'}},update);
 assert.equal(r.method,'editMessageText');
 assert.equal(r.reply_markup.inline_keyboard[0][0].text,'📤 Link teilen');
 assert.match(r.reply_markup.inline_keyboard[0][0].url,/t\.me\/share\/url/);
});

test('saved listings use URL buttons without extra messages',()=>{
 const r=renderFast({...base,view:'saved',is_premium:true,data:{total:1,page:0,pages:1,items:[{title:'Test',canonical_url:'https://example.com/x'}]}},update);
 assert.equal(r.method,'editMessageText');
 assert.equal(r.reply_markup.inline_keyboard[0][0].url,'https://example.com/x');
});

test('profile list preserves an in-progress onboarding draft',()=>{
 const r=renderFast({...base,view:'profile_list',user:{id:'u',ui_language:'de',onboarding_step:'rent',onboarding_state:{profile_slot:1}},data:{profiles:[],profile_limit:1}},update);
 const callbacks=r.reply_markup.inline_keyboard.flat().map(x=>x.callback_data).filter(Boolean);
 assert.ok(callbacks.includes('draft'));
});

test('borough selection uses markup-only updates',()=>{
 const r=renderFast({...base,view:'boroughs',state:{borough_ids:[1]},data:{boroughs:[{id:1,name:'Hamburg-Mitte'},{id:2,name:'Altona'}]}},{callback_query:{data:'borough:1',message:{chat:{id:1},message_id:2}}});
 assert.equal(r.method,'editMessageReplyMarkup');
 assert.match(r.reply_markup.inline_keyboard[0][0].text,/✅/);
});

test('legacy locale-tagged buttons are normalized before current UI rendering',()=>{
 const gateway=readFileSync(new URL('../supabase/functions/telegram-gateway/index.ts',import.meta.url),'utf8');
 assert.match(gateway,/callback==='home:de'\?'home'/);
 assert.match(gateway,/callback==='settings:de'\?'settings'/);
 assert.match(gateway,/callback==='help:de'\?'help'/);
 assert.doesNotMatch(gateway,/renderStaticFast/);
});

test('auto-apply UI is served by the canonical platform-sessions handler',()=>{
 const gateway=readFileSync(new URL('../supabase/functions/telegram-gateway/index.ts',import.meta.url),'utf8');
 assert.doesNotMatch(gateway,/handleAutoApplyCallback|handleAutoApplyMessage|isAutoApplyCallback|isAutoApplyMessage/);
 const core=readFileSync(new URL('../supabase/functions/telegram-ui/handlers.js',import.meta.url),'utf8');
 assert.match(core,/platformSessions\(user,query\.message\.chat/);
});
