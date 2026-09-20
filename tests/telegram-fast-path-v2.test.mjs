import test from 'node:test';
import assert from 'node:assert/strict';
import {likelyFastAction,renderFast} from '../supabase/functions/telegram-gateway/fast-ui.ts';

const update={callback_query:{message:{chat:{id:1},message_id:2}}};
const base={fast:true,claim:1,user:{id:'u',ui_language:'de'},is_premium:false,state:{property_types:['Haus'],location_mode:'all_hamburg',max_warm_rent:2000,min_rooms:2,min_area_sqm:50},data:{}};

test('common navigation and onboarding actions are fast-path eligible',()=>{
 for(const a of ['home','settings','profile','new','type:Haus','type:done','loc:all','rent:2000','rooms:2','area:50','status','referral','saved']){
  assert.equal(likelyFastAction(a),true,a);
 }
 for(const a of ['platforms','platforms:login:3','apply:123','admin:list','lang:en','portal']){
  assert.equal(likelyFastAction(a),false,a);
 }
});

test('house toggle renders compact 2x2 property grid',()=>{
 const r=renderFast({...base,view:'types'},update);
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
