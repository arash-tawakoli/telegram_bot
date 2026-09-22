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

function cors(req:Request){const origin=req.headers.get('origin')||'';return {'access-control-allow-origin':ORIGINS.has(origin)?origin:'https://intern.traumwohnunghamburg.de','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,content-type,apikey','access-control-allow-credentials':'true','vary':'Origin','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};}
function json(req:Request,body:any,status=200){return Response.json(body,{status,headers:cors(req)})}
function clean(v:any,max=500){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}
function uuid(v:any){const s=String(v||'');if(!UUID.test(s))throw Error('invalid_id');return s}
function email(v:any){const s=clean(v,320).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw Error('invalid_email');return s}
function integer(v:any,min:number,max:number){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw Error('invalid_number');return n}
function optionalInteger(v:any,min:number,max:number){if(v===null||v===undefined||v==='')return null;return integer(v,min,max)}
function random(bytes=32){const a=crypto.getRandomValues(new Uint8Array(bytes));let s='';for(const b of a)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function provider(v:any){const p=String(v||'');if(!PROVIDERS.has(p))throw Error('provider_unsupported');return p}

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
async function participantAccess(a:any,userId:string,adminOnly=false){
 const q=admin.from('coaching_participants').select('user_id,workspace_id,coach_member_id,status,retention_mode,retention_delete_on,assignment_version,created_at,updated_at').eq('user_id',userId).eq('workspace_id',a.member.workspace_id);
 if(a.member.role!=='admin'||adminOnly)q.eq('coach_member_id',a.member.id);
 const{data,error}=await q.maybeSingle();
 if(error||!data)throw Error(adminOnly&&a.member.role!=='admin'?'admin_required':'participant_forbidden');
 if(adminOnly&&a.member.role!=='admin')throw Error('admin_required');
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
async function participantSummary(a:any){
 let q=admin.from('coaching_participants')
  .select('user_id,coach_member_id,status,retention_mode,retention_delete_on,updated_at,bot_users!inner(id,first_name,last_name,is_active,origin,telegram_user_id,plan_override,plan_override_expires_at,referral_bonus_until),coach:coaching_members!coaching_participants_workspace_id_coach_member_id_fkey(id,display_name)')
  .eq('workspace_id',a.member.workspace_id)
  .order('updated_at',{ascending:false});
 if(a.member.role!=='admin')q=q.eq('coach_member_id',a.member.id);
 const{data,error}=await q;
 if(error)throw Error('participants_read_failed');
 const users=(data||[]).map((x:any)=>x.user_id);
 const [profiles,prefs,apps]=users.length?await Promise.all([
  admin.from('applicant_profiles').select('user_id,email,phone,city,household_size').in('user_id',users),
  admin.from('application_preferences').select('user_id,enabled,daily_limit,immoscout_enabled,kleinanzeigen_enabled,immomio_enabled').in('user_id',users),
  admin.from('applications').select('user_id,status').in('user_id',users)
 ]):[{data:[]},{data:[]},{data:[]}];
 const pMap=new Map((profiles.data||[]).map((x:any)=>[x.user_id,x]));
 const prefMap=new Map((prefs.data||[]).map((x:any)=>[x.user_id,x]));
 const appMap=new Map<string,any>();
 for(const x of apps.data||[]){const v=appMap.get(x.user_id)||{total:0,sent:0,failed:0,pending:0};v.total++;if(x.status==='sent')v.sent++;else if(x.status==='failed'||x.status==='manual_required')v.failed++;else v.pending++;appMap.set(x.user_id,v)}
 return (data||[]).map((x:any)=>({...x,profile:pMap.get(x.user_id)||null,automation:prefMap.get(x.user_id)||null,applications:appMap.get(x.user_id)||{total:0,sent:0,failed:0,pending:0}}));
}
async function participantDetail(a:any,userId:string){
 const assignment=await participantAccess(a,userId);
 const [user,profile,searches,documents,connections,prefs,apps]=await Promise.all([
  admin.from('bot_users').select('id,first_name,last_name,username,is_active,origin,telegram_user_id,chat_id,plan_override,plan_override_expires_at,referral_bonus_until,created_at,updated_at').eq('id',userId).single(),
  admin.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle(),
  admin.from('search_profiles').select('*').eq('user_id',userId).order('profile_slot'),
  admin.from('applicant_documents').select('id,document_type,original_filename,mime_type,size_bytes,send_with_auto_apply,created_at,updated_at').eq('user_id',userId).order('created_at',{ascending:false}),
  admin.from('platform_connections').select('provider,status,account_hint,expires_at,last_verified_at,last_error,updated_at').eq('user_id',userId),
  admin.from('application_preferences').select('*').eq('user_id',userId).maybeSingle(),
  admin.from('applications').select('id,listing_id,source_id,status,attempts,last_error,wait_reason,created_at,sent_at,next_attempt_at,listings(title,canonical_url,district,postal_code,city,sources(name))').eq('user_id',userId).order('created_at',{ascending:false}).limit(50)
 ]);
 if(user.error)throw Error('participant_read_failed');
 return{assignment,user:user.data,profile:profile.data,searchProfiles:searches.data||[],documents:documents.data||[],connections:connections.data||[],preferences:prefs.data,applications:apps.data||[]};
}
async function providerDisconnect(userId:string,p:string){
 if(p==='kleinanzeigen')return internalCall(URL+'/functions/v1/application-worker',{action:'disconnect',userId,source:2});
 if(p==='immomio')return internalCall(URL+'/functions/v1/immomio-account',{action:'disconnect',userId});
 return internalCall(URL+'/functions/v1/immoscout-auth-bridge',{action:'disconnect',userId});
}
async function startConnect(a:any,userId:string,p:string){
 const assignment=await participantAccess(a,userId);
 await admin.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('user_id',userId).eq('provider',p).is('consumed_at',null);
 const state=random(32),verifier=random(64);
 const{error}=await admin.from('platform_auth_flows').insert({
  user_id:userId,provider:p,state,code_verifier:verifier,origin:'coach',issued_by:a.user.id,return_target:'coach',
  context:{assignment_version:assignment.assignment_version}
 });
 if(error)throw Error('auth_flow_create_failed');
 return{url:'https://login.traumwohnunghamburg.de/connect?ticket='+encodeURIComponent(state),expiresInSeconds:1800};
}
async function updateProfile(a:any,userId:string,input:any){
 await participantAccess(a,userId);
 const current=await admin.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle();
 if(current.error)throw Error('profile_read_failed');
 const c=current.data||{};
 const row:any={
  user_id:userId,
  first_name:clean(input.first_name??c.first_name,120),
  last_name:clean(input.last_name??c.last_name,120),
  email:email(input.email??c.email),
  phone:clean(input.phone??c.phone,80),
  city:clean(input.city??c.city??'Hamburg',120)||'Hamburg',
  salutation:clean(input.salutation??c.salutation,40)||null,
  street:clean(input.street??c.street,160)||null,
  house_number:clean(input.house_number??c.house_number,40)||null,
  postcode:clean(input.postcode??c.postcode,10)||null,
  household_size:optionalInteger(input.household_size??c.household_size,1,20),
  employment_status:clean(input.employment_status??c.employment_status,160)||null,
  monthly_net_income:input.monthly_net_income===null||input.monthly_net_income===''?null:Number(input.monthly_net_income??c.monthly_net_income),
  pets:clean(input.pets??c.pets,160)||null,
  wbs_status:clean(input.wbs_status??c.wbs_status,160)||null,
  move_in_date:input.move_in_date??c.move_in_date??null,
  default_message:clean(input.default_message??c.default_message,4000)||null,
  schufa_status:clean(input.schufa_status??c.schufa_status??'NOT_SPECIFIED',80),
  phone_call_desired:Boolean(input.phone_call_desired??c.phone_call_desired??false),
  updated_at:new Date().toISOString()
 };
 if(!row.first_name||!row.last_name||!row.phone)throw Error('profile_required_fields');
 const{error}=await admin.from('applicant_profiles').upsert(row,{onConflict:'user_id'});if(error)throw Error('profile_save_failed');
 await admin.from('bot_users').update({first_name:row.first_name,last_name:row.last_name,updated_at:new Date().toISOString()}).eq('id',userId);
 await audit(a,userId,'profile_updated');
 return{ok:true};
}
async function saveSearch(a:any,userId:string,input:any){
 await participantAccess(a,userId);
 const slot=integer(input.profile_slot,1,4),type=String(input.property_type||'');
 if(!['Wohnung','Haus','WG','Tauschwohnung'].includes(type))throw Error('invalid_property_type');
 const mode=String(input.location_mode||'all_hamburg');if(!['all_hamburg','boroughs','neighborhoods'].includes(mode))throw Error('invalid_location');
 const row:any={
  user_id:userId,profile_slot:slot,name:clean(input.name,80)||('Meine Suche '+slot),
  property_types:[type],location_mode:mode,
  districts:mode==='all_hamburg'?['Ganz Hamburg']:Array.isArray(input.districts)?input.districts.map((x:any)=>clean(x,120)).filter(Boolean):[],
  boroughs:Array.isArray(input.boroughs)?input.boroughs.map((x:any)=>clean(x,120)).filter(Boolean):[],
  neighborhoods:Array.isArray(input.neighborhoods)?input.neighborhoods.map((x:any)=>clean(x,120)).filter(Boolean):[],
  max_warm_rent:Number(input.max_warm_rent),min_rooms:Number(input.min_rooms),min_area_sqm:Number(input.min_area_sqm),
  min_room_area_sqm:Number(input.min_room_area_sqm||0),wbs_only:Boolean(input.wbs_only),
  furnished_preference:['any','yes','no'].includes(String(input.furnished_preference))?String(input.furnished_preference):'any',
  require_known_warm_rent:Boolean(input.require_known_warm_rent),max_deposit:input.max_deposit==null||input.max_deposit===''?null:Number(input.max_deposit),
  is_active:input.is_active!==false,updated_at:new Date().toISOString()
 };
 if(!Number.isFinite(row.max_warm_rent)||row.max_warm_rent<100||row.max_warm_rent>5000||!Number.isFinite(row.min_rooms)||row.min_rooms<1||row.min_rooms>20||!Number.isFinite(row.min_area_sqm)||row.min_area_sqm<0||row.min_area_sqm>1000)throw Error('invalid_search_limits');
 if(mode==='boroughs'&&!row.boroughs.length)throw Error('location_required');
 if(mode==='neighborhoods'&&!row.neighborhoods.length)throw Error('location_required');
 const existing=await admin.from('search_profiles').select('id').eq('user_id',userId).eq('profile_slot',slot).maybeSingle();
 let result:any;
 if(existing.data)result=await admin.from('search_profiles').update(row).eq('id',existing.data.id).select('id').single();
 else result=await admin.from('search_profiles').insert(row).select('id').single();
 if(result.error)throw Error(String(result.error.message||'search_save_failed'));
 await audit(a,userId,'search_profile_saved',{slot,property_type:type});
 return{ok:true,id:result.data.id};
}
async function requestUpload(a:any,userId:string,input:any){
 await participantAccess(a,userId);
 const original=clean(input.filename,180).replace(/[\\/]/g,'_');
 const mime=String(input.mime_type||'');
 if(!original||!['application/pdf','image/jpeg','image/png'].includes(mime))throw Error('invalid_document');
 const type=String(input.document_type||'other');
 if(!['wbs','urgency_certificate','guarantee','schufa','income_proof','rent_clearance','other'].includes(type))throw Error('invalid_document_type');
 const objectName=crypto.randomUUID()+'-'+original;
 const path=userId+'/'+objectName;
 const{data,error}=await admin.storage.from('applicant-documents').createSignedUploadUrl(path);
 if(error||!data)throw Error('upload_url_failed');
 return{path,token:data.token,signedUrl:data.signedUrl,documentType:type,filename:original,mimeType:mime,maxBytes:6291456};
}
async function registerUpload(a:any,userId:string,input:any){
 await participantAccess(a,userId);
 const path=String(input.path||'');if(!path.startsWith(userId+'/'))throw Error('invalid_document_path');
 const name=path.slice(userId.length+1);
 const folder=await admin.storage.from('applicant-documents').list(userId,{search:name,limit:10});
 if(folder.error)throw Error('upload_verify_failed');
 const obj=(folder.data||[]).find((x:any)=>x.name===name);if(!obj)throw Error('upload_not_found');
 const size=Number(obj.metadata?.size||0),mime=String(obj.metadata?.mimetype||input.mime_type||'');
 if(size<1||size>6291456||!['application/pdf','image/jpeg','image/png'].includes(mime))throw Error('upload_invalid');
 const type=String(input.document_type||'other');
 const{data,error}=await admin.from('applicant_documents').insert({
  user_id:userId,document_type:type,original_filename:clean(input.filename,180),storage_path:path,mime_type:mime,size_bytes:size,send_with_auto_apply:Boolean(input.send_with_auto_apply)
 }).select('id').single();
 if(error)throw Error('document_register_failed');
 await audit(a,userId,'document_added',{document_id:data.id,document_type:type});
 return{ok:true,id:data.id};
}
async function handle(req:Request){
 const a=await actor(req),body=await req.json().catch(()=>({})),action=String(body.action||'');
 if(action==='me')return{member:a.member,workspace:a.workspace};
 if(action==='members'){
  const{data,error}=await admin.from('coaching_members').select('id,display_name,role,is_active,created_at').eq('workspace_id',a.member.workspace_id).order('display_name');if(error)throw Error('members_read_failed');return{members:data||[]};
 }
 if(action==='participants')return{participants:await participantSummary(a)};
 if(action==='participant')return await participantDetail(a,uuid(body.userId));
 if(action==='create_participant'){
  const coachId=a.member.role==='admin'&&body.coachMemberId?uuid(body.coachMemberId):a.member.id;
  const{data,error}=await admin.rpc('coach_create_participant',{p_actor:a.member.id,p_coach:coachId,p_first_name:clean(body.first_name,120),p_last_name:clean(body.last_name,120),p_email:email(body.email),p_phone:clean(body.phone,80),p_city:clean(body.city,120)||'Hamburg',p_household_size:optionalInteger(body.household_size,1,20)});
  if(error)throw Error(error.message||'participant_create_failed');return{ok:true,userId:data};
 }
 if(action==='update_profile')return updateProfile(a,uuid(body.userId),body.profile||{});
 if(action==='save_search')return saveSearch(a,uuid(body.userId),body.profile||{});
 if(action==='delete_search'){const id=uuid(body.profileId),userId=uuid(body.userId);await participantAccess(a,userId);const{error}=await admin.from('search_profiles').delete().eq('id',id).eq('user_id',userId);if(error)throw Error('search_delete_failed');await audit(a,userId,'search_profile_deleted',{profile_id:id});return{ok:true};}
 if(action==='set_plan'){if(a.member.role!=='admin')throw Error('admin_required');const{error}=await admin.rpc('coach_set_plan',{p_actor:a.member.id,p_user:uuid(body.userId),p_plan:String(body.plan||'')});if(error)throw Error(error.message);return{ok:true};}
 if(action==='set_preferences'){
  const userId=uuid(body.userId);await participantAccess(a,userId);
  const p=body.preferences||{};
  const weekdays=Array.isArray(p.allowed_weekdays)?p.allowed_weekdays.map((x:any)=>integer(x,1,7)):null;
  const{error}=await admin.rpc('coach_set_application_preferences',{p_actor:a.member.id,p_user:userId,p_enabled:Boolean(p.enabled),p_daily_limit:optionalInteger(p.daily_limit,1,1000),p_timezone:clean(p.timezone,80)||'Europe/Berlin',p_weekdays:weekdays,p_window_start:p.send_window_start||null,p_window_end:p.send_window_end||null,p_immoscout:Boolean(p.immoscout_enabled),p_kleinanzeigen:Boolean(p.kleinanzeigen_enabled),p_immomio:Boolean(p.immomio_enabled)});
  if(error)throw Error(error.message);return{ok:true};
 }
 if(action==='reassign'){if(a.member.role!=='admin')throw Error('admin_required');const{error}=await admin.rpc('coach_reassign_participant',{p_actor:a.member.id,p_user:uuid(body.userId),p_coach:uuid(body.coachMemberId)});if(error)throw Error(error.message);return{ok:true};}
 if(action==='archive'){
  const userId=uuid(body.userId);await participantAccess(a,userId,a.member.role!=='admin');
  const next=body.archived===false?'active':'archived';
  const{error}=await admin.from('coaching_participants').update({status:next,archived_at:next==='archived'?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('workspace_id',a.member.workspace_id);if(error)throw Error('archive_failed');await audit(a,userId,next==='archived'?'participant_archived':'participant_restored');return{ok:true};
 }
 if(action==='retention'){
  const userId=uuid(body.userId);await participantAccess(a,userId);
  const mode=body.mode==='delete_on_date'?'delete_on_date':'manual',date=mode==='delete_on_date'?String(body.delete_on||''):null;
  if(mode==='delete_on_date'&&!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('invalid_retention_date');
  const{error}=await admin.from('coaching_participants').update({retention_mode:mode,retention_delete_on:date,status:mode==='delete_on_date'?'pending_deletion':'active',updated_at:new Date().toISOString()}).eq('user_id',userId);if(error)throw Error('retention_save_failed');await audit(a,userId,'retention_changed',{mode,delete_on:date});return{ok:true};
 }
 if(action==='telegram_link'){
  const userId=uuid(body.userId);await participantAccess(a,userId);
  const{data,error}=await admin.rpc('issue_telegram_link_token',{p_user:userId,p_created_by:a.user.id});if(error)throw Error(error.message||'telegram_link_failed');
  return{url:'https://t.me/traumwohnunghamburgbot?start='+encodeURIComponent(String(data)),expiresInSeconds:1200};
 }
 if(action==='start_connect'){const userId=uuid(body.userId),p=provider(body.provider);return startConnect(a,userId,p);}
 if(action==='disconnect_provider'){const userId=uuid(body.userId),p=provider(body.provider);await participantAccess(a,userId);const result=await providerDisconnect(userId,p);await admin.from('application_preferences').update({[p+'_enabled']:false}).eq('user_id',userId);await audit(a,userId,'provider_disconnected',{provider:p});return{ok:true,result};}
 if(action==='request_upload')return requestUpload(a,uuid(body.userId),body);
 if(action==='register_upload')return registerUpload(a,uuid(body.userId),body);
 if(action==='toggle_document'){const userId=uuid(body.userId),id=uuid(body.documentId);await participantAccess(a,userId);const{error}=await admin.from('applicant_documents').update({send_with_auto_apply:Boolean(body.enabled),updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',userId);if(error)throw Error('document_update_failed');await audit(a,userId,'document_permission_changed',{document_id:id,enabled:Boolean(body.enabled)});return{ok:true};}
 if(action==='delete_document'){const userId=uuid(body.userId),id=uuid(body.documentId);await participantAccess(a,userId);const{data,error}=await admin.from('applicant_documents').select('storage_path').eq('id',id).eq('user_id',userId).maybeSingle();if(error||!data)throw Error('document_not_found');await admin.storage.from('applicant-documents').remove([data.storage_path]);const del=await admin.from('applicant_documents').delete().eq('id',id).eq('user_id',userId);if(del.error)throw Error('document_delete_failed');await audit(a,userId,'document_deleted',{document_id:id});return{ok:true};}
 if(action==='application_events'){const userId=uuid(body.userId),appId=uuid(body.applicationId);await participantAccess(a,userId);const{data,error}=await admin.from('application_events').select('*').eq('application_id',appId).eq('user_id',userId).order('created_at');if(error)throw Error('events_read_failed');return{events:data||[]};}
 if(action==='dashboard'){
  const participants=await participantSummary(a),ids=participants.map((x:any)=>x.user_id);
  if(!ids.length)return{participants:0,applications:{sent:0,failed:0,pending:0,total:0},providers:{}};
  const{data:apps,error}=await admin.from('applications').select('status,user_id,listings(sources(name))').in('user_id',ids);if(error)throw Error('dashboard_read_failed');
  const counts:any={sent:0,failed:0,pending:0,total:0};for(const x of apps||[]){counts.total++;if(x.status==='sent')counts.sent++;else if(x.status==='failed'||x.status==='manual_required')counts.failed++;else counts.pending++}
  return{participants:participants.length,applications:counts};
 }
 if(action==='create_coach'){
  if(a.member.role!=='admin')throw Error('admin_required');
  const e=email(body.email),password=String(body.password||'');if(password.length<12)throw Error('password_too_short');
  const{data:created,error}=await admin.auth.admin.createUser({email:e,password,email_confirm:true});if(error||!created.user)throw Error(error?.message||'coach_auth_create_failed');
  const{data:member,error:me}=await admin.from('coaching_members').insert({auth_user_id:created.user.id,workspace_id:a.member.workspace_id,display_name:clean(body.display_name,120)||e,role:'coach',is_active:true}).select('id,display_name,role').single();
  if(me){await admin.auth.admin.deleteUser(created.user.id).catch(()=>{});throw Error('coach_member_create_failed');}
  await audit(a,null,'coach_created',{member_id:member.id});return{ok:true,member};
 }
 if(action==='set_coach_active'){
  if(a.member.role!=='admin')throw Error('admin_required');const id=uuid(body.memberId);if(id===a.member.id&&!body.active)throw Error('cannot_disable_self');
  const{error}=await admin.from('coaching_members').update({is_active:Boolean(body.active),updated_at:new Date().toISOString()}).eq('id',id).eq('workspace_id',a.member.workspace_id).eq('role','coach');if(error)throw Error('coach_update_failed');await audit(a,null,'coach_status_changed',{member_id:id,active:Boolean(body.active)});return{ok:true};
 }
 throw Error('invalid_action');
}
function publicError(error:any){const code=String(error?.message||'coach_api_failed').slice(0,160);const known=new Set(['unauthorized','coach_forbidden','workspace_unavailable','participant_forbidden','admin_required','invalid_id','invalid_email','invalid_number','provider_unsupported','invalid_property_type','invalid_location','invalid_search_limits','location_required','invalid_document','invalid_document_type','invalid_document_path','upload_not_found','upload_invalid','invalid_retention_date','password_too_short','cannot_disable_self','premium_required']);return known.has(code)?code:(code.includes('profile_slot_not_allowed')?'profile_slot_not_allowed':'operation_failed');}

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors(req)});
 if(req.method==='GET')return json(req,{ok:true,service:'coach-api',version:1});
 if(req.method!=='POST')return new Response('method not allowed',{status:405,headers:cors(req)});
 try{return json(req,await handle(req));}
 catch(error:any){console.error('coach_api',String(error));const code=publicError(error),status=code==='unauthorized'?401:['coach_forbidden','participant_forbidden','admin_required','workspace_unavailable'].includes(code)?403:400;return json(req,{error:code},status);}
});
