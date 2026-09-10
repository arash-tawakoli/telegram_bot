import test from 'node:test';
import assert from 'node:assert/strict';
import {submissionPlan,documentUploadPlan,adapters} from '../supabase/functions/application-worker/adapters.js';
test('application preparation does not invent identity, consent or attachment support',()=>{
 assert.equal(submissionPlan(1,{},[{name:'firstName',value:''}],[]).error,'required_fields_missing');
 assert.equal(submissionPlan(2,{},[{name:'consent',required:true,type:'checkbox',value:'on',checked:false}],[]).error,'platform_consent_required');
 assert.equal(submissionPlan(2,{},[],[{id:'approved-document'}]).error,'attachments_unsupported');
 assert.equal(submissionPlan(1,{street:'Musterstraße'},[{name:'street',value:''}],[]).values.street,'Musterstraße');
});
test('attachments require an explicit compatible form upload control and bounded payload',()=>{
 const pdf={mime_type:'application/pdf',bytes:500},jpg={mime_type:'image/jpeg',bytes:400};
 assert.equal(documentUploadPlan([pdf],{accept:'.pdf',multiple:false}).ok,true);
 assert.equal(documentUploadPlan([pdf,jpg],{accept:'application/pdf,image/*',multiple:true}).ok,true);
 for(const input of [null,{accept:''},{accept:'image/*'},{accept:'.pdf',disabled:true}])assert.ok(documentUploadPlan([pdf],input).error);
 assert.ok(documentUploadPlan([pdf,jpg],{accept:'.pdf,.jpg',multiple:false}).error);
 assert.equal(documentUploadPlan(Array(3).fill({...pdf,bytes:5*1024*1024}),{accept:'.pdf',multiple:true}).error,'attachments_too_large');
});
test('both adapters stop before disclosure for expired sessions, removed listings and challenges',async()=>{
 for(const source of [1,2])for(const scenario of ['session','removed','challenge']){
  let authorized=false,reads=0;
  const page={goto:async()=>{},evaluate:async()=>++reads===1?(scenario==='removed'?'Angebot wurde deaktiviert':scenario==='challenge'?'Sicherheitsüberprüfung':'Wohnung'):false};
  const listing={source_id:source,canonical_url:source===1?'https://www.immobilienscout24.de/expose/123':'https://www.kleinanzeigen.de/s-anzeige/wohnung/123-203-10'};
  const result=await adapters[source].applyToListing({page,listing,authorize:async()=>{authorized=true;return true;}});
  assert.equal(authorized,false);assert.equal(result.success,false);
  assert.equal(result.error,{session:'session_expired',removed:'listing_removed',challenge:'platform_verification'}[scenario]);
 }
});
