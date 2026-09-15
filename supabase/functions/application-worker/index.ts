import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import puppeteer from 'npm:puppeteer-core@24.31.0';
import {createProfileToken,handleProfilePage} from './profile-page.ts';
import {beginKleinanzeigenLogin,completeKleinanzeigenLogin,checkKleinanzeigenConnection,disconnectKleinanzeigen} from './providers/kleinanzeigen.ts';
import {checkImmoScoutConnection,disconnectImmoScout} from './providers/immoscout.ts';
import {probeImmomioApplication} from './providers/immomio.ts';
import {providerForListing,sendApplication} from './providers/router.ts';
import {markConnection} from './credentials.ts';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const base=Deno.env.get('SUPABASE_URL')!;
async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data);}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required');}
const uuid=(v:any)=>{const s=String(v||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw Error('invalid_user');return s;};
const clean=(v:any,max=4000)=>String(v||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const KLEIN_CALLBACK='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const BB_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bbId=(value:any)=>{const s=String(value||'');if(!BB_ID.test(s))throw Error('invalid_identifier');return s;};
const browserSocket=(value:string)=>{const url=new URL(value);if(url.protocol!=='wss:'||url.username||url.password||url.port||!(url.hostname==='browserbase.com'||url.hostname.endsWith('.browserbase.com')))throw Error('invalid_browser_url');return url.href;};
const browserPage=(value:string)=>{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='browserbase.com'||url.hostname.endsWith('.browserbase.com')))throw Error('invalid_browser_url');url.searchParams.set('navbar','false');return url.href;};

function browserbaseAuth(request:typeof fetch=fetch){
 async function call(path:string,method='GET',body?:unknown){
  const key=await secret('browserbase_api_key');
  let response:Response;
  try{response=await request(`https://api.browserbase.com/v1/${path}`,{method,headers:{'X-BB-API-Key':key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw Error('browser_network_error');}
  if(!response.ok){const code=response.status===429?'browser_capacity_exceeded':response.status>=500?'browser_temporary_error':response.status===401?'browser_auth_rejected':response.status===403?'browser_access_rejected':'browser_request_rejected';throw Object.assign(Error(code),{status:response.status});}
  if(response.status===204)return null;
  return response.json();
 }
 return {
  start:async()=>call('sessions','POST',{projectId:bbId(await secret('browserbase_project_id')),timeout:180,region:'eu-central-1',browserSettings:{viewport:{width:390,height:844},recordSession:false,logSession:false,solveCaptchas:false,advancedStealth:false,ignoreCertificateErrors:false},userMetadata:{purpose:'kleinanzeigen-login'}}),
  live:async(id:string)=>{const data:any=await call(`sessions/${bbId(id)}/debug`);return browserPage(String(data.debuggerFullscreenUrl));},
  stop:async(id:string)=>{try{return await call(`sessions/${bbId(id)}`,'POST',{status:'REQUEST_RELEASE'});}catch(error:any){if(error?.status===400)return null;throw error;}}
 };
}
const authBrowser=browserbaseAuth();

function messageFor(profile:any,listing:any){if(clean(profile.default_message))return clean(profile.default_message,4000);const name=clean([profile.first_name,profile.last_name].filter(Boolean).join(' '),120),title=clean(listing.title,100)||'Ihre Wohnung';return `Guten Tag,\n\nich interessiere mich für „${title}“ und würde die Wohnung gerne besichtigen. Über eine Rückmeldung freue ich mich.\n\nFreundliche Grüße\n${name}`;}
async function notify(chatId:any,text:string){if(!chatId)return;try{const token=await secret('telegram_bot_token_runtime');await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text})});}catch{}}
async function notifyUser(userId:string,text:string){const {data}=await db.from('bot_users').select('chat_id').eq('id',userId).maybeSingle();if(data?.chat_id)await notify(data.chat_id,text);}

async function waitForKleinanzeigenCallback(page:any,expectedState:string,timeoutMs=150000){
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){
  const current=String(page.url()||'');
  if(current.startsWith(KLEIN_CALLBACK)){
   let url:URL;try{url=new URL(current);}catch{throw Error('invalid_callback_url');}
   if(url.searchParams.get('state')!==expectedState)throw Error('oauth_state_mismatch');
   if(url.searchParams.get('error'))throw Error('oauth_login_failed');
   if(url.searchParams.get('code'))return url.href;
  }
  await delay(400);
 }
 throw Error('login_timeout');
}

