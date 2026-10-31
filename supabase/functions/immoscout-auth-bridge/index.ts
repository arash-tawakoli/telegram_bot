import {claimPlatformConnectFlow,completePlatformConnectFlow} from '../_shared/platform-auth-flow.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const PROVIDER='immoscout';
const ISSUER='https://login.immobilienscout24.de/oauth2/aus1227au6oBg6hGH417';
const AUTHORIZE=`${ISSUER}/v1/authorize`;
const TOKEN=`${ISSUER}/v1/token`;
const USERINFO=`${ISSUER}/v1/userinfo`;
const AUTHN='https://login.immobilienscout24.de/api/v1/authn';
const CLIENT_ID='is24-android-de';
const REDIRECT_URI='immobilienscout24.de:/loginCallback';
const SCOPE='openid profile offline_access';
const OAUTH_USER_AGENT='okta-oauth2-kotlin/2.0.3 Android/34';
const HANDOFF_ORIGIN=new URL(Deno.env.get('SUPABASE_URL')!).origin;
const HANDOFF_URL='';
const enc=new TextEncoder(),dec=new TextDecoder();

const b64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};
const unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const b64url=(bytes:Uint8Array)=>b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64url=(value:string)=>unb64(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const clean=(v:any,max=320)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
async function challenge(verifier:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))}

