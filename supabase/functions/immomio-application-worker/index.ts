import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const base=Deno.env.get('SUPABASE_URL')!;
const IMMOMIO=`${base}/functions/v1/immomio-account`;
const STATUS_SYNC=`${base}/functions/v1/notification-dispatcher`;

async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data);}
const clean=(v:any,max=200)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
async function syncListingStatus(userId:string,listingId:string){try{const internal=await secret('internal_worker_secret');await fetch(STATUS_SYNC,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},body:JSON.stringify({action:'sync_application_status',userId,listingId}),signal:AbortSignal.timeout(15000)});}catch{}}
async function immomio(action:string,userId:string,listingId:string,extra:Record<string,unknown>={}){const internal=await secret('internal_worker_secret');const r=await fetch(IMMOMIO,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},body:JSON.stringify({action,userId,listingId,...extra}),signal:AbortSignal.timeout(45000)});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.error||`immomio_worker_${r.status}`);return data;}
async function immomioRequestStarted(applicationId:string){const {data,error}=await db.rpc('immomio_application_request_started',{p_application:applicationId});if(error)return null;return data===true;}

function immomioDocumentState(result:any){
 const transfer=result?.documentTransfer;
 const documentFailure=/^(document_|application_documents_)/.test(String(result?.error||''));
 if(!transfer||typeof transfer!=='object')return documentFailure?{document_result:'transfer_failed'}:{};
 const counts=['selected','uploaded','reused'] as const;
 if(!counts.every(key=>Number.isSafeInteger(transfer[key])&&transfer[key]>=0))return documentFailure?{document_result:'transfer_failed'}:{};
 const verified=transfer.verified===true&&transfer.uploaded+transfer.reused===transfer.selected;
 const documentTransfer={selected:transfer.selected,uploaded:transfer.uploaded,reused:transfer.reused,verified,
  ...(Number.isSafeInteger(transfer.removed)&&transfer.removed>=0?{removed:transfer.removed}:{})};
 return{documentTransfer,document_result:documentFailure||!verified?'transfer_failed':transfer.selected>0?'native_uploaded':'not_provided'};
}

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
   db.from('listings').select('id,source_id,title,is_active,canonical_url,raw').eq('id',application.listing_id).single(),
   db.from('platform_connections').select('status').eq('user_id',application.user_id).eq('provider','immomio').maybeSingle()
  ]);
  if(userError||listingError||connectionError)throw Error('application_read_failed');
  
  if(!user.auto_apply_enabled||!user.is_active||!listing.is_active){await patch({status:'failed',last_error:'not_eligible',wait_reason:null,provider_state:{provider:'immomio'},lease_until:null});await syncListingStatus(String(application.user_id),String(application.listing_id));return {status:'failed',error:'not_eligible'};}
  if(connection?.status!=='connected'){await patch({status:'failed',last_error:'provider_disabled',provider_state:{provider:'immomio'},lease_until:null});await syncListingStatus(String(application.user_id),String(application.listing_id));return {status:'failed',provider:'immomio',error:'provider_disabled'};}

  const probe=await immomio('probe',String(user.id),String(listing.id));
  if(probe?.ready!==true){const error=clean(probe?.error||'provider_contract_unverified',120),providerState={provider:'immomio',alreadyApplied:probe?.alreadyApplied===true,applicationId:probe?.applicationId||null,customQuestionCount:probe?.customQuestionCount||0,hierarchicalQuestionCount:probe?.hierarchicalQuestionCount||0};await patch({status:'manual_required',last_error:error,provider_state:providerState,lease_until:null});await syncListingStatus(String(application.user_id),String(application.listing_id));return {status:'manual_required',provider:'immomio',error};}

  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(probe.sourceIdentifier||'')))throw Error('application_target_unverified');
  const {data:authorized,error:authError}=await db.rpc('authorize_immomio_application_send',{p_id:application.id,p_token:application.lease_token,p_source_identifier:probe.sourceIdentifier});
  if(authError){started=true;throw Error('authorization_unconfirmed');}
  if(authorized!==true){
   const {data:current}=await db.from('applications').select('status,last_error,wait_reason,next_attempt_at').eq('id',application.id).eq('lease_token',application.lease_token).maybeSingle();
   if(current&&['failed','manual_required'].includes(current.status)){await syncListingStatus(String(application.user_id),String(application.listing_id));return {status:current.status,provider:'immomio',error:current.last_error};}
   if(current?.status==='pending'&&current?.wait_reason){await patch({lease_until:null});await syncListingStatus(String(application.user_id),String(application.listing_id));return {status:'deferred',provider:'immomio',error:current.wait_reason};}
   await patch({status:'failed',last_error:'send_not_authorized',provider_state:{provider:'immomio'},lease_until:null});await syncListingStatus(String(application.user_id),String(application.listing_id));return {status:'failed',provider:'immomio',error:'send_not_authorized'};
  }
  started=true;

  const result=await immomio('send_authorized',String(user.id),String(listing.id),{applicationId:application.id,leaseToken:application.lease_token,sourceIdentifier:probe.sourceIdentifier});
  const status=['sent','failed','manual_required'].includes(String(result?.status))?String(result.status):'manual_required';
  const error=result?.error?clean(result.error,120):null,providerState={provider:'immomio',applicationId:result?.applicationId||null,providerStatus:result?.providerStatus||null,followUpRequired:result?.followUpRequired||null,hasQuestions:result?.hasQuestions??null,hasUnansweredQuestions:result?.hasUnansweredQuestions??null,smsVerificationRequired:result?.smsVerificationRequired??false,hierarchicalQuestionCount:result?.hierarchicalQuestionCount||0,...immomioDocumentState(result)};
  await patch({status,last_error:error,provider_state:providerState,...(status==='sent'?{sent_at:new Date().toISOString()}:{}),lease_until:null});
  await syncListingStatus(String(application.user_id),String(application.listing_id));
  return {status,provider:'immomio',error,documentResult:providerState.document_result||null};
 }catch(error:any){
  const code=String(error?.message||'application_preparation_failed');
  const attempts=Number(application.attempts||0);
  const requestStarted=started?await immomioRequestStarted(String(application.id)):false;
  const transientBeforeAuthorization=!started&&['temporary_network_error','TimeoutError','immomio_operation_failed'].includes(error?.name==='TimeoutError'?'TimeoutError':code);
  const safePreSubmitRetry=started&&requestStarted===false;
  const retry=(transientBeforeAuthorization||safePreSubmitRetry)&&attempts<3;
  const terminalStatus=(started&&requestStarted!==false)?'manual_required':retry?'pending':'failed';
  const finalError=terminalStatus==='manual_required'?'submission_unconfirmed':retry?'temporary_network_error':clean(code,120);
  const retryPatch=retry?{submission_started_at:null,next_attempt_at:new Date(Date.now()+60000*Math.max(1,attempts+1)).toISOString(),wait_reason:null}:{};
  await patch({status:terminalStatus,last_error:finalError,provider_state:{...application.provider_state,provider:'immomio',requestStarted},...(retry&&!started?{attempts:attempts+1}:{}),...retryPatch,lease_until:null});
  await syncListingStatus(String(application.user_id),String(application.listing_id));
  return {status:terminalStatus,provider:'immomio',error:finalError,requestStarted};
 }
}

Deno.serve(async req=>{try{if(req.method!=='POST')return new Response('method not allowed',{status:405});if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});const body=await req.json().catch(()=>({}));if(body.action==='health')return Response.json({ok:true,mode:'immomio-auto-application-worker',applicationTargets:'central-db-resolver',sendAuthorization:'single-use-object-lease'});if(body.action!=='process')return Response.json({error:'invalid_action'},{status:400});return Response.json(await processOne());}catch(error:any){return Response.json({error:clean(error?.message||'worker_failed',120)},{status:503});}});
