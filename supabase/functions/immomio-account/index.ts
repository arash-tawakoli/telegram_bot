import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {beginImmomioLogin,completeImmomioLogin,checkImmomioConnection,disconnectImmomio,inspectImmomioAccountApplication,sendImmomioApplication} from './providers/immomio.ts';
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data)}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required')}
function uuid(v:any){const s=String(v||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw Error('invalid_user');return s}
async function applicationListing(listingId:string){
 const {data,error}=await db.rpc('get_immomio_application_listing',{p_listing_id:listingId});
 if(error||!data)throw Error('application_read_failed');
 if(data.application_target?.status==='conflict')throw Error('application_target_conflict');
 if(data.application_target?.status!=='resolved')throw Error('application_link_missing');
 return data;
}
async function handleAction(body:any){
 if(body.action==='health')return {ok:true,mode:'immomio-account-keycloak-pkce-telegram-bridge',authHeader:'raw-jwt',hierarchicalQuestions:'post-create',applicationTargets:'central-db-resolver',sendAuthorization:'single-use-object-lease'};
 const userId=uuid(body.userId);
 if(body.action==='readiness'){
  const {data,error}=await db.rpc('cooperative_auto_apply_readiness',{p_user:userId});
  if(error)throw Error('application_read_failed');return {ok:true,sources:data};
 }
 await eligible(userId);
 if(body.action==='login'){
  const {data,error}=await db.from('applicant_profiles').select('email').eq('user_id',userId).single();
  if(error||!data?.email)throw Error('immomio_email_required');return await beginImmomioLogin(db,userId,data.email);
 }
 if(body.action==='complete_login')return await completeImmomioLogin(db,userId,String(body.callbackUrl||''));
 if(body.action==='check')return await checkImmomioConnection(db,userId);
 if(body.action==='disconnect')return await disconnectImmomio(db,userId);
 if(body.action==='probe'){
  const listing=await applicationListing(uuid(body.listingId));
  if(!listing.is_active)return {available:false,ready:false,error:'listing_unavailable'};
  return await inspectImmomioAccountApplication({db,user:{id:userId},listing});
 }
 if(body.action==='send_authorized'||body.action==='send_test'){
  if(body.action==='send_test'&&body.confirm!=='SEND_ONE_IMMOMIO_TEST')throw Error('send_not_authorized');
  const listingId=uuid(body.listingId),applicationId=uuid(body.applicationId),leaseToken=uuid(body.leaseToken),sourceIdentifier=uuid(body.sourceIdentifier);
  const args={p_id:applicationId,p_token:leaseToken,p_user:userId,p_listing:listingId,p_source_identifier:sourceIdentifier};
  const {data:valid,error:validationError}=await db.rpc('validate_immomio_application_send',args);
  if(validationError||valid!==true)throw Error('send_not_authorized');
  const listing=await applicationListing(listingId);
  if(!listing.is_active||listing.application_target.source_identifier!==sourceIdentifier.toLowerCase())throw Error('send_not_authorized');
  return await sendImmomioApplication({db,user:{id:userId},listing,authorize:async()=>{
   const {data,error}=await db.rpc('consume_immomio_application_send',args);
   if(error)throw Error('submission_unconfirmed');
   return data===true;
  }});
 }
 throw Error('invalid_action');
}
Deno.serve(async req=>{
 try{
  if(req.method!=='POST')return new Response('method not allowed',{status:405});
  if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
  return Response.json(await handleAction(await req.json()));
 }catch(e:any){
  const safe=new Set(['configuration_unavailable','premium_required','invalid_user','invalid_action','application_read_failed','application_target_conflict','application_link_missing','listing_unavailable','immomio_email_required','immomio_sso_failed','immomio_sso_contract_changed','auth_flow_create_failed','invalid_callback_url','auth_flow_expired','token_exchange_failed','needs_login','send_not_authorized','submission_unconfirmed']);
  return Response.json({error:safe.has(e?.message)?e.message:'immomio_operation_failed'},{status:503});
 }
});
