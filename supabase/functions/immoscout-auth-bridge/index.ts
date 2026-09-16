import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const PROVIDER='immoscout';
const ISSUER='https://login.immobilienscout24.de/oauth2/aus1227au6oBg6hGH417';
const AUTHORIZE=`${ISSUER}/v1/authorize`;
const TOKEN=`${ISSUER}/v1/token`;
const USERINFO=`${ISSUER}/v1/userinfo`;
const CLIENT_ID='is24-sso-auth-de';
const REDIRECT_URI='https://sso.immobilienscout24.de/oidc/callback/';
const SCOPE='openid email profile offline_access';
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
function uuid(v:any){const s=String(v||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw Error('invalid_user');return s}
function validEmail(v:any){const e=clean(v,320).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required')}

async function mark(userId:string,status:string,lastError:string|null=null,patch:any={}){const {error}=await db.from('platform_connections').upsert({user_id:userId,provider:PROVIDER,status,last_error:lastError,updated_at:new Date().toISOString(),...patch},{onConflict:'user_id,provider'});if(error)throw Error('connection_update_failed')}
async function save(userId:string,credentials:any,accountHint:string|null,expiresAt:string){const encrypted=await encryptCredentials(userId,credentials);const {error}=await db.from('platform_connections').upsert({user_id:userId,provider:PROVIDER,status:'connected',account_hint:accountHint,...encrypted,expires_at:expiresAt,last_verified_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});if(error)throw Error('connection_save_failed')}

async function tokenRequest(payload:Record<string,string>){try{const response=await fetch(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:new URLSearchParams({...payload,client_id:CLIENT_ID}),signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
async function userInfo(accessToken:string){try{const response=await fetch(USERINFO,{headers:{accept:'application/json',authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}catch{throw Error('temporary_network_error')}}
function callbackParts(value:string){let url:URL;try{url=new URL(String(value||'').trim())}catch{throw Error('invalid_callback_url')}if(url.protocol!=='https:'||url.hostname!=='sso.immobilienscout24.de'||url.port||url.username||url.password||!['/oidc/callback','/oidc/callback/'].includes(url.pathname))throw Error('invalid_callback_url');const fragment=new URLSearchParams(url.hash.replace(/^#/,'').replace(/^\?/,'')),state=fragment.get('state')||url.searchParams.get('state'),code=fragment.get('code')||url.searchParams.get('code'),oauthError=fragment.get('error')||url.searchParams.get('error');return{url,state,code,oauthError}}

async function beginLogin(userId:string){
 const {data:profile,error:profileError}=await db.from('applicant_profiles').select('email').eq('user_id',userId).maybeSingle();
 const email=validEmail(profile?.email);if(profileError||!email)throw Error('immoscout_email_required');
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER).is('consumed_at',null);
 const verifier=random(),state=random().slice(0,43),codeChallenge=await challenge(verifier),{error:flowError}=await db.from('platform_auth_flows').insert({user_id:userId,provider:PROVIDER,state,code_verifier:verifier});if(flowError)throw Error('auth_flow_create_failed');
 await mark(userId,'pending',null,{account_hint:email,credential_ciphertext:null,credential_iv:null,key_version:1,expires_at:null,last_verified_at:null});
 const url=new URL(AUTHORIZE);for(const[k,v]of Object.entries({client_id:CLIENT_ID,response_type:'code',response_mode:'fragment',redirect_uri:REDIRECT_URI,scope:SCOPE,state,code_challenge:codeChallenge,code_challenge_method:'S256',login_hint:email,prompt:'login'}))url.searchParams.set(k,String(v));
 return{status:'login',url:url.href,requiresCallback:true,automaticCallback:false,bridgeRequired:true,transport:'telegram-share-fragment-pkce',expiresInSeconds:600};
}

async function completeLogin(userId:string,callbackUrl:string){
 const parsed=callbackParts(callbackUrl);if(!parsed.state)throw Error('invalid_callback_url');
 if(parsed.oauthError){await mark(userId,'needs_login',clean(parsed.oauthError,120)).catch(()=>{});throw Error('oauth_login_failed')}
 if(!parsed.code)throw Error('invalid_callback_url');
 const now=new Date().toISOString(),{data:flow,error:flowError}=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider',PROVIDER).eq('state',parsed.state).is('consumed_at',null).gt('expires_at',now).maybeSingle();if(flowError||!flow)throw Error('auth_flow_expired');
 const {data:claimed,error:claimError}=await db.from('platform_auth_flows').update({consumed_at:now}).eq('id',flow.id).is('consumed_at',null).select('id').maybeSingle();if(claimError||!claimed)throw Error('auth_flow_expired');
 const {response,body}=await tokenRequest({grant_type:'authorization_code',code:parsed.code,redirect_uri:REDIRECT_URI,code_verifier:String(flow.code_verifier||'')});
 if(!response.ok||!body?.access_token){const reason=clean(`${body?.error||'token_exchange_failed'}:${body?.error_description||response.status}`,120);await mark(userId,'needs_login',reason).catch(()=>{});throw Error('token_exchange_failed')}
 if(!body?.refresh_token){await mark(userId,'needs_login','refresh_token_missing').catch(()=>{});throw Error('refresh_token_missing')}
 const info=await userInfo(String(body.access_token));if(!info.response.ok||!info.body?.sub){await mark(userId,'needs_login','userinfo_failed').catch(()=>{});throw Error('userinfo_failed')}
 const accountHint=validEmail(info.body?.email),expiresAt=new Date(Date.now()+Math.max(60,Number(body.expires_in||3600))*1000).toISOString();
 await save(userId,{access_token:String(body.access_token),refresh_token:String(body.refresh_token),id_token:body.id_token?String(body.id_token):null,expires_at:expiresAt,token_type:String(body.token_type||'Bearer'),scope:String(body.scope||SCOPE),client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,issuer:ISSUER,sub:String(info.body.sub)},accountHint,expiresAt);
 return{status:'connected',authenticated:true,accountReady:true,accountHint};
}

async function refresh(userId:string,row:any,credentials:any){if(credentials?.access_token&&Date.parse(credentials.expires_at||'')>Date.now()+60000)return credentials;if(!credentials?.refresh_token)throw Error('needs_login');const {response,body}=await tokenRequest({grant_type:'refresh_token',refresh_token:String(credentials.refresh_token)});if(!response.ok||!body?.access_token){await mark(userId,'needs_login','refresh_failed').catch(()=>{});throw Error('needs_login')}const expiresAt=new Date(Date.now()+Math.max(60,Number(body.expires_in||3600))*1000).toISOString(),updated={...credentials,access_token:String(body.access_token),refresh_token:String(body.refresh_token||credentials.refresh_token),id_token:body.id_token?String(body.id_token):credentials.id_token,expires_at:expiresAt,token_type:String(body.token_type||credentials.token_type||'Bearer'),scope:String(body.scope||credentials.scope||SCOPE)};await save(userId,updated,row.account_hint||null,expiresAt);return updated}
async function checkConnection(userId:string){const {data:row,error}=await db.from('platform_connections').select('*').eq('user_id',userId).eq('provider',PROVIDER).maybeSingle();if(error)throw Error('connection_read_failed');if(!row)return{authenticated:false,status:'disconnected'};if(!row.credential_ciphertext)return{authenticated:null,status:row.status,lastError:row.last_error||null};try{const credentials=await decryptCredentials(row),active=await refresh(userId,row,credentials),info=await userInfo(String(active.access_token));if(!info.response.ok||!info.body?.sub){await mark(userId,'needs_login','userinfo_failed').catch(()=>{});return{authenticated:false,status:'needs_login'}}await mark(userId,'connected',null,{last_verified_at:new Date().toISOString(),account_hint:validEmail(info.body?.email)||row.account_hint});return{authenticated:true,status:'connected',accountReady:true,accountHint:validEmail(info.body?.email)||row.account_hint}}catch(error:any){if(error?.message==='needs_login')return{authenticated:false,status:'needs_login'};return{authenticated:false,status:'error'}}}
async function inspect(userId:string){const {data:row,error}=await db.from('platform_connections').select('*').eq('user_id',userId).eq('provider',PROVIDER).maybeSingle();if(error||!row)return{status:'disconnected',hasCredentials:false};const credentials=await decryptCredentials(row).catch(()=>null);return{status:row.status,lastError:row.last_error||null,hasCredentials:!!credentials,expiresAt:credentials?.expires_at||row.expires_at||null,hasRefreshToken:!!credentials?.refresh_token,accountHint:row.account_hint||null}}
async function disconnect(userId:string){await Promise.all([db.from('platform_connections').delete().eq('user_id',userId).eq('provider',PROVIDER),db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER)]);return{status:'disconnected'}}

Deno.serve(async req=>{try{
 if(req.method!=='POST')return new Response('method not allowed',{status:405});
 if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
 const body=await req.json().catch(()=>({}));
 if(body.action==='health')return Response.json({ok:true,mode:'immoscout-okta-pkce-telegram-share',responseMode:'fragment',redirectUri:REDIRECT_URI,marksConnectedAfterUserInfo:true});
 const userId=uuid(body.userId);if(body.action!=='disconnect')await eligible(userId);
 if(body.action==='login')return Response.json(await beginLogin(userId));
 if(body.action==='complete_login')return Response.json(await completeLogin(userId,String(body.callbackUrl||'')));
 if(body.action==='check')return Response.json(await checkConnection(userId));
 if(body.action==='inspect')return Response.json(await inspect(userId));
 if(body.action==='disconnect')return Response.json(await disconnect(userId));
 throw Error('invalid_action');
}catch(error:any){const code=String(error?.message||'immoscout_operation_failed'),safe=new Set(['configuration_unavailable','credential_key_invalid','premium_required','invalid_user','invalid_action','immoscout_email_required','auth_flow_create_failed','connection_update_failed','connection_save_failed','connection_read_failed','invalid_callback_url','auth_flow_expired','oauth_login_failed','token_exchange_failed','refresh_token_missing','userinfo_failed','temporary_network_error','needs_login']);return Response.json({error:safe.has(code)?code:'immoscout_operation_failed'},{status:503})}});
