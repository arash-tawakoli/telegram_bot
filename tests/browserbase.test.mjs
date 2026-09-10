import test from 'node:test';
import assert from 'node:assert/strict';
import {browserbase,browserUrl} from '../supabase/functions/application-worker/browserbase.js';
const id='00000000-0000-4000-8000-000000000001';
test('context deletion sends no JSON content type for an empty body',async()=>{
 let sent;const api=browserbase(async()=>id,async(url,options)=>{sent=options;return new Response(null,{status:204});});
 assert.equal(await api.remove(id),null);assert.equal(sent.method,'DELETE');assert.equal(sent.headers['Content-Type'],undefined);assert.equal(sent.body,undefined);
});
test('repeated disconnect recovers only from confirmed terminal sessions or absent contexts',async()=>{
 for(const status of ['COMPLETED','TIMED_OUT','ERROR','RUNNING']){
  const api=browserbase(async()=>id,async(url,options)=>options.method==='POST'?new Response('',{status:400}):Response.json({status}));
  if(status==='RUNNING')await assert.rejects(api.stop(id));else assert.equal(await api.stop(id),null);
 }
 const api=browserbase(async()=>id,async()=>new Response('',{status:404}));assert.equal(await api.remove(id),null);await assert.rejects(api.project());
});
test('browser sessions reuse only the supplied context and disable recordings and CAPTCHA solving',async()=>{
 const calls=[];const api=browserbase(async name=>name==='browserbase_project_id'?id:'TEST_KEY',async(url,options)=>{calls.push({url,options});return Response.json({id});});
 await api.start(id);const sent=JSON.parse(calls[0].options.body);
 assert.equal(sent.projectId,id);assert.equal(sent.browserSettings.context.id,id);assert.equal(sent.browserSettings.context.persist,true);
 for(const key of ['recordSession','logSession','solveCaptchas','advancedStealth','ignoreCertificateErrors'])assert.equal(sent.browserSettings[key],false);
 assert.equal(sent.keepAlive,undefined);assert.equal(sent.timeout,120);assert.equal(calls[0].options.redirect,'error');
 await assert.rejects(api.start('../other'));assert.equal(calls.length,1);
});
test('provider failures never include the secret, response body or credential-bearing URL',async()=>{
 for(const [status,message] of [[429,'browser_capacity_exceeded'],[503,'browser_temporary_error'],[401,'browser_auth_rejected'],[403,'browser_access_rejected']]){
  const api=browserbase(async()=>id,async()=>new Response('PRIVATE PROVIDER DATA',{status}));
  await assert.rejects(api.project(),{message});
 }
 const api=browserbase(async()=>id,async()=>{throw Error('URL WITH SECRET')});await assert.rejects(api.project(),{message:'browser_network_error'});
});
test('live and CDP URLs are restricted to Browserbase HTTPS/WSS origins',()=>{
 assert.equal(browserUrl('https://www.browserbase.com/session/abc'),'https://www.browserbase.com/session/abc');
 assert.ok(browserUrl('wss://connect.eu-central-1.browserbase.com?sessionId=abc',true));
 for(const url of ['https://browserbase.com.evil.test','https://evil.test','http://www.browserbase.com','https://name:secret@browserbase.com','https://browserbase.com:444'])assert.throws(()=>browserUrl(url));
});
