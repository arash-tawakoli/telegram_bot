import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const GQL='https://gql-ps.immomio.com/tenant/graphql';
const TENANT='https://tenant.immomio.com';
const REDIRECT='https://tenant.immomio.com/robots.txt';
const SSO_HOST='sso.immomio.com';
const REALM='immomio';
const CLIENT_ID='immomio-oidc-web';
const LOGIN_METHOD='DEFAULT';
const HEADERS={'content-type':'application/json','accept':'application/json','origin':TENANT,'referer':`${TENANT}/`,'user-agent':'TraumWohnungHamburg/1.0'};
const SSO_QUERY=`query sso($email: String, $redirectUri: String!, $loginMethod: String) { sso(input: { email: $email redirectUri: $redirectUri loginMethod: $loginMethod }) { baseUrl clientId realm } }`;
const USER_QUERY=`query currentUser { user { id email } }`;
const enc=new TextEncoder();
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const b64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};
const unb64=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const validEmail=(v:any)=>{const s=String(v||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:null};
const uuid=(v:any)=>{const s=String(v||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw Error('invalid_user');return s};

async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data)}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required')}
async function challenge(v:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(v))))}
async function rawGraphql(query:string,variables:any,token?:string){const headers:any={...HEADERS};if(token)headers.authorization=`Bearer ${token}`;const response=await fetch(GQL,{method:'POST',headers,body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(25000)}),body=await response.json().catch(()=>null);return{response,body}}
async function resolveSso(email:string){const r=await rawGraphql(SSO_QUERY,{email,redirectUri:REDIRECT,loginMethod:LOGIN_METHOD});const s=r.body?.data?.sso;if(!r.response.ok||r.body?.errors?.length||!s)throw Error('immomio_sso_failed');let u:URL;try{u=new URL(String(s.baseUrl||''))}catch{throw Error('immomio_sso_contract_changed')}if(u.protocol!=='https:'||u.hostname!==SSO_HOST||String(s.realm)!==REALM||String(s.clientId)!==CLIENT_ID)throw Error('immomio_sso_contract_changed');return{baseUrl:`https://${SSO_HOST}/auth`,realm:REALM,clientId:CLIENT_ID}}
async function tokenRequest(cfg:any,payload:Record<string,string>){const response=await fetch(`${cfg.baseUrl}/realms/${encodeURIComponent(cfg.realm)}/protocol/openid-connect/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:new URLSearchParams({...payload,client_id:cfg.clientId}),signal:AbortSignal.timeout(25000)}),token=await response.json().catch(()=>null);return{response,token}}
function decodeEmail(token:any){try{const p=String(token||'').split('.')[1];if(!p)return null;return validEmail(JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=')))?.email)}catch{return null}}
async function keyMaterial(){const raw=unb64(await secret('application_credential_key_v1'));if(raw.length!==32)throw Error('credential_key_invalid');return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt'])}
async function encrypt(userId:string,value:any){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await keyMaterial(),aad=enc.encode(`${userId}:immomio:v1`),plain=enc.encode(JSON.stringify(value)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plain));return{credential_ciphertext:b64(cipher),credential_iv:b64(iv),key_version:1}}
async function profileEmail(userId:string){const {data,error}=await db.from('applicant_profiles').select('email').eq('user_id',userId).maybeSingle();const email=validEmail(data?.email);if(error||!email)throw Error('immomio_email_required');return email}
async function markPending(userId:string,email:string){const {error}=await db.from('platform_connections').upsert({user_id:userId,provider:'immomio',status:'pending',account_hint:email,last_error:null,updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});if(error)throw Error('connection_update_failed')}

async function begin(userId:string){
 const email=await profileEmail(userId),cfg=await resolveSso(email);
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','immomio').is('consumed_at',null);
 const verifier=random(),state=random().slice(0,40),cc=await challenge(verifier),{error}=await db.from('platform_auth_flows').insert({user_id:userId,provider:'immomio',state,code_verifier:verifier});if(error)throw Error('auth_flow_create_failed');
 await markPending(userId,email);
 const url=new URL(`${cfg.baseUrl}/realms/${encodeURIComponent(cfg.realm)}/protocol/openid-connect/auth`);
 const params={client_id:cfg.clientId,redirect_uri:REDIRECT,response_type:'code',scope:'openid profile email',state,code_challenge:cc,code_challenge_method:'S256',login_hint:email};
 for(const[k,v]of Object.entries(params))url.searchParams.set(k,String(v));
 return{status:'login',url:url.href,transport:'telegram-share-bridge',redirectUri:REDIRECT,reuseExistingSession:true,expiresInSeconds:600}
}

function callback(v:string){let u:URL;try{u=new URL(String(v||'').trim())}catch{throw Error('invalid_callback_url')}if(u.protocol!=='https:'||u.hostname!=='tenant.immomio.com'||u.port||u.username||u.password||u.pathname!=='/robots.txt')throw Error('invalid_callback_url');const state=u.searchParams.get('state'),code=u.searchParams.get('code');if(!state||!code)throw Error('invalid_callback_url');return{state,code}}
async function complete(userId:string,callbackUrl:string){
 const {state,code}=callback(callbackUrl),{data:flow,error}=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider','immomio').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();if(error||!flow)throw Error('auth_flow_expired');
 const email=await profileEmail(userId),cfg=await resolveSso(email),{response,token}=await tokenRequest(cfg,{grant_type:'authorization_code',code,redirect_uri:REDIRECT,code_verifier:String(flow.code_verifier||'')});
 if(!response.ok||!token?.access_token||!token?.refresh_token){await db.from('platform_connections').upsert({user_id:userId,provider:'immomio',status:'needs_login',last_error:'token_exchange_failed',updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});throw Error('token_exchange_failed')}
 const expiresAt=new Date(Date.now()+Math.max(60,Number(token.expires_in||300))*1000).toISOString(),hint=decodeEmail(token.id_token)||email,encrypted=await encrypt(userId,{access_token:String(token.access_token),refresh_token:String(token.refresh_token),expires_at:expiresAt,base_url:cfg.baseUrl,realm:cfg.realm,client_id:cfg.clientId,redirect_uri:REDIRECT});
 const verify=await rawGraphql(USER_QUERY,{},String(token.access_token)),account=verify.body?.data?.user;if(!verify.response.ok||verify.body?.errors?.length||!account?.id)throw Error('account_verification_failed');
 const {error:saveError}=await db.from('platform_connections').upsert({user_id:userId,provider:'immomio',status:'connected',...encrypted,account_hint:validEmail(account.email)||hint,expires_at:expiresAt,last_verified_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});if(saveError)throw Error('connection_save_failed');
 await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.id);
 return{status:'connected',authenticated:true,accountReady:true,accountHint:validEmail(account.email)||hint}
}

Deno.serve(async req=>{try{
 if(req.method!=='POST')return new Response('method not allowed',{status:405});
 if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
 const body=await req.json();if(body.action==='health')return Response.json({ok:true,mode:'immomio-pkce-share-robots',redirectUri:REDIRECT,reuseExistingSession:true});
 const userId=uuid(body.userId);await eligible(userId);
 if(body.action==='login')return Response.json(await begin(userId));
 if(body.action==='complete_login')return Response.json(await complete(userId,String(body.callbackUrl||'')));
 throw Error('invalid_action')
}catch(e:any){const safe=new Set(['configuration_unavailable','premium_required','invalid_user','invalid_action','immomio_email_required','immomio_sso_failed','immomio_sso_contract_changed','auth_flow_create_failed','invalid_callback_url','auth_flow_expired','token_exchange_failed','account_verification_failed','connection_save_failed','connection_update_failed','credential_key_invalid']);return Response.json({error:safe.has(e?.message)?e.message:'immomio_auth_bridge_failed'},{status:503})}});