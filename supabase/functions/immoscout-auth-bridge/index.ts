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
const HANDOFF_ORIGIN='https://websitetraumwohnung.vercel.app';
const HANDOFF_URL=`${HANDOFF_ORIGIN}/connect/immoscout`;
const enc=new TextEncoder(),dec=new TextDecoder();

const b64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};
const unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const b64url=(bytes:Uint8Array)=>b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const clean=(v:any,max=320)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
async function challenge(verifier:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))}

async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data)}
async function keyMaterial(version=1){const raw=unb64(await secret(`application_credential_key_v${version}`));if(raw.length!==32)throw Error('credential_key_invalid');return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])}
async function encryptCredentials(userId:string,value:unknown,version=1){const key=await keyMaterial(version),iv=crypto.getRandomValues(new Uint8Array(12)),aad=enc.encode(`${userId}:${PROVIDER}:v${version}`),plain=enc.encode(JSON.stringify(value)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plain));return{credential_ciphertext:b64(cipher),credential_iv:b64(iv),key_version:version}}
async function decryptCredentials(row:any){if(!row?.credential_ciphertext||!row?.credential_iv)return null;const version=Number(row.key_version)||1,key=await keyMaterial(version),aad=enc.encode(`${row.user_id}:${PROVIDER}:v${version}`);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(row.credential_iv),additionalData:aad},key,unb64(row.credential_ciphertext));return JSON.parse(dec.decode(plain))}
async function encryptTransient(flow:any,value:unknown,version=1){const key=await keyMaterial(version),iv=crypto.getRandomValues(new Uint8Array(12)),aad=enc.encode(`${flow.user_id}:${PROVIDER}:flow:${flow.id}:v${version}`),plain=enc.encode(JSON.stringify(value)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plain));return{transient_ciphertext:b64(cipher),transient_iv:b64(iv),transient_key_version:version}}
async function saveTransient(flow:any,value:unknown){const encrypted=await encryptTransient(flow,value);const {data,error}=await db.from('platform_auth_flows').update(encrypted).eq('id',flow.id).is('consumed_at',null).select('*').maybeSingle();if(error||!data)throw Error('auth_flow_expired');return data}
async function readTransient(flow:any){if(!flow?.transient_ciphertext||!flow?.transient_iv)throw Error('mfa_state_missing');const version=Number(flow.transient_key_version)||1,key=await keyMaterial(version),aad=enc.encode(`${flow.user_id}:${PROVIDER}:flow:${flow.id}:v${version}`);try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(flow.transient_iv),additionalData:aad},key,unb64(flow.transient_ciphertext));return JSON.parse(dec.decode(plain))}catch{throw Error('mfa_state_missing')}}
function uuid(v:any){const s=String(v||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw Error('invalid_user');return s}
function validEmail(v:any){const e=clean(v,320).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required')}
async function profileEmail(userId:string){const {data,error}=await db.from('applicant_profiles').select('email').eq('user_id',userId).maybeSingle();const email=validEmail(data?.email);if(error||!email)throw Error('immoscout_email_required');return email}

async function mark(userId:string,status:string,lastError:string|null=null,patch:any={}){const {error}=await db.from('platform_connections').upsert({user_id:userId,provider:PROVIDER,status,last_error:lastError,updated_at:new Date().toISOString(),...patch},{onConflict:'user_id,provider'});if(error)throw Error('connection_update_failed')}
async function save(userId:string,credentials:any,accountHint:string|null,expiresAt:string){const encrypted=await encryptCredentials(userId,credentials);const {error}=await db.from('platform_connections').upsert({user_id:userId,provider:PROVIDER,status:'connected',account_hint:accountHint,...encrypted,expires_at:expiresAt,last_verified_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});if(error)throw Error('connection_save_failed')}

async function tokenRequest(payload:Record<string,string>){try{const response=await fetch(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json','user-agent':OAUTH_USER_AGENT},body:new URLSearchParams({...payload,client_id:CLIENT_ID}),signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
async function userInfo(accessToken:string){try{const response=await fetch(USERINFO,{headers:{accept:'application/json',authorization:`Bearer ${accessToken}`,'user-agent':OAUTH_USER_AGENT},signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
async function authn(email:string,password:string){try{const response=await fetch(AUTHN,{method:'POST',headers:{accept:'application/json','content-type':'application/json','user-agent':OAUTH_USER_AGENT},body:JSON.stringify({username:email,password,options:{multiOptionalFactorEnroll:false,warnBeforePasswordExpired:false}}),signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
function callbackParts(value:string){let url:URL;try{url=new URL(String(value||'').trim())}catch{throw Error('invalid_callback_url')}if(url.protocol!=='immobilienscout24.de:'||url.hostname||url.port||url.username||url.password||url.pathname!=='/loginCallback')throw Error('invalid_callback_url');const fragment=new URLSearchParams(url.hash.replace(/^#/, '').replace(/^\?/,'')),state=fragment.get('state')||url.searchParams.get('state'),code=fragment.get('code')||url.searchParams.get('code'),oauthError=fragment.get('error')||url.searchParams.get('error');return{state,code,oauthError}}
async function flowByState(state:string,userId?:string){if(!/^[A-Za-z0-9_-]{20,80}$/.test(state))throw Error('invalid_state');let q=db.from('platform_auth_flows').select('*').eq('provider',PROVIDER).eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString());if(userId)q=q.eq('user_id',userId);const {data,error}=await q.maybeSingle();if(error||!data)throw Error('auth_flow_expired');return data}
async function claimFlow(flow:any){const now=new Date().toISOString(),{data,error}=await db.from('platform_auth_flows').update({consumed_at:now,transient_ciphertext:null,transient_iv:null}).eq('id',flow.id).is('consumed_at',null).select('id').maybeSingle();if(error||!data)throw Error('auth_flow_expired')}

const SUPPORTED_FACTORS=new Set(['sms','call','email','token:software:totp','token:hotp','push','question']);
function factorId(v:any){const id=clean(v,160);return /^[A-Za-z0-9_-]{3,160}$/.test(id)?id:null}
function factorDescriptor(raw:any){const id=factorId(raw?.id),type=clean(raw?.factorType,80).toLowerCase();if(!id||!SUPPORTED_FACTORS.has(type))return null;const profile=raw?.profile&&typeof raw.profile==='object'?raw.profile:{};let detail='';if(type==='sms'||type==='call')detail=clean(profile.phoneNumber,80);else if(type==='email')detail=clean(profile.email||profile.credentialId,160);else if(type==='push')detail=clean(profile.name||profile.deviceType||profile.platform,80);else if(type==='question')detail=clean(profile.questionText,180);const names:Record<string,string>={sms:'SMS-Code',call:'Telefon-Code',email:'E-Mail-Code','token:software:totp':'Authenticator-Code','token:hotp':'Authenticator-Code',push:'Push-Bestätigung',question:'Sicherheitsfrage'};return{id,type,label:detail?`${names[type]} · ${detail}`:names[type],question:type==='question'?detail:null}}
function extractFactors(body:any){const raw=Array.isArray(body?._embedded?.factors)?body._embedded.factors:[];return raw.map(factorDescriptor).filter(Boolean)}
function safeFactor(f:any){return{id:String(f.id),type:String(f.type),label:clean(f.label,220),question:f.question?clean(f.question,220):null}}
function selectedFactor(transient:any){const id=factorId(transient?.selectedFactorId);if(!id)return null;return Array.isArray(transient?.factors)?transient.factors.find((f:any)=>f.id===id)||null:null}
async function verifyFactor(stateToken:string,id:string,payload:Record<string,string>={}){const safeId=factorId(id);if(!safeId)throw Error('mfa_factor_invalid');try{const response=await fetch(`${AUTHN}/factors/${encodeURIComponent(safeId)}/verify`,{method:'POST',headers:{accept:'application/json','content-type':'application/json','user-agent':OAUTH_USER_AGENT},body:JSON.stringify({stateToken,...payload}),signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
function mfaPayload(transient:any,step?:string){const factors=(Array.isArray(transient?.factors)?transient.factors:[]).map(safeFactor),selected=selectedFactor(transient);return{status:'mfa_required',authenticated:false,step:step||(selected?(selected.type==='push'?'push':'code'):'select'),factors,selectedFactor:selected?safeFactor(selected):null}}

async function beginLogin(userId:string){
 const email=await profileEmail(userId);
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER).is('consumed_at',null);
 const verifier=random(),state=random().slice(0,43),{error:flowError}=await db.from('platform_auth_flows').insert({user_id:userId,provider:PROVIDER,state,code_verifier:verifier});if(flowError)throw Error('auth_flow_create_failed');
 await mark(userId,'pending',null,{account_hint:email,credential_ciphertext:null,credential_iv:null,key_version:1,expires_at:null,last_verified_at:null});
 const url=new URL(HANDOFF_URL);url.searchParams.set('state',state);
 return{status:'login',url:url.href,requiresCallback:false,automaticCallback:true,bridgeRequired:false,transport:'one-time-password-pkce-handoff',expiresInSeconds:1800};
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
 if(!response.ok||!body?.access_token){const reason=clean(`${body?.error||'token_exchange_failed'}:${body?.error_description||response.status}`,160);await mark(userId,'needs_login',reason).catch(()=>{});throw Error('token_exchange_failed')}
 if(!body?.refresh_token){await mark(userId,'needs_login','refresh_token_missing').catch(()=>{});throw Error('refresh_token_missing')}
 const info=await userInfo(String(body.access_token));if(!info.response.ok||!info.body?.sub){await mark(userId,'needs_login','userinfo_failed').catch(()=>{});throw Error('userinfo_failed')}
 const accountHint=validEmail(info.body?.email)||emailFallback,expiresAt=new Date(Date.now()+Math.max(60,Number(body.expires_in||3600))*1000).toISOString();
 await save(userId,{access_token:String(body.access_token),refresh_token:String(body.refresh_token),id_token:body.id_token?String(body.id_token):null,expires_at:expiresAt,token_type:String(body.token_type||'Bearer'),scope:String(body.scope||SCOPE),client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,issuer:ISSUER,sub:String(info.body.sub)},accountHint,expiresAt);
 return{status:'connected',authenticated:true,accountReady:true,accountHint};
}

async function finishMfa(flow:any,transient:any,sessionToken:string){const userId=uuid(flow.user_id),email=validEmail(transient?.email)||await profileEmail(userId);await claimFlow(flow);const code=await authorizeWithSession(flow,email,String(sessionToken));return exchangeAndSave(userId,flow,code,email)}

async function startFactor(flow:any,transient:any,factorValue:any){
 const id=factorId(factorValue),factor=Array.isArray(transient?.factors)?transient.factors.find((f:any)=>f.id===id):null;if(!factor)throw Error('mfa_factor_invalid');
 transient={...transient,selectedFactorId:factor.id};
 if(factor.type==='token:software:totp'||factor.type==='token:hotp'||factor.type==='question'){await saveTransient(flow,transient);return mfaPayload(transient,'code')}
 const {response,body}=await verifyFactor(String(transient.stateToken||''),factor.id);
 if(!response.ok){throw Error('mfa_challenge_failed')}
 transient={...transient,stateToken:String(body?.stateToken||transient.stateToken||''),selectedFactorId:factor.id};
 const saved=await saveTransient(flow,transient);
 if(clean(body?.status,60).toUpperCase()==='SUCCESS'&&body?.sessionToken)return finishMfa(saved,transient,String(body.sessionToken));
 const factorResult=clean(body?.factorResult,60).toUpperCase();if(factorResult==='REJECTED')throw Error('mfa_rejected');if(factorResult==='TIMEOUT')throw Error('mfa_timeout');
 return mfaPayload(transient,factor.type==='push'?'push':'code');
}

async function passwordLogin(state:string,emailValue:any,passwordValue:any){
 const email=validEmail(emailValue),password=String(passwordValue||'');if(!email||!password||password.length>1024)throw Error('login_failed');
 const flow=await flowByState(state),userId=uuid(flow.user_id);await eligible(userId);
 const {response,body}=await authn(email,password);
 const status=clean(body?.status,60).toUpperCase();
 if(status.startsWith('MFA')){
   const stateToken=clean(body?.stateToken,4096),factors=extractFactors(body);if(!stateToken||!factors.length){await mark(userId,'needs_login','mfa_unsupported',{account_hint:email}).catch(()=>{});throw Error('mfa_unsupported')}
   const transient={kind:'mfa',stateToken,email,factors,selectedFactorId:null};const saved=await saveTransient(flow,transient);await mark(userId,'pending','mfa_required',{account_hint:email}).catch(()=>{});
   if(factors.length===1)return startFactor(saved,transient,factors[0].id);
   return mfaPayload(transient,'select');
 }
 if(!response.ok||status!=='SUCCESS'||!body?.sessionToken){await mark(userId,'pending','login_failed',{account_hint:email}).catch(()=>{});throw Error('login_failed')}
 await claimFlow(flow);
 const code=await authorizeWithSession(flow,email,String(body.sessionToken));
 return exchangeAndSave(userId,flow,code,email);
}

async function mfaStatus(state:string){const flow=await flowByState(state),userId=uuid(flow.user_id);await eligible(userId);if(!flow.transient_ciphertext)return{status:'login',authenticated:false};const transient=await readTransient(flow);if(transient?.kind!=='mfa')return{status:'login',authenticated:false};return mfaPayload(transient)}
async function mfaSelect(state:string,factorValue:any){const flow=await flowByState(state),userId=uuid(flow.user_id);await eligible(userId);const transient=await readTransient(flow);if(transient?.kind!=='mfa')throw Error('mfa_state_missing');return startFactor(flow,transient,factorValue)}
async function mfaVerify(state:string,codeValue:any){
 let flow=await flowByState(state),userId=uuid(flow.user_id);await eligible(userId);let transient=await readTransient(flow);if(transient?.kind!=='mfa')throw Error('mfa_state_missing');let factor=selectedFactor(transient);if(!factor&&Array.isArray(transient.factors)&&transient.factors.length===1){const selected=await startFactor(flow,transient,transient.factors[0].id);if(selected?.status==='connected')return selected;flow=await flowByState(state);transient=await readTransient(flow);factor=selectedFactor(transient)}if(!factor)throw Error('mfa_factor_required');
 const payload:Record<string,string>={};if(factor.type==='question'){const answer=clean(codeValue,300);if(!answer)throw Error('mfa_code_required');payload.answer=answer}else if(factor.type!=='push'){const passCode=clean(codeValue,80);if(!passCode)throw Error('mfa_code_required');payload.passCode=passCode}
 const {response,body}=await verifyFactor(String(transient.stateToken||''),factor.id,payload);
 if(!response.ok){if(String(body?.errorCode||'')==='E0000068')throw Error('mfa_invalid_code');throw Error('mfa_verification_failed')}
 transient={...transient,stateToken:String(body?.stateToken||transient.stateToken||'')};flow=await saveTransient(flow,transient);
 const status=clean(body?.status,60).toUpperCase(),factorResult=clean(body?.factorResult,60).toUpperCase();if(status==='SUCCESS'&&body?.sessionToken)return finishMfa(flow,transient,String(body.sessionToken));if(factorResult==='REJECTED')throw Error('mfa_rejected');if(factorResult==='TIMEOUT')throw Error('mfa_timeout');if(factor.type==='push'&&factorResult==='WAITING')return mfaPayload(transient,'push');throw Error('mfa_verification_failed');
}

async function completeLogin(userId:string,callbackUrl:string){const parsed=callbackParts(callbackUrl);if(!parsed.state)throw Error('invalid_callback_url');if(parsed.oauthError){await mark(userId,'needs_login',clean(parsed.oauthError,120)).catch(()=>{});throw Error('oauth_login_failed')}if(!parsed.code)throw Error('invalid_callback_url');const flow=await flowByState(parsed.state,userId);await claimFlow(flow);return exchangeAndSave(userId,flow,parsed.code,await profileEmail(userId).catch(()=>null))}

async function refresh(userId:string,row:any,credentials:any){if(credentials?.access_token&&Date.parse(credentials.expires_at||'')>Date.now()+60000)return credentials;if(!credentials?.refresh_token)throw Error('needs_login');const {response,body}=await tokenRequest({grant_type:'refresh_token',refresh_token:String(credentials.refresh_token)});if(!response.ok||!body?.access_token){await mark(userId,'needs_login',clean(`${body?.error||'refresh_failed'}:${body?.error_description||response.status}`,160)).catch(()=>{});throw Error('needs_login')}const expiresAt=new Date(Date.now()+Math.max(60,Number(body.expires_in||3600))*1000).toISOString(),updated={...credentials,access_token:String(body.access_token),refresh_token:String(body.refresh_token||credentials.refresh_token),id_token:body.id_token?String(body.id_token):credentials.id_token,expires_at:expiresAt,token_type:String(body.token_type||credentials.token_type||'Bearer'),scope:String(body.scope||credentials.scope||SCOPE),client_id:CLIENT_ID,redirect_uri:REDIRECT_URI};await save(userId,updated,row.account_hint||null,expiresAt);return updated}
async function checkConnection(userId:string){const {data:row,error}=await db.from('platform_connections').select('*').eq('user_id',userId).eq('provider',PROVIDER).maybeSingle();if(error)throw Error('connection_read_failed');if(!row)return{authenticated:false,status:'disconnected'};if(!row.credential_ciphertext)return{authenticated:null,status:row.status,lastError:row.last_error||null};try{const credentials=await decryptCredentials(row),active=await refresh(userId,row,credentials),info=await userInfo(String(active.access_token));if(!info.response.ok||!info.body?.sub){await mark(userId,'needs_login','userinfo_failed').catch(()=>{});return{authenticated:false,status:'needs_login'}}await mark(userId,'connected',null,{last_verified_at:new Date().toISOString(),account_hint:validEmail(info.body?.email)||row.account_hint});return{authenticated:true,status:'connected',accountReady:true,accountHint:validEmail(info.body?.email)||row.account_hint}}catch(error:any){if(error?.message==='needs_login')return{authenticated:false,status:'needs_login'};return{authenticated:false,status:'error'}}}
async function inspect(userId:string){const {data:row,error}=await db.from('platform_connections').select('*').eq('user_id',userId).eq('provider',PROVIDER).maybeSingle();if(error||!row)return{status:'disconnected',hasCredentials:false};const credentials=await decryptCredentials(row).catch(()=>null);return{status:row.status,lastError:row.last_error||null,hasCredentials:!!credentials,expiresAt:credentials?.expires_at||row.expires_at||null,hasRefreshToken:!!credentials?.refresh_token,accountHint:row.account_hint||null,clientId:credentials?.client_id||CLIENT_ID}}
async function disconnect(userId:string){await Promise.all([db.from('platform_connections').delete().eq('user_id',userId).eq('provider',PROVIDER),db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER)]);return{status:'disconnected'}}

const CORS={'access-control-allow-origin':HANDOFF_ORIGIN,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type','cache-control':'no-store','vary':'Origin'};
function publicJson(body:any,status=200){return Response.json(body,{status,headers:CORS})}
const PUBLIC_ERRORS=new Set(['login_failed','auth_flow_expired','invalid_state','mfa_unsupported','mfa_state_missing','mfa_factor_invalid','mfa_factor_required','mfa_code_required','mfa_invalid_code','mfa_challenge_failed','mfa_verification_failed','mfa_rejected','mfa_timeout','temporary_network_error']);
function publicError(error:any){const code=String(error?.message||'immoscout_operation_failed');let status=503;if(code==='login_failed'||code==='mfa_invalid_code')status=401;else if(code==='auth_flow_expired'||code==='invalid_state'||code==='mfa_timeout')status=410;else if(['mfa_unsupported','mfa_state_missing','mfa_factor_invalid','mfa_factor_required','mfa_code_required','mfa_verification_failed','mfa_rejected'].includes(code))status=409;else if(code==='mfa_challenge_failed')status=502;return publicJson({error:PUBLIC_ERRORS.has(code)?code:'immoscout_operation_failed'},status)}

Deno.serve(async req=>{try{
 const origin=req.headers.get('origin')||'';
 if(req.method==='OPTIONS'){if(origin!==HANDOFF_ORIGIN)return new Response('forbidden',{status:403});return new Response(null,{status:204,headers:CORS})}
 if(req.method!=='POST')return new Response('method not allowed',{status:405});
 const body=await req.json().catch(()=>({}));
 if(['password_login','mfa_status','mfa_select','mfa_verify'].includes(String(body.action||''))){
   if(origin!==HANDOFF_ORIGIN)return new Response('forbidden',{status:403});
   try{if(body.action==='password_login')return publicJson(await passwordLogin(String(body.state||''),body.email,body.password));if(body.action==='mfa_status')return publicJson(await mfaStatus(String(body.state||'')));if(body.action==='mfa_select')return publicJson(await mfaSelect(String(body.state||''),body.factorId));return publicJson(await mfaVerify(String(body.state||''),body.code))}catch(error:any){return publicError(error)}
 }
 if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
 if(body.action==='health')return Response.json({ok:true,mode:'immoscout-one-time-password-pkce-handoff',clientId:CLIENT_ID,redirectUri:REDIRECT_URI,marksConnectedAfterUserInfo:true,expiresInSeconds:1800,passwordStored:false,mfaSupported:true,transientMfaStateEncrypted:true});
 const userId=uuid(body.userId);if(body.action!=='disconnect')await eligible(userId);
 if(body.action==='login')return Response.json(await beginLogin(userId));
 if(body.action==='complete_login')return Response.json(await completeLogin(userId,String(body.callbackUrl||'')));
 if(body.action==='check')return Response.json(await checkConnection(userId));
 if(body.action==='inspect')return Response.json(await inspect(userId));
 if(body.action==='disconnect')return Response.json(await disconnect(userId));
 throw Error('invalid_action');
}catch(error:any){const code=String(error?.message||'immoscout_operation_failed'),safe=new Set(['configuration_unavailable','credential_key_invalid','premium_required','invalid_user','invalid_action','immoscout_email_required','auth_flow_create_failed','connection_update_failed','connection_save_failed','connection_read_failed','invalid_callback_url','invalid_state','auth_flow_expired','oauth_login_failed','authorization_code_missing','token_exchange_failed','refresh_token_missing','userinfo_failed','temporary_network_error','needs_login','login_failed','mfa_unsupported','mfa_state_missing','mfa_factor_invalid','mfa_factor_required','mfa_code_required','mfa_invalid_code','mfa_challenge_failed','mfa_verification_failed','mfa_rejected','mfa_timeout']);return Response.json({error:safe.has(code)?code:'immoscout_operation_failed'},{status:503})}});
