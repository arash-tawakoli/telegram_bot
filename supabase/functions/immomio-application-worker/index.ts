import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const base=Deno.env.get('SUPABASE_URL')!;
const IMMOMIO=`${base}/functions/v1/immomio-account`;

async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data);}
const clean=(v:any,max=200)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
async function notify(chatId:any,text:string){if(!chatId)return;try{const token=await secret('telegram_bot_token_runtime');await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text}),signal:AbortSignal.timeout(15000)});}catch{}}
async function immomio(action:string,userId:string,listingId:string,extra:Record<string,unknown>={}){const internal=await secret('internal_worker_secret');const r=await fetch(IMMOMIO,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},body:JSON.stringify({action,userId,listingId,...extra}),signal:AbortSignal.timeout(45000)});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.error||`immomio_worker_${r.status}`);return data;}

async function processOne(){
 const {data:claimed,error:claimError}=await db.rpc('claim_immomio_application');
 if(claimError)throw Error('application_claim_failed');
 if(!claimed?.length)return {status:'idle'};
 const application=claimed[0];
 let started=false;
 const patch=async(value:any)=>{const {data,error}=await db.from('applications').update(value).eq('id',application.id).eq('lease_token',application.lease_token).select('id');if(error||!data?.length)throw Error('application_lease_lost');};
 try{
  const [{data:user,error:userError},{data:listing,error:listingError},{data:connection,error:connectionError}]=await Promise.all([
   db.from('bot_users').select('id,chat_id,is_active,auto_apply_enabled').eq('id',application.user_id).single(),
   db.from('listings').select('id,source_id,title,is_active,raw').eq('id',application.listing_id).single(),
   db.from('platform_connections').select('status').eq('user_id',application.user_id).eq('provider','immomio').maybeSingle()
  ]);
  if(userError||listingError||connectionError)throw Error('application_read_failed');
  if(!user.auto_apply_enabled||!user.is_active||!listing.is_active){await patch({status:'failed',last_error:'not_eligible',lease_until:null});return {status:'failed',error:'not_eligible'};}
  if(connection?.status!=='connected'){await patch({status:'failed',last_error:'provider_disabled',lease_until:null});return {status:'failed',provider:'immomio',error:'provider_disabled'};}

  const probe=await immomio('probe',String(user.id),String(listing.id));
  if(probe?.ready!==true){const error=clean(probe?.error||'provider_contract_unverified',120);await patch({status:'manual_required',last_error:error,lease_until:null});return {status:'manual_required',provider:'immomio',error};}

  const {data:authorized,error:authError}=await db.rpc('authorize_application_send',{p_id:application.id,p_token:application.lease_token});
  if(authError){started=true;throw Error('authorization_unconfirmed');}
  if(authorized!==true){await patch({status:'failed',last_error:'send_not_authorized',lease_until:null});return {status:'failed',provider:'immomio',error:'send_not_authorized'};}
  started=true;

  const result=await immomio('send_test',String(user.id),String(listing.id),{confirm:'SEND_ONE_IMMOMIO_TEST'});
  const status=['sent','failed','manual_required'].includes(String(result?.status))?String(result.status):'manual_required';
  const error=result?.error?clean(result.error,120):null;
  await patch({status,last_error:error,...(status==='sent'?{sent_at:new Date().toISOString()}:{}),lease_until:null});
  if(status==='sent'){
   let text=`✅ Bewerbung automatisch versendet\n\n${clean(listing.title,120)}`;
   if(result?.followUpRequired==='questions')text+='\n\nℹ️ Immomio hat nach dem Versand noch Folgefragen offen.';
   await notify(user.chat_id,text);
  }else if(error==='needs_login'){
   await notify(user.chat_id,'🔐 Immomio muss erneut verbunden werden.');
  }
  return {status,provider:'immomio',error};
 }catch(error:any){
  const code=String(error?.message||'application_preparation_failed');
  const retry=!started&&['temporary_network_error','TimeoutError'].includes(error?.name==='TimeoutError'?'TimeoutError':code)&&Number(application.attempts||0)<2;
  await patch({status:started?'manual_required':retry?'pending':'failed',last_error:started?'submission_unconfirmed':retry?'temporary_network_error':clean(code,120),next_attempt_at:retry?new Date(Date.now()+60000*(Number(application.attempts||0)+1)).toISOString():null,lease_until:null});
  return {status:started?'manual_required':retry?'pending':'failed',provider:'immomio',error:started?'submission_unconfirmed':clean(code,120)};
 }
}

Deno.serve(async req=>{try{if(req.method!=='POST')return new Response('method not allowed',{status:405});if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});const body=await req.json().catch(()=>({}));if(body.action==='health')return Response.json({ok:true,mode:'immomio-auto-application-worker'});if(body.action!=='process')return Response.json({error:'invalid_action'},{status:400});return Response.json(await processOne());}catch(error:any){return Response.json({error:clean(error?.message||'worker_failed',120)},{status:503});}});
