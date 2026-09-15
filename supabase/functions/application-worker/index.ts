import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {createProfileToken,handleProfilePage} from './profile-page.ts';
import {beginKleinanzeigenLogin,checkKleinanzeigenConnection,disconnectKleinanzeigen} from './providers/kleinanzeigen.ts';
import {checkImmoScoutConnection,disconnectImmoScout} from './providers/immoscout.ts';
import {probeImmomioApplication} from './providers/immomio.ts';
import {providerForListing,sendApplication} from './providers/router.ts';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const base=Deno.env.get('SUPABASE_URL')!;
async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data);}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required');}
const uuid=(v:any)=>{const s=String(v||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw Error('invalid_user');return s;};
const clean=(v:any,max=4000)=>String(v||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
function messageFor(profile:any,listing:any){if(clean(profile.default_message))return clean(profile.default_message,4000);const name=clean([profile.first_name,profile.last_name].filter(Boolean).join(' '),120),title=clean(listing.title,100)||'Ihre Wohnung';return `Guten Tag,\n\nich interessiere mich für „${title}“ und würde die Wohnung gerne besichtigen. Über eine Rückmeldung freue ich mich.\n\nFreundliche Grüße\n${name}`;}
async function notify(chatId:any,text:string){if(!chatId)return;try{const token=await secret('telegram_bot_token_runtime');await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text})});}catch{}}

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
  if(source===2)return beginKleinanzeigenLogin(db,userId);
  if(source===1)return {status:'blocked',error:'provider_contract_unverified',officialApiRequired:false};
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
  if(body.action==='health')return Response.json({status:'ok',mode:'provider-router',browserbaseUserFlow:false});
  if(body.action==='process')return Response.json(await processApplication());
  return Response.json(await action(body));
 }catch(error:any){
  const safe=new Set(['configuration_unavailable','premium_required','invalid_user','invalid_action','provider_contract_unverified','connection_read_failed','disconnect_failed','auth_flow_create_failed','listing_unavailable']);
  return Response.json({error:safe.has(error?.message)?error.message:'application_operation_failed'},{status:503});
 }
});