async function activeKleinanzeigenFlow(userId:string,state:string){
 const {data}=await db.from('platform_auth_flows').select('id').eq('user_id',userId).eq('provider','kleinanzeigen').eq('state',state).is('consumed_at',null).maybeSingle();
 return !!data;
}

async function beginKleinanzeigenBrowserLogin(userId:string){
 const oauth=await beginKleinanzeigenLogin(db,userId);
 const expectedState=new URL(oauth.url).searchParams.get('state');
 if(!expectedState)throw Error('auth_flow_create_failed');
 let session:any=null,browser:any=null;
 try{
  session=await authBrowser.start();
  browser=await puppeteer.connect({browserWSEndpoint:browserSocket(String(session.connectUrl)),protocolTimeout:15000,defaultViewport:null});
  const pages=await browser.pages(),page=pages[0]||await browser.newPage();
  await page.goto(oauth.url,{waitUntil:'domcontentloaded',timeout:25000});
  const liveUrl=await authBrowser.live(String(session.id));
  const heldBrowser=browser;browser=null;
  EdgeRuntime.waitUntil((async()=>{
   let connected=false;
   try{
    const callbackUrl=await waitForKleinanzeigenCallback(page,expectedState);
    const result=await completeKleinanzeigenLogin(db,userId,callbackUrl);
    connected=result.authenticated===true;
    if(connected)await notifyUser(userId,'✅ Kleinanzeigen verbunden. Die Anmeldung ist gespeichert; du musst nichts kopieren oder einfügen.');
   }catch(error:any){
    const code=String(error?.message||'login_failed').slice(0,120);
    if(await activeKleinanzeigenFlow(userId,expectedState)){
     await markConnection(db,userId,'kleinanzeigen','needs_login',code).catch(()=>{});
     await notifyUser(userId,code==='login_timeout'?'⚠️ Kleinanzeigen-Anmeldung abgelaufen. Bitte erneut auf „Kleinanzeigen verbinden“ tippen.':'⚠️ Kleinanzeigen konnte nicht verbunden werden. Bitte den Login erneut starten.');
    }
   }finally{
    heldBrowser.disconnect();
    if(session?.id)await authBrowser.stop(String(session.id)).catch(()=>{});
    if(!connected)await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','kleinanzeigen').eq('state',expectedState).is('consumed_at',null).catch(()=>{});
   }
  })());
  return {status:'login',url:liveUrl,automaticCallback:true,expiresIn:150};
 }catch(error:any){
  browser?.disconnect();
  if(session?.id)await authBrowser.stop(String(session.id)).catch(()=>{});
  const flowStillActive=await activeKleinanzeigenFlow(userId,expectedState).catch(()=>false);
  if(flowStillActive){
   await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','kleinanzeigen').eq('state',expectedState).is('consumed_at',null).catch(()=>{});
   await markConnection(db,userId,'kleinanzeigen','needs_login',String(error?.message||'login_unavailable').slice(0,120)).catch(()=>{});
  }
  throw Error(['browser_network_error','browser_capacity_exceeded','browser_temporary_error','browser_auth_rejected','browser_access_rejected','browser_request_rejected'].includes(error?.message)?error.message:'login_unavailable');
 }
}

