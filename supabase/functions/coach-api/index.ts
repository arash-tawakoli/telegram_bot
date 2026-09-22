import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const URL=Deno.env.get('SUPABASE_URL')!;
const secretKeys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const publishableKeys=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}');
const SECRET=secretKeys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLISHABLE=publishableKeys.default||Deno.env.get('SUPABASE_ANON_KEY')!;
const admin=createClient(URL,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
const ORIGINS=new Set(['https://intern.traumwohnunghamburg.de','http://localhost:4321','http://127.0.0.1:4321']);
const PROVIDERS=new Set(['immoscout','kleinanzeigen','immomio']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_ID=/^cp_[a-f0-9]{24}$/;

function cors(req:Request){const origin=req.headers.get('origin')||'';return {'access-control-allow-origin':ORIGINS.has(origin)?origin:'https://intern.traumwohnunghamburg.de','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,content-type,apikey','access-control-allow-credentials':'true','vary':'Origin','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};}
function json(req:Request,body:any,status=200){return Response.json(body,{status,headers:cors(req)})}
function clean(v:any,max=500){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}
function uuid(v:any){const s=String(v||'');if(!UUID.test(s))throw Error('invalid_id');return s}
function participantId(v:any){const s=String(v||'');if(!PUBLIC_ID.test(s))throw Error('invalid_participant');return s}
function email(v:any){const s=clean(v,320).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw Error('invalid_email');return s}
function integer(v:any,min:number,max:number){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw Error('invalid_number');return n}
function optionalInteger(v:any,min:number,max:number){if(v===null||v===undefined||v==='')return null;return integer(v,min,max)}
function random(bytes=32){const a=crypto.getRandomValues(new Uint8Array(bytes));let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function provider(v:any){const p=String(v||'');if(!PROVIDERS.has(p))throw Error('provider_unsupported');return p}
function without<T extends Record<string,any>>(row:T|null|undefined,...keys:string[]){if(!row)return row;const out={...row};for(const k of keys)delete out[k];return out}

async function secret(name:string){const{data,error}=await admin.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data)}
async function actor(req:Request){
 const auth=req.headers.get('authorization')||'';
 if(!auth.startsWith('Bearer '))throw Error('unauthorized');
 const token=auth.slice(7).trim();
 if(!token)throw Error('unauthorized');
 const scoped=createClient(URL,PUBLISHABLE,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token}}});
 const{data:{user},error}=await scoped.auth.getUser();
 if(error||!user)throw Error('unauthorized');
 const{data:member,error:me}=await admin.from('coaching_members')
  .select('id,auth_user_id,workspace_id,display_name,role,is_active,coaching_workspaces!inner(id,name,is_active,operations_paused)')
  .eq('auth_user_id',user.id).eq('is_active',true).maybeSingle();
 if(me||!member)throw Error('coach_forbidden');
 const w:any=(member as any).coaching_workspaces;
 if(!w?.is_active||w?.operations_paused)throw Error('workspace_unavailable');
 return{user,member,workspace:w};
}
async function assignmentFor(a:any,publicId:string,adminOnly=false){
 const pid=participantId(publicId);
 if(adminOnly&&a.member.role!=='admin')throw Error('admin_required');
 let q=admin.from('coaching_participants')
  .select('user_id,public_id,workspace_id,coach_member_id,status,retention_mode,retention_delete_on,assignment_version,archived_at,created_at,updated_at')
  .eq('public_id',pid).eq('workspace_id',a.member.workspace_id);
 if(a.member.role!=='admin')q=q.eq('coach_member_id',a.member.id);
 const{data,error}=await q.maybeSingle();
 if(error||!data)throw Error('participant_forbidden');
 return data;
}
async function audit(a:any,userId:string|null,action:string,changes:any={}){
 await admin.from('coaching_audit_events').insert({workspace_id:a.member.workspace_id,actor_member_id:a.member.id,participant_user_id:userId,action,changes}).throwOnError();
}
async function internalCall(endpoint:string,body:any){
 const key=await secret('internal_worker_secret');
 const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':key},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok)throw Error(data?.error||'provider_operation_failed');
 return data;
}
async function visibleAssignments(a:any,scope='all'){
 let q=admin.from('coaching_participants')
  .select('user_id,public_id,coach_member_id,status,retention_mode,retention_delete_on,updated_at,created_at,bot_users!inner(first_name,last_name,is_active,origin,telegram_user_id,plan_override,plan_override_expires_at,referral_bonus_until),coach:coaching_members!coaching_participants_workspace_id_coach_member_id_fkey(id,display_name)')
  .eq('workspace_id',a.member.workspace_id)
  .order('updated_at',{ascending:false});
 if(a.member.role!=='admin'||scope==='mine')q=q.eq('coach_member_id',a.member.id);
 const{data,error}=await q;
 if(error)throw Error('participants_read_failed');
 return data||[];
}
async function effectivePremium(users:string[]){
 const map=new Map<string,boolean>();
 if(!users.length)return map;
 const{data,error}=await admin.rpc('coach_effective_premium_status',{p_users:users});
 if(error)throw Error('premium_status_failed');
 for(const row of data||[])map.set(String(row.user_id),row.is_premium===true);
 return map;
}
async function participantSummary(a:any,scope='all'){
 const data:any[]=await visibleAssignments(a,scope),users=data.map(x=>x.user_id);
 const [profiles,prefs,apps,premium]=users.length?await Promise.all([
  admin.from('applicant_profiles').select('user_id,email,phone,city,household_size').in('user_id',users),
  admin.from('application_preferences').select('user_id,enabled,daily_limit,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled').in('user_id',users),
  admin.from('applications').select('user_id,status').in('user_id',users),
  effectivePremium(users)
 ]):[{data:[]},{data:[]},{data:[]},new Map<string,boolean>()];
 const pMap=new Map((profiles.data||[]).map((x:any)=>[x.user_id,without(x,'user_id')]));
 const prefMap=new Map((prefs.data||[]).map((x:any)=>[x.user_id,without(x,'user_id')]));
 const appMap=new Map<string,any>();
 for(const x of apps.data||[]){const v=appMap.get(x.user_id)||{total:0,sent:0,failed:0,pending:0};v.total++;if(x.status==='sent')v.sent++;else if(x.status==='failed'||x.status==='manual_required')v.failed++;else v.pending++;appMap.set(x.user_id,v)}
 return data.map((x:any)=>{
   const u=x.bot_users||{};
   return{
    participantId:x.public_id,coachMemberId:x.coach_member_id,coach:x.coach||null,status:x.status,
    retentionMode:x.retention_mode,retentionDeleteOn:x.retention_delete_on,updatedAt:x.updated_at,createdAt:x.created_at,
    participant:{firstName:u.first_name,lastName:u.last_name,isActive:u.is_active,origin:u.origin,telegramConnected:u.telegram_user_id!=null,isPremium:premium.get(String(x.user_id))===true,planOverride:u.plan_override||null,planExpiresAt:u.plan_override_expires_at,referralBonusUntil:u.referral_bonus_until},
    profile:pMap.get(x.user_id)||null,automation:prefMap.get(x.user_id)||null,applications:appMap.get(x.user_id)||{total:0,sent:0,failed:0,pending:0}
   };
 });
}
async function participantDetail(a:any,publicId:string){
 const assignment=await assignmentFor(a,publicId),userId=assignment.user_id;
 const [user,profile,searches,documents,connections,prefs,apps]=await Promise.all([
  admin.from('bot_users').select('first_name,last_name,username,is_active,origin,telegram_user_id,plan_override,plan_override_expires_at,referral_bonus_until,created_at,updated_at').eq('id',userId).single(),
  admin.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle(),
  admin.from('search_profiles').select('*').eq('user_id',userId).order('profile_slot'),
  admin.from('applicant_documents').select('id,document_type,original_filename,mime_type,size_bytes,send_with_auto_apply,created_at,updated_at').eq('user_id',userId).order('created_at',{ascending:false}),
  admin.from('platform_connections').select('provider,status,account_hint,expires_at,last_verified_at,last_error,updated_at').eq('user_id',userId),
  admin.from('application_preferences').select('*').eq('user_id',userId).maybeSingle(),
  admin.from('applications').select('id,listing_id,source_id,status,attempts,last_error,wait_reason,created_at,sent_at,next_attempt_at,listings(title,canonical_url,district,postal_code,city,sources(name))').eq('user_id',userId).order('created_at',{ascending:false}).limit(50)
 ]);
 if(user.error)throw Error('participant_read_failed');
 const premium=await effectivePremium([String(userId)]);
 const safeAssignment={participantId:assignment.public_id,coachMemberId:assignment.coach_member_id,status:assignment.status,retentionMode:assignment.retention_mode,retentionDeleteOn:assignment.retention_delete_on,assignmentVersion:assignment.assignment_version,archivedAt:assignment.archived_at,createdAt:assignment.created_at,updatedAt:assignment.updated_at};
 const safeUser={...without(user.data,'telegram_user_id'),telegramConnected:user.data?.telegram_user_id!=null,isPremium:premium.get(String(userId))===true};
 return{
   assignment:safeAssignment,user:safeUser,
   profile:without(profile.data,'user_id'),
   searchProfiles:(searches.data||[]).map((x:any)=>without(x,'user_id')),
   documents:documents.data||[],connections:connections.data||[],
   preferences:without(prefs.data,'user_id'),
   applications:apps.data||[]
 };
}
async function providerDisconnect(userId:string,p:string){
 if(p==='kleinanzeigen')return internalCall(URL+'/functions/v1/application-worker',{action:'disconnect',userId,source:2});
 if(p==='immomio')return internalCall(URL+'/functions/v1/immomio-account',{action:'disconnect',userId});
 return internalCall(URL+'/functions/v1/immoscout-auth-bridge',{action:'disconnect',userId});
}
async function startConnect(a:any,assignment:any,p:string){
 const userId=assignment.user_id,premium=await effectivePremium([String(userId)]);
 if(premium.get(String(userId))!==true)throw Error('premium_required');
 await admin.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('user_id',userId).eq('provider',p).is('consumed_at',null);
 const state=random(32),verifier=random(64);
 const{error}=await admin.from('platform_auth_flows').insert({
  user_id:userId,provider:p,state,code_verifier:verifier,origin:'coach',issued_by:a.user.id,return_target:'coach',
  context:{assignment_version:assignment.assignment_version}
 });
 if(error)throw Error('auth_flow_create_failed');
 return{url:'https://login.traumwohnunghamburg.de/connect?ticket='+encodeURIComponent(state),expiresInSeconds:1800};
}
async function updateProfile(a:any,assignment:any,input:any){
 const userId=assignment.user_id,current=await admin.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle();
 if(current.error)throw Error('profile_read_failed');
 const c=current.data||{};
 const row:any={
  user_id:userId,first_name:clean(input.first_name??c.first_name,120),last_name:clean(input.last_name??c.last_name,120),
  email:email(input.email??c.email),phone:clean(input.phone??c.phone,80),city:clean(input.city??c.city??'Hamburg',120)||'Hamburg',
  salutation:clean(input.salutation??c.salutation,40)||null,street:clean(input.street??c.street,160)||null,house_number:clean(input.house_number??c.house_number,40)||null,
  postcode:clean(input.postcode??c.postcode,10)||null,household_size:optionalInteger(input.household_size??c.household_size,1,20),
  employment_status:clean(input.employment_status??c.employment_status,160)||null,
  monthly_net_income:input.monthly_net_income===null||input.monthly_net_income===''?null:Number(input.monthly_net_income??c.monthly_net_income),
  pets:clean(input.pets??c.pets,160)||null,wbs_status:clean(input.wbs_status??c.wbs_status,160)||null,
  move_in_date:input.move_in_date??c.move_in_date??null,default_message:clean(input.default_message??c.default_message,4000)||null,
  schufa_status:clean(input.schufa_status??c.schufa_status??'NOT_SPECIFIED',80),phone_call_desired:Boolean(input.phone_call_desired??c.phone_call_desired??false),updated_at:new Date().toISOString()
 };
 if(!row.first_name||!row.last_name||!row.phone)throw Error('profile_required_fields');
 const{error}=await admin.from('applicant_profiles').upsert(row,{onConflict:'user_id'});if(error)throw Error('profile_save_failed');
 await admin.from('bot_users').update({first_name:row.first_name,last_name:row.last_name,updated_at:new Date().toISOString()}).eq('id',userId);
 await audit(a,userId,'profile_updated');return{ok:true};
}
async function saveSearch(a:any,assignment:any,input:any){
 const values={
  profile_slot:integer(input.profile_slot,1,4),
  property_types:[String(input.property_type||'')],
  location_mode:String(input.location_mode||'all_hamburg'),
  boroughs:Array.isArray(input.boroughs)?input.boroughs.map((x:any)=>clean(x,120)).filter(Boolean):[],
  neighborhoods:Array.isArray(input.neighborhoods)?input.neighborhoods.map((x:any)=>clean(x,120)).filter(Boolean):[],
  max_warm_rent:input.max_warm_rent,
  min_rooms:input.min_rooms,
  min_area_sqm:input.min_area_sqm,
  wbs_only:Boolean(input.wbs_only),
  furnished_preference:['any','yes','no'].includes(String(input.furnished_preference))?String(input.furnished_preference):'any',
  require_known_warm_rent:Boolean(input.require_known_warm_rent),
  max_deposit:input.max_deposit==null||input.max_deposit===''?null:input.max_deposit
 };
 const{data,error}=await admin.rpc('coach_save_search_profile',{p_actor:a.member.id,p_user:assignment.user_id,p_values:values});
 if(error)throw Error(error.message||'search_save_failed');
 return{ok:true,id:data};
}
async function requestUpload(a:any,assignment:any,input:any){
 const userId=assignment.user_id,original=clean(input.filename,180).replace(/[\\/]/g,'_'),mime=String(input.mime_type||'');
 if(!original||!['application/pdf','image/jpeg','image/png'].includes(mime))throw Error('invalid_document');
 const type=String(input.document_type||'other');if(!['wbs','urgency_certificate','guarantee','schufa','income_proof','rent_clearance','other'].includes(type))throw Error('invalid_document_type');
 const objectName=crypto.randomUUID()+'-'+original,path=userId+'/'+objectName;
 const{data,error}=await admin.storage.from('applicant-documents').createSignedUploadUrl(path);if(error||!data)throw Error('upload_url_failed');
 return{path,token:data.token,signedUrl:data.signedUrl,documentType:type,filename:original,mimeType:mime,maxBytes:6291456};
}
async function registerUpload(a:any,assignment:any,input:any){
 const userId=assignment.user_id,path=String(input.path||'');if(!path.startsWith(userId+'/'))throw Error('invalid_document_path');
 const name=path.slice(userId.length+1),folder=await admin.storage.from('applicant-documents').list(userId,{search:name,limit:10});if(folder.error)throw Error('upload_verify_failed');
 const obj=(folder.data||[]).find((x:any)=>x.name===name);if(!obj)throw Error('upload_not_found');
 const size=Number(obj.metadata?.size||0),mime=String(obj.metadata?.mimetype||input.mime_type||'');if(size<1||size>6291456||!['application/pdf','image/jpeg','image/png'].includes(mime))throw Error('upload_invalid');
 const type=String(input.document_type||'other'),{data,error}=await admin.from('applicant_documents').insert({user_id:userId,document_type:type,original_filename:clean(input.filename,180),storage_path:path,mime_type:mime,size_bytes:size,send_with_auto_apply:Boolean(input.send_with_auto_apply)}).select('id').single();
 if(error)throw Error('document_register_failed');await audit(a,userId,'document_added',{document_id:data.id,document_type:type});return{ok:true,id:data.id};
}

async function handle(req:Request){
 const a=await actor(req),body=await req.json().catch(()=>({})),action=String(body.action||'');
 if(action==='me')return{member:{id:a.member.id,displayName:a.member.display_name,role:a.member.role},workspace:{name:a.workspace.name}};
 if(action==='members'){const{data,error}=await admin.from('coaching_members').select('id,display_name,role,is_active,created_at').eq('workspace_id',a.member.workspace_id).order('display_name');if(error)throw Error('members_read_failed');return{members:(data||[]).map((x:any)=>({id:x.id,displayName:x.display_name,role:x.role,isActive:x.is_active,createdAt:x.created_at}))};}
 if(action==='locations'){const[{data:b},{data:n}]=await Promise.all([admin.from('hamburg_boroughs').select('id,name,sort_order').order('sort_order'),admin.from('hamburg_neighborhoods').select('id,name,borough_id').order('id')]);return{boroughs:b||[],neighborhoods:n||[]};}
 if(action==='participants')return{participants:await participantSummary(a,body.scope==='mine'?'mine':'all')};
 if(action==='participant')return participantDetail(a,participantId(body.participantId));
 if(action==='create_participant'){
  const coachId=a.member.role==='admin'&&body.coachMemberId?uuid(body.coachMemberId):a.member.id;
  const{data:userId,error}=await admin.rpc('coach_create_participant',{p_actor:a.member.id,p_coach:coachId,p_first_name:clean(body.first_name,120),p_last_name:clean(body.last_name,120),p_email:email(body.email),p_phone:clean(body.phone,80),p_city:clean(body.city,120)||'Hamburg',p_household_size:optionalInteger(body.household_size,1,20)});
  if(error)throw Error(error.message||'participant_create_failed');
  const{data:cp,error:cpError}=await admin.from('coaching_participants').select('public_id').eq('user_id',userId).single();if(cpError)throw Error('participant_create_failed');
  return{ok:true,participantId:cp.public_id};
 }
 const assignment=['dashboard','applications','create_coach','set_coach_active'].includes(action)?null:await assignmentFor(a,participantId(body.participantId),['set_plan','reassign'].includes(action));
 if(action==='update_profile')return updateProfile(a,assignment,body.profile||{});
 if(action==='save_search')return saveSearch(a,assignment,body.profile||{});
 if(action==='set_search_active'){const id=uuid(body.profileId),userId=assignment.user_id;const{error}=await admin.from('search_profiles').update({is_active:Boolean(body.active),updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',userId);if(error)throw Error('search_update_failed');await audit(a,userId,body.active?'search_profile_resumed':'search_profile_paused',{profile_id:id});return{ok:true};}
 if(action==='delete_search'){const id=uuid(body.profileId),userId=assignment.user_id;const{error}=await admin.from('search_profiles').delete().eq('id',id).eq('user_id',userId);if(error)throw Error('search_delete_failed');await audit(a,userId,'search_profile_deleted',{profile_id:id});return{ok:true};}
 if(action==='set_plan'){const{error}=await admin.rpc('coach_set_plan',{p_actor:a.member.id,p_user:assignment.user_id,p_plan:String(body.plan||'')});if(error)throw Error(error.message);return{ok:true};}
 if(action==='set_preferences'){const p=body.preferences||{},weekdays=Array.isArray(p.allowed_weekdays)?p.allowed_weekdays.map((x:any)=>integer(x,1,7)):null;const{error}=await admin.rpc('coach_set_application_preferences',{p_actor:a.member.id,p_user:assignment.user_id,p_enabled:Boolean(p.enabled),p_daily_limit:optionalInteger(p.daily_limit,1,1000),p_timezone:clean(p.timezone,80)||'Europe/Berlin',p_weekdays:weekdays,p_window_start:p.send_window_start||null,p_window_end:p.send_window_end||null,p_immoscout:Boolean(p.immoscout_enabled),p_kleinanzeigen:Boolean(p.kleinanzeigen_enabled),p_immomio:Boolean(p.immomio_enabled)});if(error)throw Error(error.message);return{ok:true};}
 if(action==='reassign'){const{error}=await admin.rpc('coach_reassign_participant',{p_actor:a.member.id,p_user:assignment.user_id,p_coach:uuid(body.coachMemberId)});if(error)throw Error(error.message);return{ok:true};}
 if(action==='archive'){const next=body.archived===false?'active':'archived';const{error}=await admin.from('coaching_participants').update({status:next,archived_at:next==='archived'?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('user_id',assignment.user_id).eq('workspace_id',a.member.workspace_id);if(error)throw Error('archive_failed');await audit(a,assignment.user_id,next==='archived'?'participant_archived':'participant_restored');return{ok:true};}
 if(action==='retention'){const mode=body.mode==='delete_on_date'?'delete_on_date':'manual',date=mode==='delete_on_date'?String(body.delete_on||''):null;if(mode==='delete_on_date'&&!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('invalid_retention_date');const{error}=await admin.from('coaching_participants').update({retention_mode:mode,retention_delete_on:date,status:mode==='delete_on_date'?'pending_deletion':'active',updated_at:new Date().toISOString()}).eq('user_id',assignment.user_id);if(error)throw Error('retention_save_failed');await audit(a,assignment.user_id,'retention_changed',{mode,delete_on:date});return{ok:true};}
 if(action==='telegram_link'){const{data,error}=await admin.rpc('issue_telegram_link_token',{p_user:assignment.user_id,p_created_by:a.user.id});if(error)throw Error(error.message||'telegram_link_failed');return{url:'https://t.me/traumwohnunghamburgbot?start='+encodeURIComponent(String(data)),expiresInSeconds:1200};}
 if(action==='start_connect')return startConnect(a,assignment,provider(body.provider));
 if(action==='disconnect_provider'){const p=provider(body.provider),result=await providerDisconnect(assignment.user_id,p);await admin.from('application_preferences').update({[p+'_enabled']:false}).eq('user_id',assignment.user_id);await audit(a,assignment.user_id,'provider_disconnected',{provider:p});return{ok:true,result};}
 if(action==='request_upload')return requestUpload(a,assignment,body);
 if(action==='register_upload')return registerUpload(a,assignment,body);
 if(action==='toggle_document'){const id=uuid(body.documentId),{error}=await admin.from('applicant_documents').update({send_with_auto_apply:Boolean(body.enabled),updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',assignment.user_id);if(error)throw Error('document_update_failed');await audit(a,assignment.user_id,'document_permission_changed',{document_id:id,enabled:Boolean(body.enabled)});return{ok:true};}
 if(action==='delete_document'){const id=uuid(body.documentId),{data,error}=await admin.from('applicant_documents').select('storage_path').eq('id',id).eq('user_id',assignment.user_id).maybeSingle();if(error||!data)throw Error('document_not_found');await admin.storage.from('applicant-documents').remove([data.storage_path]);const del=await admin.from('applicant_documents').delete().eq('id',id).eq('user_id',assignment.user_id);if(del.error)throw Error('document_delete_failed');await audit(a,assignment.user_id,'document_deleted',{document_id:id});return{ok:true};}
 if(action==='application_events'){const appId=uuid(body.applicationId),{data,error}=await admin.from('application_events').select('provider,event_type,status,attempt,reason,document_result,metadata,created_at').eq('application_id',appId).eq('user_id',assignment.user_id).order('created_at');if(error)throw Error('events_read_failed');return{events:data||[]};}
 if(action==='applications'){
  const rows:any[]=await visibleAssignments(a,body.scope==='mine'?'mine':'all'),ids=rows.map(x=>x.user_id);
  if(!ids.length)return{applications:[]};
  const publicByUser=new Map(rows.map((x:any)=>[String(x.user_id),{participantId:x.public_id,name:[x.bot_users?.first_name,x.bot_users?.last_name].filter(Boolean).join(' '),coach:x.coach?.display_name||null}]));
  const{data,error}=await admin.from('applications').select('id,user_id,status,attempts,last_error,wait_reason,created_at,sent_at,next_attempt_at,listings(title,canonical_url,district,postal_code,city,sources(name))').in('user_id',ids).order('created_at',{ascending:false}).limit(200);
  if(error)throw Error('applications_read_failed');
  const appIds=(data||[]).map((x:any)=>x.id),latest=new Map<string,any>();
  if(appIds.length){
   const{data:events,error:eventError}=await admin.from('application_events').select('application_id,provider,document_result,status,reason,created_at').in('application_id',appIds).order('created_at',{ascending:false});
   if(eventError)throw Error('applications_read_failed');
   for(const event of events||[])if(!latest.has(String(event.application_id)))latest.set(String(event.application_id),event);
  }
  return{applications:(data||[]).map((x:any)=>({...without(x,'user_id'),participant:publicByUser.get(String(x.user_id))||null,latestEvent:without(latest.get(String(x.id)),'application_id')}))};
 }
 if(action==='dashboard'){const rows:any[]=await visibleAssignments(a,body.scope==='mine'?'mine':'all'),ids=rows.map(x=>x.user_id);if(!ids.length)return{participants:0,applications:{sent:0,failed:0,pending:0,total:0}};const{data:apps,error}=await admin.from('applications').select('status').in('user_id',ids);if(error)throw Error('dashboard_read_failed');const counts:any={sent:0,failed:0,pending:0,total:0};for(const x of apps||[]){counts.total++;if(x.status==='sent')counts.sent++;else if(x.status==='failed'||x.status==='manual_required')counts.failed++;else counts.pending++}return{participants:ids.length,applications:counts};}
 if(action==='create_coach'){if(a.member.role!=='admin')throw Error('admin_required');const e=email(body.email),password=String(body.password||'');if(password.length<12)throw Error('password_too_short');const{data:created,error}=await admin.auth.admin.createUser({email:e,password,email_confirm:true});if(error||!created.user)throw Error(error?.message||'coach_auth_create_failed');const{data:member,error:me}=await admin.from('coaching_members').insert({auth_user_id:created.user.id,workspace_id:a.member.workspace_id,display_name:clean(body.display_name,120)||e,role:'coach',is_active:true}).select('id,display_name,role').single();if(me){await admin.auth.admin.deleteUser(created.user.id).catch(()=>{});throw Error('coach_member_create_failed');}await audit(a,null,'coach_created',{member_id:member.id});return{ok:true,member:{id:member.id,displayName:member.display_name,role:member.role}};}
 if(action==='set_coach_active'){if(a.member.role!=='admin')throw Error('admin_required');const id=uuid(body.memberId);if(id===a.member.id&&!body.active)throw Error('cannot_disable_self');const{error}=await admin.from('coaching_members').update({is_active:Boolean(body.active),updated_at:new Date().toISOString()}).eq('id',id).eq('workspace_id',a.member.workspace_id).eq('role','coach');if(error)throw Error('coach_update_failed');await audit(a,null,'coach_status_changed',{member_id:id,active:Boolean(body.active)});return{ok:true};}
 throw Error('invalid_action');
}
function publicError(error:any){const code=String(error?.message||'coach_api_failed').slice(0,160);const known=new Set(['unauthorized','coach_forbidden','workspace_unavailable','participant_forbidden','admin_required','invalid_id','invalid_participant','invalid_email','invalid_number','provider_unsupported','invalid_property_type','invalid_location','invalid_search_limits','location_required','invalid_document','invalid_document_type','invalid_document_path','upload_not_found','upload_invalid','invalid_retention_date','password_too_short','cannot_disable_self','premium_required']);return known.has(code)?code:(code.includes('profile_slot_not_allowed')?'profile_slot_not_allowed':'operation_failed');}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
 if(req.method==='GET')return json(req,{ok:true,service:'coach-api',version:5});
 if(req.method!=='POST')return new Response('method not allowed',{status:405,headers:cors(req)});
 try{return json(req,await handle(req));}
 catch(error:any){console.error('coach_api',String(error));const code=publicError(error),status=code==='unauthorized'?401:['coach_forbidden','participant_forbidden','admin_required','workspace_unavailable'].includes(code)?403:400;return json(req,{error:code},status);}
});
