import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import puppeteer from 'npm:puppeteer-core@24.31.0';
import {browserbase,browserUrl,identifier,platformSources} from './browserbase.js';
import {adapters,authenticationState} from './adapters.js';
import {generateApplicationMessage} from '../telegram-ui/application-message.js';
import {detectDocument,FILE_LIMIT} from '../telegram-ui/dossier-rules.js';
import {Buffer} from 'node:buffer';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data);}
const provider=browserbase(secret);
const connect=async url=>puppeteer.connect({browserWSEndpoint:browserUrl(url,true),protocolTimeout:15000,defaultViewport:null});
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required');}
async function sessionPatch(row,patch){const {data,error}=await db.from('platform_sessions').update({...patch,updated_at:new Date().toISOString()}).eq('user_id',row.user_id).eq('source_id',row.source_id).eq('lease_token',row.lease_token).select('user_id');if(error||!data?.length)throw Error('session_lease_lost');}
async function currentSession(userId:string,source:number){
 const {data,error}=await db.from('platform_sessions').select('*').eq('user_id',userId).eq('source_id',source).maybeSingle();
 if(error)throw Error('session_read_failed');return data;
}
const busySession=row=>({status:'busy',retryAfter:Math.max(1,Math.ceil((Date.parse(row?.lease_until||'')-Date.now())/1000)||10)});
async function runningLogin(row){
 if(row?.status!=='login'||!row.session_id||Date.parse(row.lease_until)<=Date.now())return null;
 const session=await provider.session(row.session_id);
 if(session.status==='RUNNING')return {status:'login',url:await provider.live(row.session_id),reused:true,expiresIn:Math.max(1,Math.floor((Date.parse(session.expiresAt)-Date.now())/1000)||100)};
 if(['COMPLETED','TIMED_OUT','ERROR'].includes(session.status)){
  await sessionPatch(row,{status:'saved',session_id:null,lease_until:new Date(Date.now()+10000).toISOString()});
  return {status:'busy',retryAfter:10};
 }
 return busySession(row);
}
async function login(userId:string,source:number){
 await eligible(userId);
 const existing=await currentSession(userId,source),running=await runningLogin(existing);
 if(running)return running;
 const {data,error}=await db.rpc('claim_platform_session',{p_user:userId,p_source:source});
 if(error)throw Error('session_claim_failed');
 if(!data?.length)return busySession(await currentSession(userId,source));
 const row=data[0];let browser;
 try {
  if(!row.context_id){const context=await provider.context(`applicant-${userId}-${source}`);row.context_id=identifier(context.id);await sessionPatch(row,{context_id:row.context_id});}
  const session=await provider.start(row.context_id);row.session_id=identifier(session.id);
  await sessionPatch(row,{session_id:row.session_id,status:'login'});
  browser=await connect(session.connectUrl);
  const pages=await browser.pages();const page=pages[0]||await browser.newPage();
  const liveUrl=await provider.live(row.session_id);
  // The Free plan closes a session on CDP disconnect. Hold the connection
  // for this bounded login window, within the Edge runtime lifetime.
  const connection=browser;browser=null;
  EdgeRuntime.waitUntil((async()=>{
   try {await Promise.all([
    page.goto(platformSources[source].login,{waitUntil:'domcontentloaded',timeout:25000}).catch(()=>{}),
    new Promise(resolve=>{const timer=setTimeout(resolve,100000);connection.once('disconnected',()=>{clearTimeout(timer);resolve(null);});})
   ]);}
   finally {await provider.stop(row.session_id).catch(()=>{});connection.disconnect();await sessionPatch(row,{status:'saved',session_id:null,lease_until:new Date(Date.now()+10000).toISOString()}).catch(()=>{});}
  })());
  return {status:'login',url:liveUrl,expiresIn:100};
 }catch(error){
  if(row.session_id)await provider.stop(row.session_id).catch(()=>{});
  browser?.disconnect();await sessionPatch(row,{status:'needs_login',session_id:null,lease_until:new Date(Date.now()+10000).toISOString()}).catch(()=>{});
  throw Error('login_unavailable');
 }
}
async function disconnect(userId:string,source:number){
 const existing=await currentSession(userId,source);let row;
 if(existing?.status==='login'&&existing.session_id&&Date.parse(existing.lease_until)>Date.now()){
  // Fence the login task before stopping its browser. Its later cleanup can no
  // longer overwrite this disconnect operation or a newly created connection.
  const {data,error}=await db.from('platform_sessions').update({status:'disconnecting',lease_token:crypto.randomUUID(),lease_until:new Date(Date.now()+180000).toISOString()})
   .eq('user_id',userId).eq('source_id',source).eq('lease_token',existing.lease_token).eq('status','login').select('*');
  if(error)throw Error('session_claim_failed');if(!data?.length)return busySession(existing);row=data[0];
 }else{
  const {data,error}=await db.rpc('claim_platform_session',{p_user:userId,p_source:source,p_disconnect:true});
  if(error)throw Error('session_claim_failed');if(!data?.length)return busySession(existing);row=data[0];
  await sessionPatch(row,{status:'disconnecting'});
 }
 if(row.session_id)await provider.stop(row.session_id);
 if(row.context_id)await provider.remove(row.context_id);
 const {error:removeError}=await db.from('platform_sessions').delete().eq('user_id',userId).eq('source_id',source).eq('lease_token',row.lease_token);
 if(removeError)throw Error('disconnect_failed');return {status:'disconnected'};
}
async function checkConnection(userId:string,source:number){
 await eligible(userId);
 const existing=await currentSession(userId,source),running=await runningLogin(existing);
 if(running)return running;
 if(!existing?.context_id)return {authenticated:false};
 const {data,error}=await db.rpc('claim_platform_session',{p_user:userId,p_source:source});
 if(error)throw Error('session_claim_failed');if(!data?.length)return busySession(existing);
 const row=data[0];let session,browser;
 try{
  if(!row.context_id)return {authenticated:false};
  session=await provider.start(row.context_id);await sessionPatch(row,{session_id:identifier(session.id)});
  browser=await connect(session.connectUrl);const pages=await browser.pages(),page=pages[0]||await browser.newPage();
  await page.goto(platformSources[source].home,{waitUntil:'domcontentloaded',timeout:25000});
  const authenticated=await authenticationState(page);
  if(authenticated===false)await sessionPatch(row,{status:'needs_login'});
  return {authenticated};
 }finally{
  if(session)await provider.stop(session.id).catch(()=>{});browser?.disconnect();
  await sessionPatch(row,{session_id:null,lease_until:new Date(Date.now()+10000).toISOString()}).catch(()=>{});
 }
}
async function processApplication(){
 const {data:claimed,error:claimError}=await db.rpc('claim_application');
 if(claimError)throw Error('application_claim_failed');
 if(!claimed?.length)return {status:'idle'};
 const application=claimed[0];let row,browser,session,started=false;
 const patch=async value=>{
  const {data,error}=await db.from('applications').update(value).eq('id',application.id).eq('lease_token',application.lease_token).select('id');
  if(error||!data?.length)throw Error('application_lease_lost');
 };
 try{
  await eligible(application.user_id);
  const [{data:user,error:userError},{data:listing,error:listingError},{data:documents,error:documentError}]=await Promise.all([
   db.from('bot_users').select('id,is_active,auto_apply_enabled,applicant_profile,first_name,last_name').eq('id',application.user_id).single(),
   db.from('listings').select('id,source_id,canonical_url,title,is_active').eq('id',application.listing_id).single(),
   db.from('application_documents').select('id,mime_type,bytes,filename').eq('user_id',application.user_id).eq('ready',true).eq('share_enabled',true)]);
  if(userError||listingError||documentError)throw Error('application_read_failed');
  if(!user.auto_apply_enabled||!listing.is_active){await patch({status:'failed',last_error:'not_eligible'});return {status:'failed'};}
  const {data:sessionRows,error}=await db.rpc('claim_platform_session',{p_user:user.id,p_source:listing.source_id});
  if(error)throw Error('application_read_failed');
  if(!sessionRows?.length){await patch({next_attempt_at:new Date(Date.now()+180000).toISOString(),lease_until:null});return {status:'pending'};}
  row=sessionRows[0];
  if(row.status!=='saved'||!row.context_id){await patch({status:'manual_required',last_error:'session_expired'});return {status:'manual_required'};}
  session=await provider.start(row.context_id);await sessionPatch(row,{session_id:identifier(session.id)});
  browser=await connect(session.connectUrl);
  const pages=await browser.pages(),page=pages[0]||await browser.newPage();
  const message=generateApplicationMessage({...user,...user.applicant_profile},listing);
  await patch({application_text:message});
  const result=await adapters[Number(listing.source_id)].applyToListing({page,user,listing,message,documents,
   loadDocument:async document=>{
    await eligible(user.id);
    const {data:current,error}=await db.from('application_documents').select('id,mime_type,bytes,filename').eq('id',document.id).eq('user_id',user.id).eq('ready',true).eq('share_enabled',true).maybeSingle();
    if(error||!current||current.bytes!==document.bytes||current.mime_type!==document.mime_type)throw Error('document_permission_changed');
    const {data:file,error:downloadError}=await db.storage.from('application-documents').download(`${user.id}/${document.id}`);
    if(downloadError||!file||file.size>FILE_LIMIT||file.size!==document.bytes)throw Error('document_unavailable');
    const bytes=new Uint8Array(await file.arrayBuffer());if(detectDocument(bytes)!==document.mime_type)throw Error('document_invalid');
    return {filename:current.filename,mime_type:current.mime_type,base64:Buffer.from(bytes).toString('base64')};
   },
   authorize:async()=>{
    // Reload grants before crossing the disclosure boundary; never silently omit
    // a newly approved file or disclose one whose permission was revoked.
    const {data:current,error}=await db.from('application_documents').select('id').eq('user_id',user.id).eq('ready',true).eq('share_enabled',true);
    if(error||current?.length!==documents.length||current.some(d=>!documents.some(old=>old.id===d.id)))return false;
    const {data,error:authorizeError}=await db.rpc('authorize_application_send',{p_id:application.id,p_token:application.lease_token});
    // An RPC timeout could mean the checkpoint committed. Treat it as uncertain.
    if(authorizeError){started=true;throw Error('authorization_unconfirmed');}
    started=data===true;return started;
   }});
  await patch({status:result.status,last_error:result.error||null,...(result.status==='sent'?{sent_at:new Date().toISOString()}:{}),lease_until:null});
  if(result.error==='session_expired')await sessionPatch(row,{status:'needs_login'});
  return {status:result.status};
 }catch(error){
  const retry=!started&&['browser_network_error','browser_temporary_error','browser_capacity_exceeded','TimeoutError'].includes(error.name==='TimeoutError'?error.name:error.message)&&application.attempts<2;
  await patch({status:started?'manual_required':retry?'pending':'failed',last_error:started?'submission_unconfirmed':retry?'temporary_browser_error':'application_preparation_failed',
   ...(!started?{attempts:application.attempts+1}:{}),next_attempt_at:new Date(Date.now()+60000*(application.attempts+1)).toISOString(),lease_until:null});
  return {status:started?'manual_required':retry?'pending':'failed'};
 }finally{
  if(session)await provider.stop(session.id).catch(()=>{});browser?.disconnect();
  if(row)await sessionPatch(row,{session_id:null,lease_until:new Date(Date.now()+10000).toISOString()}).catch(()=>{});
 }
}
async function probe(){
 const project=await provider.project();let context,session,browser,stage='context';
 const result:any={status:'failed',project:project.id};
 try {
  context=await provider.context('integration-probe-'+crypto.randomUUID());
  stage='session';session=await provider.start(context.id);stage='connect';browser=await connect(session.connectUrl);
  const pages=await browser.pages();const page=pages[0]||await browser.newPage();
  await page.goto('about:blank');
  Object.assign(result,{status:'ok',remoteBrowserConnected:true,privateContextCreated:true});
 }catch(error) {Object.assign(result,{error:'probe_'+stage+'_failed',httpStatus:error.status||null});}finally{
  if(session)await provider.stop(session.id).catch(()=>{});browser?.disconnect();
  if(context){result.contextId=context.id;try{await provider.remove(context.id);result.contextDeleted=true;}catch(error){result.contextDeleted=false;result.cleanupHttpStatus=error.status||null;result.status='failed';}}
 }
 return result;
}
Deno.serve(async request=>{
 if(request.method!=='POST')return new Response('method not allowed',{status:405});
 try {
  if(request.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
  const body=await request.json();
  if(body.action==='health'){const project=await provider.project();return Response.json({status:'ok',project:project.id});}
  if(body.action==='probe')return Response.json(await probe());
  if(body.action==='process')return Response.json(await processApplication());
  if(!['login','disconnect','check'].includes(body.action))return Response.json({error:'invalid_action'},{status:400});
  const userId=identifier(body.userId),source=Number(body.source);
  if(!platformSources[source])return Response.json({error:'invalid_platform'},{status:400});
  return Response.json(body.action==='login'?await login(userId,source):body.action==='check'?await checkConnection(userId,source):await disconnect(userId,source));
 }catch(error){
  const safe=new Set(['configuration_unavailable','browser_network_error','browser_capacity_exceeded','browser_temporary_error','browser_request_rejected','browser_auth_rejected','browser_access_rejected','probe_context_failed','probe_session_failed','probe_connect_failed','probe_cleanup_failed','premium_required','session_busy','login_unavailable','disconnect_failed']);
  return Response.json({error:safe.has(error.message)?error.message:'application_operation_failed'},{status:503});
 }
});
