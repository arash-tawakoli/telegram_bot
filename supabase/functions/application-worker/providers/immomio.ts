import {saveConnection,getConnection,markConnection,deleteConnection} from '../credentials.ts';

const APPLY=/^https:\/\/tenant\.immomio\.com\/apply\/[0-9a-f-]{36}\/?(?:[?#].*)?$/i;
const GQL='https://gql-ps.immomio.com/tenant/graphql';
const TENANT_ORIGIN='https://tenant.immomio.com';
const OAUTH_REDIRECT='https://tenant.immomio.com/assets/manifest.webmanifest';
const EXPECTED_KEYCLOAK_HOST='sso.immomio.com';
const EXPECTED_REALM='immomio';
const EXPECTED_CLIENT_ID='immomio-oidc-web';
const LOGIN_METHOD='DEFAULT';
const BASE_HEADERS={'content-type':'application/json','accept':'application/json','origin':TENANT_ORIGIN,'referer':`${TENANT_ORIGIN}/`,'user-agent':'TraumWohnungHamburg/1.0'};
const SSO_QUERY=`query sso($email: String, $redirectUri: String!, $loginMethod: String) { sso(input: { email: $email redirectUri: $redirectUri loginMethod: $loginMethod }) { baseUrl clientId realm } }`;
const USER_QUERY=`query currentUser { user { id email } }`;
const PROPERTY_QUERY=`query propertyBySourceIdentifier($sourceIdentifier: ID!) { propertyBySourceIdentifier(sourceIdentifier: $sourceIdentifier) { id rented smsVerificationRequired wbs captchaSettings { siteKey whitelabelRegistrationProcessActive applicationSubmissionActive appointmentBookingActive } customer { id name customQuestionAllowed } } }`;
const QUESTIONS_QUERY=`query applicationQuestions($id: ID!) { customQuestionsByProperty(id: $id) { customQuestions { key type subType title options commentHint } questions { __typename } } }`;
const CHECK_APPLICATION_QUERY=`query checkApplicationExist($propertyId: ID!) { checkApplicationExist(propertyId: $propertyId) { id smsVerificationRequired } }`;
const CREATE_APPLICATION_MUTATION=`mutation createApplication($userId: ID!, $propertyId: ID!, $captchaResponse: String) { createApplication(userId: $userId propertyId: $propertyId captchaResponse: $captchaResponse) { id status customerIdent property { customer { customQuestionAllowed } } } }`;
const APPLICATION_QUERY=`query propertyApplyProcessPSBean($id: ID!) { propertyApplyProcessPSBean(id: $id) { id type status hasQuestions hasUnansweredQuestions smsVerificationRequired customerId captchaSettings { siteKey applicationSubmissionActive } } }`;

const enc=new TextEncoder();
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const clean=(v:any,max=320)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function challenge(verifier:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))}

export function immomioApplicationLink(listing:any){
 const candidates=[listing?.raw?.applicationLink,listing?.raw?.application_link,listing?.raw?.applicationUrl,listing?.raw?.application_url];
 for(const value of candidates){const url=String(value||'').trim();if(APPLY.test(url))return url;}
 return null;
}
function sourceIdentifier(listing:any){const url=immomioApplicationLink(listing);if(!url)return null;try{return new URL(url).pathname.split('/').filter(Boolean).pop()||null}catch{return null}}
function validEmail(value:any){const email=clean(value,320).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null}
function authError(body:any){return Array.isArray(body?.errors)&&body.errors.some((e:any)=>Number(e?.extra?.status)===401||Number(e?.extra?.status)===403||/unauthor|token validation/i.test(String(e?.message||'')))}
function networkStatus(status:number){return status===429||status>=500}

async function rawGraphql(query:string,variables:any,token?:string){
 const headers:any={...BASE_HEADERS};if(token)headers.authorization=`Bearer ${token}`;
 try{
  const response=await fetch(GQL,{method:'POST',headers,body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)});
  const body=await response.json().catch(()=>null);
  return{response,body};
 }catch(error:any){if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('temporary_network_error');throw Error('temporary_network_error')}
}

