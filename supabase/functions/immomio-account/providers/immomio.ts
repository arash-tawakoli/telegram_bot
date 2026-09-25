// @ts-nocheck
import {saveConnection,getConnection,markConnection,deleteConnection} from '../credentials.ts';
const APPLY=/^https:\/\/tenant\.immomio\.com\/apply\/[0-9a-f-]{36}\/?(?:[?#].*)?$/i;
const GQL='https://gql-ps.immomio.com/tenant/graphql',TENANT_ORIGIN='https://tenant.immomio.com',OAUTH_REDIRECT='https://tenant.immomio.com/de/auth/login',EXPECTED_KEYCLOAK_HOST='sso.immomio.com',EXPECTED_REALM='immomio',EXPECTED_CLIENT_ID='immomio-oidc-web',LOGIN_METHOD='DEFAULT';
const BASE_HEADERS={'content-type':'application/json','accept':'application/json','origin':TENANT_ORIGIN,'referer':`${TENANT_ORIGIN}/`,'user-agent':'TraumWohnungHamburg/1.0'};
const FILE_UPLOAD='https://gql-ps.immomio.com/tenant/fileUpload';
const USER_PROFILE_QUERY=`query currentUserProfile { user { id address { street houseNumber city country region zipCode } profile } }`;
const SAVE_USER_MUTATION=`mutation saveUser($user: PropertySearcherUserInput!) { saveUser(user: $user) { id profile profileCompleteness } }`;
const DOCUMENT_TYPE_MAP:Record<string,string>={
  wbs:'WB_CERTIFICATE',
  schufa:'CREDIT_REPORT',
  income_proof:'INCOME_STATEMENT',
  urgency_certificate:'SHARED_DOCUMENT',
  guarantee:'SHARED_DOCUMENT',
  rent_clearance:'SHARED_DOCUMENT',
  other:'SHARED_DOCUMENT'
};
const SSO_QUERY=`query sso($email: String, $redirectUri: String!, $loginMethod: String) { sso(input: { email: $email redirectUri: $redirectUri loginMethod: $loginMethod }) { baseUrl clientId realm } }`,USER_QUERY=`query currentUser { user { id email } }`,PROPERTY_QUERY=`query propertyBySourceIdentifier($sourceIdentifier: ID!) { propertyBySourceIdentifier(sourceIdentifier: $sourceIdentifier) { id smsVerificationRequired captchaSettings { siteKey applicationSubmissionActive } } }`,QUESTIONS_QUERY=`query applicationQuestions($id: ID!) { customQuestionsByProperty(id: $id) { customQuestions { key type subType title options commentHint } questions { __typename } } }`,CHECK_APPLICATION_QUERY=`query checkApplicationExist($propertyId: ID!) { checkApplicationExist(propertyId: $propertyId) { id smsVerificationRequired } }`,CREATE_APPLICATION_MUTATION=`mutation createApplication($userId: ID!, $propertyId: ID!, $captchaResponse: String) { createApplication(userId: $userId propertyId: $propertyId captchaResponse: $captchaResponse) { id status customerIdent property { customer { customQuestionAllowed } } } }`,APPLICATION_QUERY=`query propertyApplyProcessPSBean($id: ID!) { propertyApplyProcessPSBean(id: $id) { id type status hasQuestions hasUnansweredQuestions smsVerificationRequired customerId captchaSettings { siteKey applicationSubmissionActive } } }`;
const enc=new TextEncoder(),b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')},random=()=>b64url(crypto.getRandomValues(new Uint8Array(32))),clean=(v:any,max=320)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max),sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function challenge(v:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(v))))}function validEmail(v:any){const e=clean(v,320).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null}function authError(b:any){return Array.isArray(b?.errors)&&b.errors.some((e:any)=>Number(e?.extra?.status)===401||Number(e?.extra?.status)===403||/unauthor|token validation/i.test(String(e?.message||'')))}function networkStatus(s:number){return s===429||s>=500}
export function immomioApplicationLink(l:any){for(const value of[l?.raw?.applicationLink,l?.raw?.application_link,l?.raw?.applicationUrl,l?.raw?.application_url]){const u=String(value||'').trim();if(APPLY.test(u))return u}return null}function sourceIdentifier(l:any){const u=immomioApplicationLink(l);if(!u)return null;try{return new URL(u).pathname.split('/').filter(Boolean).pop()||null}catch{return null}}
async function rawGraphql(query:string,variables:any,token?:string){const headers:any={...BASE_HEADERS};if(token)headers.authorization=token;try{const response=await fetch(GQL,{method:'POST',headers,body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
async function resolveSso(email:string){const r=await rawGraphql(SSO_QUERY,{email,redirectUri:OAUTH_REDIRECT,loginMethod:LOGIN_METHOD});if(networkStatus(r.response.status))throw Error('temporary_network_error');const s=r.body?.data?.sso;if(!r.response.ok||r.body?.errors?.length||!s)throw Error('immomio_sso_failed');let b;try{b=new URL(String(s.baseUrl||''))}catch{throw Error('immomio_sso_contract_changed')}if(b.protocol!=='https:'||b.hostname!==EXPECTED_KEYCLOAK_HOST||String(s.realm)!==EXPECTED_REALM||String(s.clientId)!==EXPECTED_CLIENT_ID)throw Error('immomio_sso_contract_changed');return{baseUrl:`https://${EXPECTED_KEYCLOAK_HOST}/auth`,realm:EXPECTED_REALM,clientId:EXPECTED_CLIENT_ID}}
function tokenEndpoint(c:any){return`${c.baseUrl}/realms/${encodeURIComponent(c.realm)}/protocol/openid-connect/token`}async function tokenRequest(c:any,p:Record<string,string>){try{const response=await fetch(tokenEndpoint(c),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:new URLSearchParams({...p,client_id:c.clientId}),signal:AbortSignal.timeout(25000)}),token=await response.json().catch(()=>null);return{response,token}}catch{throw Error('temporary_network_error')}}function decodeEmail(t:any){try{const p=String(t||'').split('.')[1];if(!p)return null;return validEmail(JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=')))?.email)}catch{return null}}
export async function beginImmomioLogin(db:any,userId:string,emailValue:any){const email=validEmail(emailValue);if(!email)throw Error('immomio_email_required');const c=await resolveSso(email);await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','immomio').is('consumed_at',null);const verifier=random(),state=random().slice(0,40),cc=await challenge(verifier),{error}=await db.from('platform_auth_flows').insert({user_id:userId,provider:'immomio',state,code_verifier:verifier});if(error)throw Error('auth_flow_create_failed');await markConnection(db,userId,'immomio','pending',null,{account_hint:email});const url=new URL(`${c.baseUrl}/realms/${encodeURIComponent(c.realm)}/protocol/openid-connect/auth`);for(const[k,v]of Object.entries({client_id:c.clientId,redirect_uri:OAUTH_REDIRECT,response_type:'code',scope:'openid profile email',state,code_challenge:cc,code_challenge_method:'S256',login_hint:email,prompt:'login'}))url.searchParams.set(k,String(v));return{status:'login',url:url.href,requiresCallback:false,automaticCallback:true,bridgeRequired:true,transport:'telegram-share-bridge',expiresInSeconds:600}}
function validateCallbackUrl(v:string){let u;try{u=new URL(String(v||'').trim())}catch{throw Error('invalid_callback_url')}if(u.protocol!=='https:'||u.hostname!=='tenant.immomio.com'||u.port||u.username||u.password||u.pathname!=='/de/auth/login')throw Error('invalid_callback_url');return u}
export async function completeImmomioLogin(db:any,userId:string,callbackUrl:string){const u=validateCallbackUrl(callbackUrl),state=u.searchParams.get('state'),code=u.searchParams.get('code');if(!state||!code)throw Error('invalid_callback_url');const{data:flow,error}=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider','immomio').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();if(error||!flow)throw Error('auth_flow_expired');const{data:p}=await db.from('applicant_profiles').select('email').eq('user_id',userId).maybeSingle(),email=validEmail(p?.email);if(!email)throw Error('immomio_email_required');const c=await resolveSso(email),{response,token}=await tokenRequest(c,{grant_type:'authorization_code',code,redirect_uri:OAUTH_REDIRECT,code_verifier:String(flow.code_verifier||'')});if(!response.ok||!token?.access_token||!token?.refresh_token){await markConnection(db,userId,'immomio','needs_login','token_exchange_failed').catch(()=>{});throw Error('token_exchange_failed')}const expiresAt=new Date(Date.now()+Math.max(60,Number(token.expires_in||300))*1000).toISOString(),hint=decodeEmail(token.id_token)||email;await saveConnection(db,userId,'immomio',{access_token:String(token.access_token),refresh_token:String(token.refresh_token),expires_at:expiresAt,base_url:c.baseUrl,realm:c.realm,client_id:c.clientId,redirect_uri:OAUTH_REDIRECT},{account_hint:hint,expires_at:expiresAt});await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.id);const a=await immomioAccount(db,userId);return{status:'connected',authenticated:true,userId:String(flow.user_id),accountReady:!!a.id}}
async function refresh(db:any,userId:string,c:any){const x=c?.credentials||{};if(x.access_token&&Date.parse(x.expires_at||'')>Date.now()+60000)return x;if(!x.refresh_token)throw Error('needs_login');const cfg={baseUrl:String(x.base_url||`https://${EXPECTED_KEYCLOAK_HOST}/auth`),realm:String(x.realm||EXPECTED_REALM),clientId:String(x.client_id||EXPECTED_CLIENT_ID)},{response,token}=await tokenRequest(cfg,{grant_type:'refresh_token',refresh_token:String(x.refresh_token)});if(!response.ok||!token?.access_token){await markConnection(db,userId,'immomio','needs_login','refresh_failed').catch(()=>{});throw Error('needs_login')}const updated={...x,access_token:String(token.access_token),refresh_token:String(token.refresh_token||x.refresh_token),expires_at:new Date(Date.now()+Math.max(60,Number(token.expires_in||300))*1000).toISOString()};await saveConnection(db,userId,'immomio',updated,{account_hint:c.row.account_hint,expires_at:updated.expires_at});return updated}
async function session(db:any,userId:string){const c=await getConnection(db,userId,'immomio');if(!c)throw Error('needs_login');return{token:String((await refresh(db,userId,c)).access_token)}}async function authedGraphql(db:any,userId:string,q:string,v:any={}){const s=await session(db,userId),r=await rawGraphql(q,v,s.token);if(r.response.status===401||r.response.status===403||authError(r.body)){await markConnection(db,userId,'immomio','needs_login','graphql_auth_failed').catch(()=>{});throw Error('needs_login')}if(networkStatus(r.response.status))throw Error('temporary_network_error');return r}

function documentTypeFor(row:any){return DOCUMENT_TYPE_MAP[String(row?.document_type||'')]||'SHARED_DOCUMENT'}
function sameRemoteDocument(a:any,b:any){
 const ai=clean(a?.identifier,200),bi=clean(b?.identifier,200);
 if(ai&&bi)return ai===bi;
 return clean(a?.title,180).toLowerCase()===clean(b?.title,180).toLowerCase()
   && clean(a?.type||a?.documentType,80)===clean(b?.type||b?.documentType,80);
}
async function currentImmomioProfile(db:any,userId:string){
 const r=await authedGraphql(db,userId,USER_PROFILE_QUERY,{});
 const u=r.body?.data?.user;
 if(!r.response.ok||r.body?.errors?.length||!u?.id||!u?.profile)throw Error('provider_contract_unverified');
 return u;
}
async function uploadImmomioDocument(db:any,userId:string,row:any){
 const {data:file,error}=await db.storage.from('applicant-documents').download(String(row.storage_path||''));
 if(error||!file)throw Error('document_download_failed');
 const s=await session(db,userId),form=new FormData(),filename=clean(row.original_filename,180)||'document.pdf',fileType=documentTypeFor(row);
 form.append('files',file,filename);
 form.append('filesType',fileType);
 form.append('rotations','[]');
 let response:Response,body:any=null;
 try{
  response=await fetch(FILE_UPLOAD,{method:'POST',headers:{authorization:s.token,'ngsw-bypass':'true',origin:TENANT_ORIGIN,referer:`${TENANT_ORIGIN}/`,'user-agent':'TraumWohnungHamburg/1.0'},body:form,signal:AbortSignal.timeout(30000)});
  body=await response.json().catch(()=>null);
 }catch{throw Error('temporary_network_error')}
 if(response.status===401||response.status===403){await markConnection(db,userId,'immomio','needs_login','document_upload_auth_failed').catch(()=>{});throw Error('needs_login')}
 if(networkStatus(response.status))throw Error('temporary_network_error');
 const remote=Array.isArray(body)?body[0]:null;
 if(!response.ok||!remote?.identifier)throw Error('document_transfer_failed');
 return {...remote,title:remote.title||filename,type:remote.type||fileType,documentType:remote.documentType||fileType};
}
export async function syncImmomioDocuments(db:any,userId:string){
 const {data:docs,error:docsError}=await db.from('applicant_documents')
  .select('id,document_type,original_filename,storage_path,mime_type,size_bytes,send_with_auto_apply,updated_at,created_at')
  .eq('user_id',userId).eq('send_with_auto_apply',true).order('created_at',{ascending:true});
 if(docsError)throw Error('application_documents_read_failed');

 const [u,cacheResult]=await Promise.all([
  currentImmomioProfile(db,userId),
  db.from('application_document_transfers')
   .select('id,document_id,source_updated_at,remote_identifier,remote_payload,adopted_existing')
   .eq('user_id',userId).eq('provider','immomio')
 ]);
 if(cacheResult.error)throw Error('document_transfer_cache_failed');

 const selected=docs||[],current=Array.isArray(u.profile?.attachments)?u.profile.attachments:[],
  selectedById=new Map(selected.map((d:any)=>[String(d.id),d])),
  cached=cacheResult.data||[];

 const stale=cached.filter((row:any)=>{
  if(row.adopted_existing===true)return false;
  const id=row.document_id?String(row.document_id):'';
  if(!id)return true;
  const source=selectedById.get(id);
  return !source||String(row.source_updated_at)!==String(source.updated_at);
 });
 const staleRemote=stale.map((x:any)=>x.remote_payload).filter((x:any)=>x&&typeof x==='object');
 const filteredCurrent=current.filter((remote:any)=>!staleRemote.some((old:any)=>sameRemoteDocument(remote,old)));
 const removed=current.length-filteredCurrent.length;

 const activeCache=cached.filter((row:any)=>{
  const id=row.document_id?String(row.document_id):'';
  const source=id?selectedById.get(id):null;
  return !!source&&String(row.source_updated_at)===String(source.updated_at);
 });
 const byDoc=new Map(activeCache.map((x:any)=>[String(x.document_id),x]));
 const desired:any[]=[];let uploaded=0,reused=0,added=0;

 for(const row of selected){
  const key=String(row.id),type=documentTypeFor(row),cachedRow=byDoc.get(key);
  let remote:any=null,adopted=false;
  if(cachedRow?.remote_payload?.identifier){
   const candidate=cachedRow.remote_payload;
   if(filteredCurrent.some((x:any)=>sameRemoteDocument(x,candidate))){remote=candidate;reused++}
  }
  if(!remote){
   const filename=clean(row.original_filename,180).toLowerCase();
   const existing=filteredCurrent.find((x:any)=>
    clean(x?.title,180).toLowerCase()===filename&&
    clean(x?.type||x?.documentType,80)===type
   );
   if(existing){remote=existing;adopted=true;reused++}
  }
  if(!remote){remote=await uploadImmomioDocument(db,userId,row);uploaded++}

  const {error:upsertError}=await db.from('application_document_transfers').upsert({
   user_id:userId,document_id:row.id,provider:'immomio',source_updated_at:row.updated_at,
   remote_identifier:clean(remote?.identifier,240)||null,remote_payload:remote,
   adopted_existing:adopted,synced_at:new Date().toISOString(),updated_at:new Date().toISOString()
  },{onConflict:'document_id,provider'});
  if(upsertError)throw Error('document_transfer_cache_failed');
  desired.push(remote);
 }

 const merged=[...filteredCurrent];
 for(const remote of desired){
  if(!merged.some((x:any)=>sameRemoteDocument(x,remote))){merged.push(remote);added++}
 }
 if(removed>0||added>0){
  const input={id:u.id,address:u.address,profile:{...u.profile,attachments:merged}};
  const saved=await authedGraphql(db,userId,SAVE_USER_MUTATION,{user:input});
  if(!saved.response.ok||saved.body?.errors?.length||!saved.body?.data?.saveUser?.id)throw Error('document_profile_save_failed');
 }

 const verify=await currentImmomioProfile(db,userId),
  attachments=Array.isArray(verify.profile?.attachments)?verify.profile.attachments:[],
  missing=desired.filter((remote:any)=>!attachments.some((x:any)=>sameRemoteDocument(x,remote))),
  staleStillPresent=staleRemote.filter((remote:any)=>attachments.some((x:any)=>sameRemoteDocument(x,remote)));
 if(missing.length||staleStillPresent.length)throw Error('document_transfer_unverified');

 const staleIds=stale.map((x:any)=>String(x.id)).filter(Boolean);
 if(staleIds.length){
  const {error:deleteError}=await db.from('application_document_transfers').delete().in('id',staleIds);
  if(deleteError)throw Error('document_transfer_cache_failed');
 }
 return{selected:selected.length,uploaded,reused,removed,verified:true};
}
export async function immomioAccount(db:any,userId:string){const r=await authedGraphql(db,userId,USER_QUERY,{}),u=r.body?.data?.user;if(!r.response.ok||r.body?.errors?.length||!u?.id)throw Error('provider_contract_unverified');return{id:String(u.id),email:validEmail(u.email)}}export async function checkImmomioConnection(db:any,userId:string){const c=await getConnection(db,userId,'immomio');if(!c)return{authenticated:false,status:'disconnected'};try{const a=await immomioAccount(db,userId);return{authenticated:true,status:'connected',accountReady:!!a.id}}catch(e:any){return{authenticated:false,status:e?.message==='needs_login'?'needs_login':c.row?.status==='pending'?'pending':'error'}}}export async function disconnectImmomio(db:any,userId:string){await deleteConnection(db,userId,'immomio');await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','immomio');return{status:'disconnected'}}
async function propertyForListing(db:any,userId:string,l:any){const sid=sourceIdentifier(l);if(!sid)return{error:'application_link_missing'};const r=await authedGraphql(db,userId,PROPERTY_QUERY,{sourceIdentifier:sid});if(!r.response.ok||r.body?.errors?.length)return{error:'provider_contract_unverified'};const p=r.body?.data?.propertyBySourceIdentifier;if(!p)return{error:'listing_unavailable'};return{property:p,sourceIdentifier:sid}}async function questionState(db:any,userId:string,pid:string){const r=await authedGraphql(db,userId,QUESTIONS_QUERY,{id:pid});if(!r.response.ok||r.body?.errors?.length)return{error:'question_contract_unverified',customCount:0,hierarchicalCount:0};const d=r.body?.data?.customQuestionsByProperty||{};return{customCount:Array.isArray(d.customQuestions)?d.customQuestions.length:0,hierarchicalCount:Array.isArray(d.questions)?d.questions.length:0}}async function existingApplication(db:any,userId:string,pid:string){const r=await authedGraphql(db,userId,CHECK_APPLICATION_QUERY,{propertyId:pid});if(!r.response.ok||r.body?.errors?.length)return{error:'application_check_failed'};return r.body?.data?.checkApplicationExist||{id:null,smsVerificationRequired:false}}
async function prepareAccountApplication(db:any,userId:string,l:any){const a=await immomioAccount(db,userId),x=await propertyForListing(db,userId,l);if(x.error)return{ready:false,error:x.error};const p=x.property,pid=String(p.id||'');if(!pid)return{ready:false,error:'provider_contract_unverified'};const e=await existingApplication(db,userId,pid);if(e.error)return{ready:false,error:e.error};if(e.id)return{ready:false,error:'already_applied',alreadyApplied:true,applicationId:String(e.id)};if(e.smsVerificationRequired===true||p.smsVerificationRequired===true)return{ready:false,error:'sms_verification_required'};if(p?.captchaSettings?.applicationSubmissionActive===true&&clean(p?.captchaSettings?.siteKey,500))return{ready:false,error:'captcha_required'};const q=await questionState(db,userId,pid);if(q.error)return{ready:false,error:q.error};if(q.customCount)return{ready:false,error:'dynamic_questions_required',customQuestionCount:q.customCount,hierarchicalQuestionCount:q.hierarchicalCount};return{ready:true,mode:'account',accountId:a.id,propertyId:pid,sourceIdentifier:x.sourceIdentifier,captchaRequired:false,smsVerificationRequired:false,dynamicQuestions:q.hierarchicalCount>0,hierarchicalQuestionCount:q.hierarchicalCount}}
export async function inspectImmomioAccountApplication(input:any){const{db,user,listing}=input||{},uid=String(user?.id||'');if(!db||!uid||!listing)return{available:false,ready:false,error:'provider_contract_unverified'};try{const p=await prepareAccountApplication(db,uid,listing);return{available:p.error!=='listing_unavailable'&&p.error!=='application_link_missing',...p}}catch(e:any){return{available:true,ready:false,error:e?.message==='needs_login'?'needs_login':e?.message==='temporary_network_error'?'temporary_network_error':'provider_contract_unverified'}}}
async function verifyApplication(db:any,uid:string,pid:string,aid:string){for(const delay of[500,900,1600,2600,4200]){await sleep(delay);const e=await existingApplication(db,uid,pid);if(e?.id&&String(e.id)===aid){const d=await authedGraphql(db,uid,APPLICATION_QUERY,{id:aid});if(d.response.ok&&!d.body?.errors?.length){const row=d.body?.data?.propertyApplyProcessPSBean;if(row?.id&&String(row.id)===aid)return{verified:true,row}}return{verified:true,row:null}}}return{verified:false,row:null}}
export async function sendImmomioApplication(input:any){const{db,user,listing,authorize}=input||{},uid=String(user?.id||'');if(!db||!uid||!listing)return{success:false,status:'manual_required',error:'provider_contract_unverified'};let p;try{p=await prepareAccountApplication(db,uid,listing)}catch(e:any){if(e?.message==='temporary_network_error')throw e;return{success:false,status:'manual_required',error:e?.message==='needs_login'?'needs_login':'provider_contract_unverified'}}if(!p.ready)return{success:false,status:'manual_required',error:p.error||'provider_contract_unverified'};let documentTransfer:any={selected:0,uploaded:0,reused:0,verified:true};try{documentTransfer=await syncImmomioDocuments(db,uid)}catch(e:any){if(e?.message==='temporary_network_error')throw e;return{success:false,status:'manual_required',error:e?.message==='needs_login'?'needs_login':String(e?.message||'document_transfer_failed').slice(0,120)}}if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'failed',error:'send_not_authorized'};let r;try{r=await authedGraphql(db,uid,CREATE_APPLICATION_MUTATION,{userId:p.accountId,propertyId:p.propertyId,captchaResponse:null})}catch(e:any){return{success:false,status:'manual_required',error:e?.message==='needs_login'?'needs_login':'submission_unconfirmed'}}if(!r.response.ok||r.body?.errors?.length)return{success:false,status:'manual_required',error:'submission_unconfirmed'};const created=r.body?.data?.createApplication,aid=clean(created?.id,200);if(!aid)return{success:false,status:'manual_required',error:'submission_unconfirmed'};const v=await verifyApplication(db,uid,p.propertyId,aid);if(!v.verified)return{success:false,status:'manual_required',error:'submission_unconfirmed',applicationId:aid};const followUp=v.row?.smsVerificationRequired===true?'sms_verification':(v.row?.hasUnansweredQuestions===true||v.row?.hasQuestions===true?'questions':null);return{success:true,status:'sent',error:null,applicationId:aid,providerStatus:v.row?.status||created?.status||null,followUpRequired:followUp,hasQuestions:v.row?.hasQuestions??null,hasUnansweredQuestions:v.row?.hasUnansweredQuestions??null,smsVerificationRequired:v.row?.smsVerificationRequired??false,hierarchicalQuestionCount:p.hierarchicalQuestionCount||0,documentTransfer}}