async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data)}
async function keyMaterial(version=1){const raw=unb64(await secret(`application_credential_key_v${version}`));if(raw.length!==32)throw Error('credential_key_invalid');return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])}
async function encryptCredentials(userId:string,value:unknown,version=1,serviceScope=false){const key=await keyMaterial(version),iv=crypto.getRandomValues(new Uint8Array(12)),aad=enc.encode(serviceScope?`service:${PROVIDER}:v${version}`:`${userId}:${PROVIDER}:v${version}`),plain=enc.encode(JSON.stringify(value)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plain));return{credential_ciphertext:b64(cipher),credential_iv:b64(iv),key_version:version}}
async function decryptCredentials(row:any){if(!row?.credential_ciphertext||!row?.credential_iv)return null;const version=Number(row.key_version)||1,key=await keyMaterial(version),aad=enc.encode(`${row.user_id}:${PROVIDER}:v${version}`);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(row.credential_iv),additionalData:aad},key,unb64(row.credential_ciphertext));return JSON.parse(dec.decode(plain))}
async function sealMfaTicket(value:any){const key=await keyMaterial(1),iv=crypto.getRandomValues(new Uint8Array(12)),aad=enc.encode('immoscout:mfa:v1'),plain=enc.encode(JSON.stringify(value)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plain));return `${b64url(iv)}.${b64url(cipher)}`}
async function openMfaTicket(ticket:string){const parts=String(ticket||'').split('.');if(parts.length!==2)throw Error('mfa_expired');try{const key=await keyMaterial(1),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64url(parts[0]),additionalData:enc.encode('immoscout:mfa:v1')},key,unb64url(parts[1])),data=JSON.parse(dec.decode(plain));if(!data?.exp||Date.now()>Number(data.exp))throw Error('mfa_expired');return data}catch(error:any){if(error?.message==='mfa_expired')throw error;throw Error('mfa_expired')}}
function uuid(v:any){const s=String(v||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw Error('invalid_user');return s}
function validEmail(v:any){const e=clean(v,320).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required')}
async function assertFlowAllowed(flow:any){if(flow?.origin==='admin'){const{data:issuer,error}=await db.from('coaching_members').select('is_active,is_super_admin').eq('auth_user_id',flow.issued_by).maybeSingle();if(error||issuer?.is_active!==true||issuer?.is_super_admin!==true||flow.provider!==PROVIDER||flow.context?.scope!=='central')throw Error('premium_required');return}await eligible(uuid(flow?.user_id))}
async function profileEmail(userId:string){const {data,error}=await db.from('applicant_profiles').select('email').eq('user_id',userId).maybeSingle();const email=validEmail(data?.email);if(error||!email)throw Error('immoscout_email_required');return email}

async function mark(userId:string,status:string,lastError:string|null=null,patch:any={}){const {error}=await db.from('platform_connections').upsert({user_id:userId,provider:PROVIDER,status,connection_scope:'participant',last_error:lastError,updated_at:new Date().toISOString(),...patch},{onConflict:'user_id,provider'});if(error)throw Error('connection_update_failed')}
async function markFlow(flow:any,userId:string,status:string,lastError:string|null=null,patch:any={}){if(flow?.origin==='admin'&&flow?.context?.scope==='central')return;await mark(userId,status,lastError,patch)}
async function save(userId:string,credentials:any,accountHint:string|null,expiresAt:string,flow?:any){const central=flow?.origin==='admin'&&flow?.context?.scope==='central',encrypted=await encryptCredentials(userId,credentials,1,central);if(flow){if(central){if(validEmail(accountHint)!==validEmail(flow.context?.account_email))throw Error('central_account_mismatch');const{data,error}=await db.rpc('complete_platform_service_connect_flow',{p_flow:flow.id,p_user:userId,p_provider:PROVIDER,p_claim:flow.completionClaim,p_connection:{...encrypted,account_hint:accountHint,expires_at:expiresAt}});if(error||data!==true)throw Error(error?.message||'connection_save_failed');return}await completePlatformConnectFlow(db,flow,{...encrypted,account_hint:accountHint,expires_at:expiresAt});return}const {error}=await db.from('platform_connections').upsert({user_id:userId,provider:PROVIDER,status:'connected',connection_scope:'participant',account_hint:accountHint,...encrypted,expires_at:expiresAt,last_verified_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});if(error)throw Error('connection_save_failed')}

async function tokenRequest(payload:Record<string,string>){try{const response=await fetch(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json','user-agent':OAUTH_USER_AGENT},body:new URLSearchParams({...payload,client_id:CLIENT_ID}),signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
async function userInfo(accessToken:string){try{const response=await fetch(USERINFO,{headers:{accept:'application/json',authorization:`Bearer ${accessToken}`,'user-agent':OAUTH_USER_AGENT},signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
async function authn(email:string,password:string){try{const response=await fetch(AUTHN,{method:'POST',headers:{accept:'application/json','content-type':'application/json','user-agent':OAUTH_USER_AGENT},body:JSON.stringify({username:email,password,options:{multiOptionalFactorEnroll:false,warnBeforePasswordExpired:false}}),signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
async function verifyFactor(factorId:string,stateToken:string,passCode?:string){if(!/^[A-Za-z0-9_-]{3,160}$/.test(factorId))throw Error('mfa_factor_unsupported');const payload:any={stateToken};if(passCode)payload.passCode=passCode;try{const response=await fetch(`${AUTHN}/factors/${encodeURIComponent(factorId)}/verify`,{method:'POST',headers:{accept:'application/json','content-type':'application/json','user-agent':OAUTH_USER_AGENT},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
function factorLabel(f:any){const type=clean(f?.factorType,80);if(type==='token:software:totp')return 'Authenticator-App';if(type==='sms')return f?.profile?.phoneNumber?`SMS an ${clean(f.profile.phoneNumber,40)}`:'SMS-Code';if(type==='call')return f?.profile?.phoneNumber?`Anruf an ${clean(f.profile.phoneNumber,40)}`:'Telefon-Code';if(type==='email')return 'E-Mail-Code';return type}
function supportedFactors(body:any){const factors=Array.isArray(body?._embedded?.factors)?body._embedded.factors:[];return factors.filter((f:any)=>['token:software:totp','sms','call','email'].includes(String(f?.factorType||''))&&/^[A-Za-z0-9_-]{3,160}$/.test(String(f?.id||''))).map((f:any)=>({id:String(f.id),type:String(f.factorType),provider:clean(f.provider,40),label:factorLabel(f)}))}
function callbackParts(value:string){let url:URL;try{url=new URL(String(value||'').trim())}catch{throw Error('invalid_callback_url')}if(url.protocol!=='immobilienscout24.de:'||url.hostname||url.port||url.username||url.password||url.pathname!=='/loginCallback')throw Error('invalid_callback_url');const fragment=new URLSearchParams(url.hash.replace(/^#/,'').replace(/^\?/,'')),state=fragment.get('state')||url.searchParams.get('state'),code=fragment.get('code')||url.searchParams.get('code'),oauthError=fragment.get('error')||url.searchParams.get('error');return{state,code,oauthError}}
async function flowByState(state:string,userId?:string){if(!/^[A-Za-z0-9_-]{20,80}$/.test(state))throw Error('invalid_state');let q=db.from('platform_auth_flows').select('*').eq('provider',PROVIDER).eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString());if(userId)q=q.eq('user_id',userId);const {data,error}=await q.maybeSingle();if(error||!data)throw Error('auth_flow_expired');return data}
async function claimFlow(flow:any){await claimPlatformConnectFlow(db,flow)}

async function beginLogin(userId:string){
 await eligible(userId);
 const email=await profileEmail(userId);
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER).is('consumed_at',null);
 const verifier=random(),state=random().slice(0,43),{error:flowError}=await db.from('platform_auth_flows').insert({user_id:userId,provider:PROVIDER,state,code_verifier:verifier});if(flowError)throw Error('auth_flow_create_failed');
 await mark(userId,'pending',null,{account_hint:email,credential_ciphertext:null,credential_iv:null,key_version:1,expires_at:null,last_verified_at:null});
 return{status:'deprecated',error:'provider_hosted_login_required',requiresCallback:false,automaticCallback:false,bridgeRequired:false,transport:'provider-hosted-native-handoff'};
}

async function authorizeWithSession(flow:any,email:string,sessionToken:string){
 const verifier=String(flow.code_verifier||'');if(!verifier)throw Error('auth_flow_expired');
 const url=new URL(AUTHORIZE),params={source:'myaccount',utm_medium:'app',utm_source:'android',utm_campaign:'sso_entrance',app_name:CLIENT_ID,consent:'true',client_id:CLIENT_ID,response_type:'code',response_mode:'query',redirect_uri:REDIRECT_URI,scope:SCOPE,state:String(flow.state),nonce:crypto.randomUUID(),code_challenge:await challenge(verifier),code_challenge_method:'S256',login_hint:email,sessionToken,prompt:'none'};for(const[k,v]of Object.entries(params))url.searchParams.set(k,String(v));
 let response:Response;try{response=await fetch(url.href,{redirect:'manual',headers:{accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','user-agent':OAUTH_USER_AGENT},signal:AbortSignal.timeout(25000)})}catch{throw Error('temporary_network_error')}
 const location=response.headers.get('location');if(!location)throw Error('authorization_code_missing');
 const parsed=callbackParts(location);if(parsed.state!==String(flow.state))throw Error('invalid_callback_url');if(parsed.oauthError)throw Error('oauth_login_failed');if(!parsed.code)throw Error('authorization_code_missing');return parsed.code;
}

async function exchangeAndSave(userId:string,flow:any,code:string,emailFallback:string|null){
 const {response,body}=await tokenRequest({grant_type:'authorization_code',code,redirect_uri:REDIRECT_URI,code_verifier:String(flow.code_verifier||'')});
 if(!response.ok||!body?.access_token){const reason=clean(`${body?.error||'token_exchange_failed'}:${body?.error_description||response.status}`,160);await markFlow(flow,userId,'needs_login',reason).catch(()=>{});throw Error('token_exchange_failed')}
 if(!body?.refresh_token){await markFlow(flow,userId,'needs_login','refresh_token_missing').catch(()=>{});throw Error('refresh_token_missing')}
 const info=await userInfo(String(body.access_token));if(!info.response.ok||!info.body?.sub){await markFlow(flow,userId,'needs_login','userinfo_failed').catch(()=>{});throw Error('userinfo_failed')}
 const accountHint=validEmail(info.body?.email)||emailFallback;if(flow?.origin==='admin'&&flow?.context?.scope==='central'&&validEmail(accountHint)!==validEmail(flow.context?.account_email))throw Error('central_account_mismatch');const expiresAt=new Date(Date.now()+Math.max(60,Number(body.expires_in||3600))*1000).toISOString();
 await save(userId,{access_token:String(body.access_token),refresh_token:String(body.refresh_token),id_token:body.id_token?String(body.id_token):null,expires_at:expiresAt,token_type:String(body.token_type||'Bearer'),scope:String(body.scope||SCOPE),client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,issuer:ISSUER,sub:String(info.body.sub)},accountHint,expiresAt,flow);
 return{status:'connected',authenticated:true,accountReady:true,accountHint};
}
async function finishWithSession(flow:any,userId:string,email:string,sessionToken:string){await claimFlow(flow);const code=await authorizeWithSession(flow,email,sessionToken);return exchangeAndSave(userId,flow,code,email)}

async function passwordLogin(state:string,emailValue:any,passwordValue:any){
 const email=validEmail(emailValue),password=String(passwordValue||'');if(!email||!password||password.length>1024)throw Error('login_failed');
 const flow=await flowByState(state),userId=uuid(flow.user_id);await assertFlowAllowed(flow);if(flow.origin==='admin'&&validEmail(email)!==validEmail(flow.context?.account_email))throw Error('central_account_mismatch');
 const {response,body}=await authn(email,password);
 const status=clean(body?.status,60).toUpperCase();
 if(status==='MFA_REQUIRED'||status==='MFA_CHALLENGE'){
   const factors=supportedFactors(body),stateToken=String(body?.stateToken||'');if(!stateToken||!factors.length){await markFlow(flow,userId,'needs_login','mfa_factor_unsupported',{account_hint:email}).catch(()=>{});throw Error('mfa_factor_unsupported')}
   const mfaTicket=await sealMfaTicket({v:1,exp:Date.now()+10*60*1000,flowState:String(flow.state),userId,email,stateToken,factors:factors.map((f:any)=>({id:f.id,type:f.type}))});
   await markFlow(flow,userId,'pending','mfa_required',{account_hint:email}).catch(()=>{});
   return{status:'mfa_required',authenticated:false,mfaRequired:true,mfaTicket,factors};
 }
 if(!response.ok||status!=='SUCCESS'||!body?.sessionToken){await markFlow(flow,userId,'pending','login_failed',{account_hint:email}).catch(()=>{});throw Error('login_failed')}
 return finishWithSession(flow,userId,email,String(body.sessionToken));
}

async function mfaStart(ticketValue:any,factorIdValue:any){
 const ticket=await openMfaTicket(String(ticketValue||'')),factorId=String(factorIdValue||''),allowed=(ticket.factors||[]).find((f:any)=>f.id===factorId);if(!allowed)throw Error('mfa_factor_unsupported');
 const flow=await flowByState(String(ticket.flowState),String(ticket.userId));await assertFlowAllowed(flow);
 if(allowed.type==='token:software:totp')return{status:'mfa_code_required',mfaRequired:true,mfaTicket:String(ticketValue),factorId,factorType:allowed.type};
 const {response,body}=await verifyFactor(factorId,String(ticket.stateToken));const status=clean(body?.status,60).toUpperCase();
 if(status==='SUCCESS'&&body?.sessionToken)return finishWithSession(flow,String(ticket.userId),String(ticket.email),String(body.sessionToken));
 if(!response.ok&&!['MFA_CHALLENGE','MFA_REQUIRED'].includes(status))throw Error('mfa_challenge_failed');
 const nextTicket=await sealMfaTicket({...ticket,exp:Date.now()+10*60*1000,stateToken:String(body?.stateToken||ticket.stateToken)});
 return{status:'mfa_code_required',mfaRequired:true,mfaTicket:nextTicket,factorId,factorType:allowed.type};
}

async function mfaVerify(ticketValue:any,factorIdValue:any,passCodeValue:any){
 const passCode=String(passCodeValue||'').trim();if(!/^[0-9]{4,10}$/.test(passCode))throw Error('mfa_invalid_code');
 const ticket=await openMfaTicket(String(ticketValue||'')),factorId=String(factorIdValue||''),allowed=(ticket.factors||[]).find((f:any)=>f.id===factorId);if(!allowed)throw Error('mfa_factor_unsupported');
 const flow=await flowByState(String(ticket.flowState),String(ticket.userId));await assertFlowAllowed(flow);
 const {response,body}=await verifyFactor(factorId,String(ticket.stateToken),passCode);const status=clean(body?.status,60).toUpperCase();
 if(status==='SUCCESS'&&body?.sessionToken)return finishWithSession(flow,String(ticket.userId),String(ticket.email),String(body.sessionToken));
 if(response.status===403||String(body?.errorCode||'')==='E0000068')throw Error('mfa_invalid_code');
 if(status==='MFA_CHALLENGE'||status==='MFA_REQUIRED'){const nextTicket=await sealMfaTicket({...ticket,exp:Date.now()+10*60*1000,stateToken:String(body?.stateToken||ticket.stateToken)});return{status:'mfa_code_required',mfaRequired:true,mfaTicket:nextTicket,factorId,factorType:allowed.type}}
 throw Error('mfa_challenge_failed');
}

async function completeLogin(userId:string,callbackUrl:string){const parsed=callbackParts(callbackUrl);if(!parsed.state)throw Error('invalid_callback_url');if(parsed.oauthError){const flow=await flowByState(parsed.state,userId);await assertFlowAllowed(flow);await markFlow(flow,userId,'needs_login',clean(parsed.oauthError,120)).catch(()=>{});throw Error('oauth_login_failed')}if(!parsed.code)throw Error('invalid_callback_url');const flow=await flowByState(parsed.state,userId);await assertFlowAllowed(flow);await claimFlow(flow);return exchangeAndSave(userId,flow,parsed.code,await profileEmail(userId).catch(()=>null))}

async function refresh(userId:string,row:any,credentials:any){if(credentials?.access_token&&Date.parse(credentials.expires_at||'')>Date.now()+60000)return credentials;if(!credentials?.refresh_token)throw Error('needs_login');const {response,body}=await tokenRequest({grant_type:'refresh_token',refresh_token:String(credentials.refresh_token)});if(!response.ok||!body?.access_token){await mark(userId,'needs_login',clean(`${body?.error||'refresh_failed'}:${body?.error_description||response.status}`,160)).catch(()=>{});throw Error('needs_login')}const expiresAt=new Date(Date.now()+Math.max(60,Number(body.expires_in||3600))*1000).toISOString(),updated={...credentials,access_token:String(body.access_token),refresh_token:String(body.refresh_token||credentials.refresh_token),id_token:body.id_token?String(body.id_token):credentials.id_token,expires_at:expiresAt,token_type:String(body.token_type||credentials.token_type||'Bearer'),scope:String(body.scope||credentials.scope||SCOPE),client_id:CLIENT_ID,redirect_uri:REDIRECT_URI};await save(userId,updated,row.account_hint||null,expiresAt);return updated}
async function checkConnection(userId:string){const{data:service,error:serviceError}=await db.from('platform_service_connections').select('status,account_hint,last_verified_at,last_error,expires_at').eq('provider',PROVIDER).maybeSingle();if(serviceError)throw Error('connection_read_failed');if(service?.status==='connected')return{authenticated:true,status:'connected',accountReady:true,accountHint:'Zentral verwaltet durch NexaLabs',connectionScope:'service',lastVerifiedAt:service.last_verified_at||null};await eligible(userId);const {data:row,error}=await db.from('platform_connections').select('*').eq('user_id',userId).eq('provider',PROVIDER).maybeSingle();if(error)throw Error('connection_read_failed');if(!row)return{authenticated:false,status:'disconnected'};if(row.connection_scope==='service')return{authenticated:false,status:'disconnected'};if(!row.credential_ciphertext)return{authenticated:null,status:row.status,lastError:row.last_error||null};try{const credentials=await decryptCredentials(row),active=await refresh(userId,row,credentials),info=await userInfo(String(active.access_token));if(!info.response.ok||!info.body?.sub){await mark(userId,'needs_login','userinfo_failed').catch(()=>{});return{authenticated:false,status:'needs_login'}}await mark(userId,'connected',null,{last_verified_at:new Date().toISOString(),account_hint:validEmail(info.body?.email)||row.account_hint});return{authenticated:true,status:'connected',accountReady:true,accountHint:validEmail(info.body?.email)||row.account_hint}}catch(error:any){if(error?.message==='needs_login')return{authenticated:false,status:'needs_login'};return{authenticated:false,status:'error'}}}
async function inspect(userId:string){const{data:service,error:serviceError}=await db.from('platform_service_connections').select('status,account_hint,last_verified_at,last_error,expires_at').eq('provider',PROVIDER).maybeSingle();if(serviceError)throw Error('connection_read_failed');if(service?.status==='connected')return{status:'connected',hasCredentials:false,connectionScope:'service',accountHint:service.account_hint||null,expiresAt:service.expires_at||null,lastVerifiedAt:service.last_verified_at||null,lastError:service.last_error||null};const {data:row,error}=await db.from('platform_connections').select('*').eq('user_id',userId).eq('provider',PROVIDER).maybeSingle();if(error||!row||row.connection_scope==='service')return{status:'disconnected',hasCredentials:false};const credentials=await decryptCredentials(row).catch(()=>null);return{status:row.status,lastError:row.last_error||null,hasCredentials:!!credentials,expiresAt:credentials?.expires_at||row.expires_at||null,hasRefreshToken:!!credentials?.refresh_token,accountHint:row.account_hint||null,clientId:credentials?.client_id||CLIENT_ID,connectionScope:'participant'}}
async function disconnect(userId:string){const{data:row,error:rowError}=await db.from('platform_connections').select('connection_scope').eq('user_id',userId).eq('provider',PROVIDER).maybeSingle();if(rowError)throw Error('connection_read_failed');if(row?.connection_scope==='service')throw Error('central_connection_managed');await Promise.all([db.from('platform_connections').delete().eq('user_id',userId).eq('provider',PROVIDER),db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER)]);const{data:service,error:serviceError}=await db.from('platform_service_connections').select('status,account_hint').eq('provider',PROVIDER).maybeSingle();if(serviceError)throw Error('connection_read_failed');if(service?.status==='connected'){const{error}=await db.from('platform_connections').upsert({user_id:userId,provider:PROVIDER,status:'connected',connection_scope:'service',account_hint:'Zentral verwaltet durch NexaLabs',key_version:1,last_verified_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});if(error)throw Error('connection_update_failed');return{status:'connected',connectionScope:'service',accountHint:'Zentral verwaltet durch NexaLabs'}}return{status:'disconnected'}}

const CORS={'access-control-allow-origin':HANDOFF_ORIGIN,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type','cache-control':'no-store','vary':'Origin'};
function publicJson(body:any,status=200){return Response.json(body,{status,headers:CORS})}
function publicError(error:any){const code=String(error?.message||'immoscout_operation_failed'),safe=new Set(['login_failed','mfa_required','mfa_factor_unsupported','mfa_invalid_code','mfa_challenge_failed','mfa_expired','auth_flow_expired','invalid_state','central_account_mismatch','central_connection_managed']);const status=code==='login_failed'||code==='mfa_invalid_code'?401:code==='auth_flow_expired'||code==='invalid_state'||code==='mfa_expired'?410:code.startsWith('mfa_')?409:503;return publicJson({error:safe.has(code)?code:'immoscout_operation_failed'},status)}

Deno.serve(async req=>{try{
 const origin=req.headers.get('origin')||'';
 if(req.method==='OPTIONS'){if(origin!==HANDOFF_ORIGIN)return new Response('forbidden',{status:403});return new Response(null,{status:204,headers:CORS})}
 if(req.method!=='POST')return new Response('method not allowed',{status:405});
 const body=await req.json().catch(()=>({}));
 if(['password_login','mfa_start','mfa_verify'].includes(String(body.action||''))){
   if(origin!==HANDOFF_ORIGIN)return new Response('forbidden',{status:403});
   try{if(body.action==='password_login')return publicJson(await passwordLogin(String(body.state||''),body.email,body.password));if(body.action==='mfa_start')return publicJson(await mfaStart(body.mfaTicket,body.factorId));return publicJson(await mfaVerify(body.mfaTicket,body.factorId,body.passCode))}catch(error:any){return publicError(error)}
 }
 if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
 if(body.action==='health')return Response.json({ok:true,mode:'immoscout-one-time-password-mfa-pkce-handoff',clientId:CLIENT_ID,redirectUri:REDIRECT_URI,marksConnectedAfterUserInfo:true,expiresInSeconds:1800,passwordStored:false,mfaStored:false,mfaTicketEncrypted:true});
 const userId=uuid(body.userId);
 if(body.action==='login')return Response.json(await beginLogin(userId));
 if(body.action==='complete_login')return Response.json(await completeLogin(userId,String(body.callbackUrl||'')));
 if(body.action==='check')return Response.json(await checkConnection(userId));
 if(body.action==='inspect')return Response.json(await inspect(userId));
 if(body.action==='disconnect')return Response.json(await disconnect(userId));
 throw Error('invalid_action');
}catch(error:any){const code=String(error?.message||'immoscout_operation_failed'),safe=new Set(['configuration_unavailable','credential_key_invalid','premium_required','invalid_user','invalid_action','immoscout_email_required','auth_flow_create_failed','connection_update_failed','connection_save_failed','connection_read_failed','central_account_mismatch','central_connection_managed','invalid_callback_url','invalid_state','auth_flow_expired','oauth_login_failed','authorization_code_missing','token_exchange_failed','refresh_token_missing','userinfo_failed','temporary_network_error','needs_login','login_failed','mfa_required','mfa_factor_unsupported','mfa_invalid_code','mfa_challenge_failed','mfa_expired']);return Response.json({error:safe.has(code)?code:'immoscout_operation_failed'},{status:503})}});