async function processApplication(){
 const {data:claimed,error:claimError}=await db.rpc('claim_application');if(claimError)throw Error('application_claim_failed');if(!claimed?.length)return {status:'idle'};
 const application=claimed[0];let started=false;
 const patch=async(value:any)=>{const {data,error}=await db.from('applications').update(value).eq('id',application.id).eq('lease_token',application.lease_token).select('id');if(error||!data?.length)throw Error('application_lease_lost');};
 try{
  await eligible(application.user_id);
  const [{data:user,error:userError},{data:listing,error:listingError},{data:profile,error:profileError}]=await Promise.all([
   db.from('bot_users').select('id,chat_id,is_active,auto_apply_enabled').eq('id',application.user_id).single(),
   db.from('listings').select('id,source_id,canonical_url,title,is_active,raw,external_id,source_listing_key').eq('id',application.listing_id).single(),
   db.from('applicant_profiles').select('*').eq('user_id',application.user_id).single()
  ]);
  if(userError||listingError||profileError)throw Error('application_read_failed');
  if(!user.auto_apply_enabled||!user.is_active||!listing.is_active){await patch({status:'failed',last_error:'not_eligible',lease_until:null});return {status:'failed'};}
  const provider=providerForListing(listing);if(!provider){await patch({status:'failed',last_error:'provider_unsupported',lease_until:null});return {status:'failed'};}
  const message=messageFor(profile,listing);await patch({application_text:message});
  const authorize=async()=>{const {data,error}=await db.rpc('authorize_application_send',{p_id:application.id,p_token:application.lease_token});if(error){started=true;throw Error('authorization_unconfirmed');}started=data===true;return started;};
  const result=await sendApplication(provider,{db,user,profile,listing,message,authorize});
  await patch({status:result.status,last_error:result.error||null,...(result.status==='sent'?{sent_at:new Date().toISOString()}:{}),lease_until:null});
  if(result.status==='sent')await notify(user.chat_id,`✅ Bewerbung automatisch versendet\n\n${clean(listing.title,120)}`);
  else if(result.error==='needs_login')await notify(user.chat_id,`🔐 ${provider} muss erneut verbunden werden.`);
  return {status:result.status,provider,error:result.error||null};
 }catch(error:any){
  const retry=!started&&['temporary_network_error','TimeoutError'].includes(error?.name==='TimeoutError'?'TimeoutError':error?.message)&&Number(application.attempts||0)<2;
  await patch({status:started?'manual_required':retry?'pending':'failed',last_error:started?'submission_unconfirmed':retry?'temporary_network_error':String(error?.message||'application_preparation_failed').slice(0,120),next_attempt_at:retry?new Date(Date.now()+60000*(Number(application.attempts||0)+1)).toISOString():null,lease_until:null});
  return {status:started?'manual_required':retry?'pending':'failed'};
 }
}

async function action(body:any){
 const userId=uuid(body.userId);if(body.action!=='disconnect')await eligible(userId);
 if(body.action==='profile_link'){const token=await createProfileToken(db,userId);return {url:`${base}/functions/v1/application-worker?token=${encodeURIComponent(token)}`};}
 const source=Number(body.source);
 if(body.action==='login'){
  if(source===2)return beginKleinanzeigenBrowserLogin(userId);
  if(source===1)return {status:'blocked',error:'provider_contract_unverified',officialApiRequired:false};
 }
 if(body.action==='complete_login'){
  if(source===2)return completeKleinanzeigenLogin(db,userId,clean(body.callbackUrl,8000));
 }
 if(body.action==='check'){
  if(source===2)return checkKleinanzeigenConnection(db,userId);
  if(source===1)return checkImmoScoutConnection(db,userId);
 }
 if(body.action==='disconnect'){
  if(source===2)return disconnectKleinanzeigen(db,userId);
  if(source===1)return disconnectImmoScout(db,userId);
 }
 if(body.action==='probe_immomio'){
  const listingId=uuid(body.listingId);const {data,error}=await db.from('listings').select('*').eq('id',listingId).single();if(error)throw Error('listing_unavailable');return probeImmomioApplication(data);
 }
 throw Error('invalid_action');
}

Deno.serve(async request=>{
 try{
  if((request.method==='GET'||request.method==='POST')&&new URL(request.url).searchParams.has('token'))return handleProfilePage(db,request);
  if(request.method!=='POST')return new Response('method not allowed',{status:405});
  if(request.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
  const body=await request.json();
  if(body.action==='health')return Response.json({status:'ok',mode:'provider-router',browserbaseUserFlow:'auth-only',kleinanzeigenAutomaticCallback:true});
  if(body.action==='process')return Response.json(await processApplication());
  return Response.json(await action(body));
 }catch(error:any){
  const safe=new Set(['configuration_unavailable','premium_required','invalid_user','invalid_action','provider_contract_unverified','connection_read_failed','disconnect_failed','auth_flow_create_failed','invalid_callback_url','auth_flow_expired','token_exchange_failed','listing_unavailable','login_unavailable','browser_network_error','browser_capacity_exceeded','browser_temporary_error','browser_auth_rejected','browser_access_rejected','browser_request_rejected']);
  return Response.json({error:safe.has(error?.message)?error.message:'application_operation_failed'},{status:503});
 }
});
