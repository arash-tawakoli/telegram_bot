import * as previewFacts from '../supabase/functions/notification-dispatcher/source-facts.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const source=readFileSync(new URL('../supabase/functions/source-worker/nestpick.ts',import.meta.url),'utf8').replace(/import[^;]+;/,'').replaceAll('export ','');
const load=extra=>vm.runInNewContext(stripTypeScriptTypes(source)+';({parseNestpickPage,collectNestpick,runNestpick})',{URL,crypto:webcrypto,...extra});
const row=(id,more={})=>({id,city:{code:'hamburg'},category:'apartment',name:'Example apartment',property_details_url:`/pick/${id}/`,price:{price:1000,currency:'EUR'},number_of_bedrooms:1,apartment_size:'0',history:[{new:true}],...more});
const page=(n,ids,total=3)=>JSON.stringify({items:ids.map(id=>row(id)),pages:{page:n,total_pages:Math.ceil(total/2),total_items:total,limit:2},sponsored:{top:[row(999)]}});
test('Nestpick reads every page and excludes sponsored placements',async()=>{
 const seen=[],r=await load().collectNestpick(async n=>{seen.push(n);return n===1?page(n,[1,2]):page(n,[3]);});
 assert.deepEqual(seen,[1,2]);assert.equal(r.enumerated,3);assert.equal(r.complete,true);
});
test('Nestpick duplicate pages are partial and malformed or moving snapshots fail',async()=>{
 const r=await load().collectNestpick(async n=>n===1?page(n,[1,2]):page(n,[2]));
 assert.equal(r.enumerated,2);assert.equal(r.complete,false);
 assert.throws(()=>load().parseNestpickPage(page(1,[1]),1),/truncated/);
 const moving=await load().collectNestpick(async n=>n===1?page(n,[1,2]):page(n,[3,4],4));
 assert.equal(moving.complete,false);assert.match(moving.errors[0].error,/changed/);
 const timed=await load().collectNestpick(async n=>{if(n===2)throw Error('timeout');return page(n,[1,2]);});
 assert.equal(timed.complete,false);assert.match(timed.errors[0].error,/timeout/);
});
test('Nestpick never converts advertised prices or bedrooms into verified rent or rooms',()=>{
 const r=load().parseNestpickPage(page(1,[1],1),1).candidates[0];
 assert.equal(r.raw.advertised_monthly_price,1000);assert.equal(r.raw.price_components_verified,false);
 assert.equal(r.warm,undefined);assert.equal(r.cold,undefined);assert.equal(r.rooms,undefined);assert.equal(r.area,null);assert.equal(r.type,'Wohnung');
 const text=JSON.stringify({items:[row(1,{category:'room',price:{price:500,currency:'USD'}})],pages:{page:1,total_pages:1,total_items:1,limit:2}});
 const room=load().parseNestpickPage(text,1).candidates[0];assert.equal(room.type,'WG');assert.equal(room.raw.advertised_monthly_price,null);
});
test('Nestpick only requests fresh delivery after warming the exact route',async()=>{
 for(const warmed of [false,true]){
  const writes=[];const db={from(){const q={select(){return q},eq(){return q},maybeSingle(){return q},upsert(){return q},throwOnError:async()=>({data:{cursor:warmed?{adapter:'source-worker/nestpick-public',url:'https://www.nestpick.com/search/api/?city=hamburg&location=101748841&currency=EUR&order=relevance'}:{}}})};return q}};
  const r=await load({db,iso:()=>new Date().toISOString(),fetchText:async()=>({text:page(1,[1],1)}),upsertCandidates:async(_,rows,fresh)=>{if(rows.length)writes.push(fresh);return {fresh:rows.length}},markSuccess:async()=>{},markFailure:async(_,__,e)=>{throw e}}).runNestpick({id:19,baseline_completed_at:'2026-09-01'},{config:{}});
  assert.equal(r.ok,true);assert.deepEqual(writes,[warmed]);
 }
});
test('Telegram labels unverified Nestpick prices and ignores invalid raw values',()=>{
 const index=readFileSync(new URL('../supabase/functions/notification-dispatcher/index.ts',import.meta.url),'utf8');
 const labels=readFileSync(new URL('../supabase/functions/notification-dispatcher/labels.ts',import.meta.url),'utf8').replaceAll('export ','');
 const cap=vm.runInNewContext(stripTypeScriptTypes(labels+'\n'+index.slice(index.indexOf('function esc('),index.indexOf('function kb(')))+';cap', {...previewFacts});
 const l={title:'Example',raw:{provider:'nestpick_public_api',price_currency:'EUR',advertised_monthly_price:1000}};
 assert.match(cap(l,'de'),/Nebenkosten ungeklärt/);assert.doesNotMatch(cap(l,'de'),/Warmmiete/);
 assert.doesNotMatch(cap({...l,warm_rent:1200},'de'),/ungeklärt/);
 assert.doesNotMatch(cap({...l,raw:{...l.raw,advertised_monthly_price:'<bad>'}},'de'),/bad|Angebotspreis/);
});
test('database freshness requires the native Nestpick lane, baseline and explicit request',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create schema app_private; create table sources(id bigint,enabled boolean,runtime_mode text,delivery_mode text,baseline_completed_at timestamptz,last_success_at timestamptz,coverage_strategy text,coverage_status text); create table source_connectors(source_id bigint,enabled boolean,shadow_only boolean,priority int,enumerable boolean,config jsonb); insert into sources values(19,true,'live','live',now(),now(),'generic','partial'); insert into source_connectors values(19,true,false,1,false,'{"adapter":"source-worker/nestpick-public"}');`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260905230750_nestpick_native_freshness.sql',import.meta.url),'utf8'));
  const fresh=async(raw,request=true)=>(await db.query('select app_private.current_listing_is_delivery_fresh(19,$1::jsonb,$2) ok',[JSON.stringify(raw),request])).rows[0].ok;
  const raw={provider:'nestpick_public_api',native_new:true};
  assert.equal(await fresh(raw),true);assert.equal(await fresh(raw,false),false);assert.equal(await fresh({...raw,native_new:false}),false);assert.equal(await fresh({...raw,provider:'html'}),false);
  await db.exec('update sources set baseline_completed_at=null');assert.equal(await fresh(raw),false);
 }finally{await db.close();}
});