async function resolveSso(email:string){
 const result=await rawGraphql(SSO_QUERY,{email,redirectUri:OAUTH_REDIRECT,loginMethod:LOGIN_METHOD});
 if(networkStatus(result.response.status))throw Error('temporary_network_error');
 const sso=result.body?.data?.sso;if(!result.response.ok||result.body?.errors?.length||!sso)throw Error('immomio_sso_failed');
 let base:URL;try{base=new URL(String(sso.baseUrl||''))}catch{throw Error('immomio_sso_contract_changed')}
 if(base.protocol!=='https:'||base.hostname!==EXPECTED_KEYCLOAK_HOST||String(sso.realm)!==EXPECTED_REALM||String(sso.clientId)!==EXPECTED_CLIENT_ID)throw Error('immomio_sso_contract_changed');
 return{baseUrl:`https://${EXPECTED_KEYCLOAK_HOST}/auth`,realm:EXPECTED_REALM,clientId:EXPECTED_CLIENT_ID};
}
function authEndpoint(config:any){return `${config.baseUrl}/realms/${encodeURIComponent(config.realm)}/protocol/openid-connect/auth`}
function tokenEndpoint(config:any){return `${config.baseUrl}/realms/${encodeURIComponent(config.realm)}/protocol/openid-connect/token`}
async function tokenRequest(config:any,payload:Record<string,string>){
 const body=new URLSearchParams({...payload,client_id:config.clientId});
 try{
  const response=await fetch(tokenEndpoint(config),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body,signal:AbortSignal.timeout(25000)});
  const token=await response.json().catch(()=>null);return{response,token};
 }catch(error:any){if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('temporary_network_error');throw Error('temporary_network_error')}
}
function decodeEmail(idToken:any){try{const part=String(idToken||'').split('.')[1];if(!part)return null;const json=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=')));return validEmail(json?.email)}catch{return null}}

export async function beginImmomioLogin(db:any,userId:string,emailValue:any){
 const email=validEmail(emailValue);if(!email)throw Error('immomio_email_required');
 const config=await resolveSso(email);
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','immomio').is('consumed_at',null);
 const verifier=random(),state=random().slice(0,40),codeChallenge=await challenge(verifier);
 const {error}=await db.from('platform_auth_flows').insert({user_id:userId,provider:'immomio',state,code_verifier:verifier});if(error)throw Error('auth_flow_create_failed');
 await markConnection(db,userId,'immomio','pending',null,{account_hint:email});
 const url=new URL(authEndpoint(config));
 for(const[k,v] of Object.entries({client_id:config.clientId,redirect_uri:OAUTH_REDIRECT,response_type:'code',scope:'openid profile email',state,code_challenge:codeChallenge,code_challenge_method:'S256',login_hint:email,prompt:'login'}))url.searchParams.set(k,String(v));
 return{status:'login',url:url.href,requiresCallback:true,automaticCallback:false,callbackMode:'copy_final_url',expiresInSeconds:600};
}
function validateCallbackUrl(value:string){
 let url:URL;try{url=new URL(String(value||'').trim())}catch{throw Error('invalid_callback_url')}
 if(url.protocol!=='https:'||url.hostname!=='tenant.immomio.com'||url.port||url.username||url.password||url.pathname!=='/assets/manifest.webmanifest')throw Error('invalid_callback_url');
 return url;
}
export async function completeImmomioLogin(db:any,userId:string,callbackUrl:string){
 const url=validateCallbackUrl(callbackUrl),state=url.searchParams.get('state'),code=url.searchParams.get('code');if(!state||!code)throw Error('invalid_callback_url');
 const {data:flow,error}=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider','immomio').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();if(error||!flow)throw Error('auth_flow_expired');
 const {data:profile}=await db.from('applicant_profiles').select('email').eq('user_id',userId).maybeSingle();const email=validEmail(profile?.email);if(!email)throw Error('immomio_email_required');
 const config=await resolveSso(email);
 const {response,token}=await tokenRequest(config,{grant_type:'authorization_code',code,redirect_uri:OAUTH_REDIRECT,code_verifier:String(flow.code_verifier||'')});
 if(!response.ok||!token?.access_token||!token?.refresh_token){await markConnection(db,userId,'immomio','needs_login','token_exchange_failed').catch(()=>{});throw Error('token_exchange_failed')}
 const expiresAt=new Date(Date.now()+Math.max(60,Number(token.expires_in||300))*1000).toISOString();const accountHint=decodeEmail(token.id_token)||email;
 await saveConnection(db,userId,'immomio',{access_token:String(token.access_token),refresh_token:String(token.refresh_token),expires_at:expiresAt,base_url:config.baseUrl,realm:config.realm,client_id:config.clientId,redirect_uri:OAUTH_REDIRECT},{account_hint:accountHint,expires_at:expiresAt});
 await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.id);
 const account=await immomioAccount(db,userId);
 return{status:'connected',authenticated:true,userId:String(flow.user_id),accountReady:!!account.id};
}
async function refresh(db:any,userId:string,connection:any){
 const credentials=connection?.credentials||{};if(credentials.access_token&&Date.parse(credentials.expires_at||'')>Date.now()+60000)return credentials;if(!credentials.refresh_token)throw Error('needs_login');
 const config={baseUrl:String(credentials.base_url||`https://${EXPECTED_KEYCLOAK_HOST}/auth`),realm:String(credentials.realm||EXPECTED_REALM),clientId:String(credentials.client_id||EXPECTED_CLIENT_ID)};
 const {response,token}=await tokenRequest(config,{grant_type:'refresh_token',refresh_token:String(credentials.refresh_token)});
 if(!response.ok||!token?.access_token){await markConnection(db,userId,'immomio','needs_login','refresh_failed').catch(()=>{});throw Error('needs_login')}
 const updated={...credentials,access_token:String(token.access_token),refresh_token:String(token.refresh_token||credentials.refresh_token),expires_at:new Date(Date.now()+Math.max(60,Number(token.expires_in||300))*1000).toISOString()};
 await saveConnection(db,userId,'immomio',updated,{account_hint:connection.row.account_hint,expires_at:updated.expires_at});return updated;
}
async function session(db:any,userId:string){const connection=await getConnection(db,userId,'immomio');if(!connection)throw Error('needs_login');const credentials=await refresh(db,userId,connection);return{token:String(credentials.access_token),connection}}
async function authedGraphql(db:any,userId:string,query:string,variables:any={}){const s=await session(db,userId);const result=await rawGraphql(query,variables,s.token);if(result.response.status===401||result.response.status===403||authError(result.body)){await markConnection(db,userId,'immomio','needs_login','graphql_auth_failed').catch(()=>{});throw Error('needs_login')}if(networkStatus(result.response.status))throw Error('temporary_network_error');return result}
export async function immomioAccount(db:any,userId:string){const result=await authedGraphql(db,userId,USER_QUERY,{});const user=result.body?.data?.user;if(!result.response.ok||result.body?.errors?.length||!user?.id)throw Error('provider_contract_unverified');return{id:String(user.id),email:validEmail(user.email)}}
export async function checkImmomioConnection(db:any,userId:string){try{const account=await immomioAccount(db,userId);return{authenticated:true,status:'connected',accountReady:!!account.id}}catch(error:any){return{authenticated:false,status:error?.message==='needs_login'?'needs_login':'error'}}}
export async function disconnectImmomio(db:any,userId:string){await deleteConnection(db,userId,'immomio');await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','immomio');return{status:'disconnected'}}

async function propertyForListing(db:any,userId:string,listing:any){const sid=sourceIdentifier(listing);if(!sid)return{error:'application_link_missing'};const result=await authedGraphql(db,userId,PROPERTY_QUERY,{sourceIdentifier:sid});if(!result.response.ok||result.body?.errors?.length)return{error:'provider_contract_unverified'};const property=result.body?.data?.propertyBySourceIdentifier;if(!property)return{error:'listing_unavailable'};if(property.rented===true)return{error:'listing_unavailable'};return{property,sourceIdentifier:sid}}
async function questionState(db:any,userId:string,propertyId:string){const result=await authedGraphql(db,userId,QUESTIONS_QUERY,{id:propertyId});if(!result.response.ok||result.body?.errors?.length)return{error:'question_contract_unverified',customCount:0,hierarchicalCount:0};const data=result.body?.data?.customQuestionsByProperty||{};return{customCount:Array.isArray(data.customQuestions)?data.customQuestions.length:0,hierarchicalCount:Array.isArray(data.questions)?data.questions.length:0}}
async function existingApplication(db:any,userId:string,propertyId:string){const result=await authedGraphql(db,userId,CHECK_APPLICATION_QUERY,{propertyId});if(!result.response.ok||result.body?.errors?.length)return{error:'application_check_failed'};return result.body?.data?.checkApplicationExist||{id:null,smsVerificationRequired:false}}
async function prepareAccountApplication(db:any,userId:string,listing:any){
 const account=await immomioAccount(db,userId),resolved=await propertyForListing(db,userId,listing);if(resolved.error)return{ready:false,error:resolved.error};const property=resolved.property,propertyId=String(property.id||'');if(!propertyId)return{ready:false,error:'provider_contract_unverified'};
 const existing=await existingApplication(db,userId,propertyId);if(existing.error)return{ready:false,error:existing.error};if(existing.id)return{ready:false,error:'already_applied',alreadyApplied:true,applicationId:String(existing.id)};
 if(existing.smsVerificationRequired===true||property.smsVerificationRequired===true)return{ready:false,error:'sms_verification_required'};
 if(property?.captchaSettings?.applicationSubmissionActive===true&&clean(property?.captchaSettings?.siteKey,500))return{ready:false,error:'captcha_required'};
 const questions=await questionState(db,userId,propertyId);if(questions.error)return{ready:false,error:questions.error};if(questions.customCount||questions.hierarchicalCount)return{ready:false,error:'dynamic_questions_required',customQuestionCount:questions.customCount,hierarchicalQuestionCount:questions.hierarchicalCount};
 return{ready:true,mode:'account',accountId:account.id,propertyId,sourceIdentifier:resolved.sourceIdentifier,captchaRequired:false,smsVerificationRequired:false,dynamicQuestions:false};
}
export async function inspectImmomioAccountApplication(input:any){const{db,user,listing}=input||{},userId=String(user?.id||'');if(!db||!userId||!listing)return{available:false,ready:false,error:'provider_contract_unverified'};try{const prepared=await prepareAccountApplication(db,userId,listing);return{available:prepared.error!=='listing_unavailable'&&prepared.error!=='application_link_missing',...prepared}}catch(error:any){return{available:true,ready:false,error:error?.message==='needs_login'?'needs_login':error?.message==='temporary_network_error'?'temporary_network_error':'provider_contract_unverified'}}

async function verifyApplication(db:any,userId:string,propertyId:string,applicationId:string){for(const delay of[500,900,1600,2600,4200]){await sleep(delay);const existing=await existingApplication(db,userId,propertyId);if(existing?.id&&String(existing.id)===applicationId){const detail=await authedGraphql(db,userId,APPLICATION_QUERY,{id:applicationId});if(detail.response.ok&&!detail.body?.errors?.length){const row=detail.body?.data?.propertyApplyProcessPSBean;if(row?.id&&String(row.id)===applicationId)return{verified:true,row}}return{verified:true,row:null}}}return{verified:false,row:null}}
export async function sendImmomioApplication(input:any){
 const{db,user,listing,authorize}=input||{},userId=String(user?.id||'');if(!db||!userId||!listing)return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 let prepared:any;try{prepared=await prepareAccountApplication(db,userId,listing)}catch(error:any){if(error?.message==='temporary_network_error')throw error;return{success:false,status:'manual_required',error:error?.message==='needs_login'?'needs_login':'provider_contract_unverified'}}
 if(!prepared.ready)return{success:false,status:'manual_required',error:prepared.error||'provider_contract_unverified'};
 if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'failed',error:'send_not_authorized'};
 let result:any;try{result=await authedGraphql(db,userId,CREATE_APPLICATION_MUTATION,{userId:prepared.accountId,propertyId:prepared.propertyId,captchaResponse:null})}catch(error:any){if(error?.message==='temporary_network_error')return{success:false,status:'manual_required',error:'submission_unconfirmed'};return{success:false,status:'manual_required',error:error?.message==='needs_login'?'needs_login':'submission_unconfirmed'}}
 if(!result.response.ok||result.body?.errors?.length)return{success:false,status:'manual_required',error:'submission_unconfirmed'};
 const created=result.body?.data?.createApplication,applicationId=clean(created?.id,200);if(!applicationId)return{success:false,status:'manual_required',error:'submission_unconfirmed'};
 const verified=await verifyApplication(db,userId,prepared.propertyId,applicationId);if(!verified.verified)return{success:false,status:'manual_required',error:'submission_unconfirmed'};
 if(verified.row?.smsVerificationRequired===true)return{success:false,status:'manual_required',error:'sms_verification_required_after_submit'};
 if(verified.row?.hasUnansweredQuestions===true||verified.row?.hasQuestions===true)return{success:false,status:'manual_required',error:'dynamic_questions_required_after_submit'};
 return{success:true,status:'sent',error:null};
}

export async function probeImmomioApplication(listing:any){const url=immomioApplicationLink(listing);if(!url)return{available:false,error:'application_link_missing'};try{const response=await fetch(url,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(20000),headers:{'user-agent':'TraumWohnungHamburg/1.0'}});const text=await response.text();return{available:response.ok&&!/nicht (mehr )?verfügbar|not available|abgelaufen/i.test(text),status:response.status,url:response.url||url}}catch{return{available:false,error:'application_probe_failed'}}}
