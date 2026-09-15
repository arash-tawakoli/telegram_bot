import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {deleteConnection,getConnection} from './credentials.ts';
import {handleProfilePage,profileLink} from './profile-page.ts';
import {beginKleinanzeigenLogin,checkKleinanzeigenConnection} from './providers/kleinanzeigen.ts';
import {checkImmoScoutConnection} from './providers/immoscout.ts';
import {probeImmomioApplication} from './providers/immomio.ts';
import {providerForListing,sendApplication} from './providers/router.ts';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const db=createClient(SUPABASE_URL,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});

async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data);}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required');}
const safeLine=(value:any,max=100)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

function applicationMessage(profile:any,listing:any){
 const custom=String(profile?.default_message||'').trim();
 if(custom)return custom.slice(0,4000);
 const title=safeLine(listing?.title,80)||'Ihre Wohnung';
 const name=safeLine([profile?.first_name,profile?.last_name].filter(Boolean).join(' '),120)||'Interessent/in';
 return `Guten Tag,\n\nich interessiere mich für „${title}“ und würde die Wohnung gerne besichtigen. Über eine Rückmeldung freue ich mich.\n\nFreundliche Grüße\n${name}`;
}

async function telegram(method:string,body:Record<string,unknown>){
 const token=await secret('telegram_bot_token_runtime');
 const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('telegram_notify_failed');
}
async function notifySent(user:any,listing:any,provider:string){
 if(!user?.chat_id)return;
 const names:any={immoscout:'ImmoScout24',kleinanzeigen:'Kleinanzeigen',immomio:'Immomio'};
 const text=`✅ Bewerbung automatisch versendet\n\n🏠 ${safeLine(listing?.title,120)||'Wohnungsangebot'}\n🔗 ${names[provider]||provider}`;
 await telegram('sendMessage',{chat_id:Number(user.chat_id),text,disable_web_page_preview:true}).catch(error=>console.error('application_sent_notice',String(error)));
}

async function processApplication(){
 const {data:claimed,error:claimError}=await db.rpc('claim_application');
 if(claimError)throw Error('application_claim_failed');
 if(!claimed?.length)return {status:'idle'};
 const application=claimed[0];let started=false;
 const patch=async(value:Record<string,unknown>)=>{const {data,error}=await db.from('applications').update(value).eq('id',application.id).eq('lease_token',application.lease_token).select('id');if(error||!data?.length)throw Error('application_lease_lost');};
 try{
  await eligible(application.user_id);
  const [{data:user,error:userError},{data:listing,error:listingError},{data:profile,error:profileError}]=await Promise.all([
   db.from('bot_users').select('id,chat_id,is_active,auto_apply_enabled').eq('id',application.user_id).single(),
   db.from('listings').select('id,source_id,canonical_url,title,is_active,raw,fresh_delivery_eligible').eq('id',application.listing_id).single(),
   db.from('applicant_profiles').select('*').eq('user_id',application.user_id).maybeSingle()
  ]);
  if(userError||listingError||profileError)throw Error('application_read_failed');
  if(!user?.auto_apply_enabled||!user?.is_active||!listing?.is_active||!profile){await patch({status:'failed',last_error:'not_eligible',lease_until:null});return {status:'failed'};}
  const provider=providerForListing(listing);
  if(!provider){await patch({status:'failed',last_error:'provider_not_supported',lease_until:null});return {status:'failed'};}
  const message=applicationMessage(profile,listing);await patch({application_text:message});
  const result=await sendApplication(db,{application,user,profile,listing,message,authorize:async()=>{
   const {data,error}=await db.rpc('authorize_application_send',{p_id:application.id,p_token:application.lease_token});
   if(error){started=true;throw Error('authorization_unconfirmed');}
   started=data===true;return started;
  }});
  await patch({status:result.status,last_error:result.error||null,...(result.status==='sent'?{sent_at:new Date().toISOString()}:{}),lease_until:null});
  if(result.status==='sent')await notifySent(user,listing,provider);
  return {status:result.status,provider};
 }catch(error){
  const message=String(error?.message||error),temporary=!started&&['network_error','temporary_provider_error','TimeoutError'].includes(error?.name==='TimeoutError'?'TimeoutError':message)&&Number(application.attempts)<2;
  await patch({status:started?'manual_required':temporary?'pending':'failed',last_error:started?'submission_unconfirmed':temporary?'temporary_provider_error':safeLine(message,120)||'application_preparation_failed',...(!started?{attempts:Number(application.attempts)+1}:{}),next_attempt_at:new Date(Date.now()+60_000*(Number(application.attempts)+1)).toISOString(),lease_until:null});
  return {status:started?'manual_required':temporary?'pending':'failed'};
 }
}

const providerName=(source:number)=>source===1?'immoscout':source===2?'kleinanzeigen':null;
async function disconnect(userId:string,source:number){const provider=providerName(source);if(!provider)throw Error('invalid_platform');await deleteConnection(db,userId,provider);return {status:'disconnected'};}
async function check(userId:string,source:number){await eligible(userId);if(source===1)return checkImmoScoutConnection(db,userId);if(source===2)return checkKleinanzeigenConnection(db,userId);throw Error('invalid_platform');}
async function login(userId:string,source:number){await eligible(userId);if(source===2)return beginKleinanzeigenLogin(db,userId);if(source===1){const row=await getConnection(db,userId,'immoscout');return {status:row?.status||'needs_login',error:'provider_contract_unverified'};}throw Error('invalid_platform');}

Deno.serve(async request=>{
 const url=new URL(request.url);
 try{
  if(url.searchParams.get('action')==='profile'&&(request.method==='GET'||request.method==='POST'))return await handleProfilePage(request,db);
  if(request.method!=='POST')return new Response('method not allowed',{status:405});
  if(request.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
  const body=await request.json();
  if(body.action==='health')return Response.json({status:'ok',mode:'provider-router',browserbaseUserFlow:false});
  if(body.action==='process')return Response.json(await processApplication());
  const userId=String(body.userId||'');if(!/^[0-9a-f-]{36}$/i.test(userId))return Response.json({error:'invalid_user'},{status:400});
  if(body.action==='profile_link')return Response.json({url:await profileLink(db,userId,SUPABASE_URL),expiresIn:1200});
  const source=Number(body.source);
  if(body.action==='login')return Response.json(await login(userId,source));
  if(body.action==='check')return Response.json(await check(userId,source));
  if(body.action==='disconnect')return Response.json(await disconnect(userId,source));
  if(body.action==='probe_immomio'){
   const listingId=String(body.listingId||'');const {data:listing,error}=await db.from('listings').select('id,source_id,raw').eq('id',listingId).maybeSingle();if(error||!listing)return Response.json({error:'listing_not_found'},{status:404});return Response.json(await probeImmomioApplication(listing));
  }
  return Response.json({error:'invalid_action'},{status:400});
 }catch(error){
  console.error('application_worker',String(error));
  const safe=new Set(['configuration_unavailable','credential_key_unavailable','credential_key_invalid','premium_required','invalid_platform','platform_not_connected','platform_login_rejected','platform_login_unavailable','platform_login_state_failed','platform_login_expired','platform_callback_invalid','platform_refresh_token_missing','platform_connection_read_failed','platform_connection_write_failed','platform_disconnect_failed','provider_contract_unverified']);
  const message=safe.has(error?.message)?error.message:'application_operation_failed';
  return Response.json({error:message},{status:message==='premium_required'?403:503});
 }
});
