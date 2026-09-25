import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const db=createClient(SUPABASE_URL,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const APPLICATION_WORKER=`${SUPABASE_URL}/functions/v1/application-worker`;
const IMMOMIO_AUTH=`${SUPABASE_URL}/functions/v1/immomio-account`;
const SCOUT_AUTH=`${SUPABASE_URL}/functions/v1/immoscout-auth-bridge`;
const IMMOWELT_AUTH=`${SUPABASE_URL}/functions/v1/immowelt-auth-bridge`;
const SUPABASE_ORIGIN=new URL(SUPABASE_URL).origin;
const KLEIN_AUTHORIZE='https://login.kleinanzeigen.de/authorize';
const KLEIN_CLIENT_ID='uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const KLEIN_REDIRECT='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const KLEIN_SCOPE='openid email profile offline_access';
const IMMOMIO_GQL='https://gql-ps.immomio.com/tenant/graphql';
const IMMOMIO_TENANT='https://tenant.immomio.com';
const IMMOMIO_REDIRECT='https://tenant.immomio.com/de/auth/login';
const IMMOMIO_CLIENT='immomio-oidc-web';
const IMMOMIO_REALM='immomio';
const IMMOMIO_BASE='https://sso.immomio.com/auth';
const enc=new TextEncoder();

const clean=(v:any,max=500)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const b64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};
const unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function challenge(v:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(v))))}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required')}
async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data)}
function providerLabel(provider:any){return provider==='kleinanzeigen'?'Kleinanzeigen':provider==='immomio'?'Immomio':provider==='immowelt'?'Immowelt':'ImmoScout24'}
async function notifyConnected(flow:any,result:any){
 if(flow?.return_target!=='telegram'||(result?.authenticated!==true&&result?.status!=='connected'))return;
 try{
  const {data:user}=await db.from('bot_users').select('chat_id').eq('id',flow.user_id).maybeSingle();
  if(!user?.chat_id)return;
  const token=await secret('telegram_bot_token_runtime'),name=providerLabel(flow.provider);
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:user.chat_id,parse_mode:'HTML',text:`✅ <b>${name} verbunden</b>\n\nDein Konto wurde erfolgreich verbunden.`}),signal:AbortSignal.timeout(10000)});
 }catch(error){console.error('telegram_connection_notice',String(error))}
}
function ticket(value:any){const v=String(value||'');if(!/^[A-Za-z0-9_-]{20,100}$/.test(v))throw Error('invalid_ticket');return v}
async function validateFlowContext(flow:any){
 const userId=String(flow.user_id||'');
 const{data:user,error:userError}=await db.from('bot_users').select('is_active,telegram_user_id,chat_id').eq('id',userId).maybeSingle();
 if(userError||!user?.is_active)throw Error('auth_flow_expired');
 if(flow.origin==='telegram'){
  if(user.telegram_user_id==null||user.chat_id==null)throw Error('auth_flow_expired');
  return;
 }
 if(flow.origin==='coach'){
  const expectedVersion=Number(flow.context?.assignment_version);
  const{data:assignment,error:assignmentError}=await db.from('coaching_participants').select('workspace_id,coach_member_id,status,assignment_version').eq('user_id',userId).maybeSingle();
  if(assignmentError||!assignment||assignment.status!=='active'||!Number.isFinite(expectedVersion)||Number(assignment.assignment_version)!==expectedVersion)throw Error('auth_flow_expired');
  const{data:issuer,error:issuerError}=await db.from('coaching_members').select('id,workspace_id,role,is_active').eq('auth_user_id',flow.issued_by).maybeSingle();
  if(issuerError||!issuer?.is_active||issuer.workspace_id!==assignment.workspace_id)throw Error('auth_flow_expired');
  const{data:workspace,error:workspaceError}=await db.from('coaching_workspaces').select('is_active,operations_paused').eq('id',issuer.workspace_id).maybeSingle();
  if(workspaceError||!workspace?.is_active||workspace.operations_paused)throw Error('auth_flow_expired');
  if(issuer.role!=='admin'&&issuer.id!==assignment.coach_member_id)throw Error('auth_flow_expired');
 }
}
async function flowFor(value:any,allowConsumed=false){
 const state=ticket(value),hashed=await challenge(state),now=new Date().toISOString();
 let q=db.from('platform_auth_flows').select('*').in('state',[state,hashed]);
 if(!allowConsumed)q=q.is('consumed_at',null).gt('expires_at',now);
 else q=q.gt('created_at',new Date(Date.now()-2*60*60*1000).toISOString());
 const {data,error}=await q.limit(2);
 if(error||!Array.isArray(data)||data.length!==1)throw Error('auth_flow_expired');
 const flow=data[0];await eligible(String(flow.user_id));await validateFlowContext(flow);
 if(!['kleinanzeigen','immoscout','immomio','immowelt'].includes(String(flow.provider)))throw Error('provider_unsupported');
 return flow
}
async function profileEmail(userId:string){const {data,error}=await db.from('applicant_profiles').select('email').eq('user_id',userId).maybeSingle();const email=clean(data?.email,320).toLowerCase();if(error||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('profile_email_required');return email}
function participantLabel(first:any,last:any){const f=clean(first,80),l=clean(last,80);return [f,l?l[0]+'.':''].filter(Boolean).join(' ')||'Teilnehmer'}
async function participantInfo(flow:any){
 const[{data:p},{data:connection}]=await Promise.all([
  db.from('applicant_profiles').select('first_name,last_name,email').eq('user_id',flow.user_id).maybeSingle(),
  db.from('platform_connections').select('status,account_hint,last_verified_at,last_error').eq('user_id',flow.user_id).eq('provider',flow.provider).maybeSingle()
 ]);
 return{
  participantLabel:participantLabel(p?.first_name,p?.last_name),
  profileEmail:clean(p?.email,320)||null,
  connection:connection||null
 };
}
async function accountHint(flow:any){const {data}=await db.from('platform_connections').select('account_hint').eq('user_id',flow.user_id).eq('provider',flow.provider).maybeSingle();return clean(data?.account_hint,320)||null}
function kleinUrl(flow:any,codeChallenge:string){const u=new URL(KLEIN_AUTHORIZE);for(const[k,v]of Object.entries({client_id:KLEIN_CLIENT_ID,response_type:'code',redirect_uri:KLEIN_REDIRECT,scope:KLEIN_SCOPE,code_challenge:codeChallenge,code_challenge_method:'S256',state:String(flow.state),prompt:'login'}))u.searchParams.set(k,String(v));return u.href}
async function resolveSso(email:string){const query='query sso($email: String, $redirectUri: String!, $loginMethod: String) { sso(input: { email: $email redirectUri: $redirectUri loginMethod: $loginMethod }) { baseUrl clientId realm } }';let response:Response;try{response=await fetch(IMMOMIO_GQL,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','origin':IMMOMIO_TENANT,'referer':IMMOMIO_TENANT+'/'},body:JSON.stringify({query,variables:{email,redirectUri:IMMOMIO_REDIRECT,loginMethod:'DEFAULT'}}),signal:AbortSignal.timeout(20000)})}catch{throw Error('temporary_network_error')}const body=await response.json().catch(()=>null),sso=body?.data?.sso;if(!response.ok||body?.errors?.length||!sso||String(sso.clientId)!==IMMOMIO_CLIENT||String(sso.realm)!==IMMOMIO_REALM)throw Error('provider_contract_unverified');return{baseUrl:IMMOMIO_BASE,realm:IMMOMIO_REALM,clientId:IMMOMIO_CLIENT}}
async function immomioUrl(flow:any,codeChallenge:string,emailValue:any){const email=clean(emailValue,320).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('provider_email_required');const cfg=await resolveSso(email);const u=new URL(`${cfg.baseUrl}/realms/${IMMOMIO_REALM}/protocol/openid-connect/auth`);for(const[k,v]of Object.entries({client_id:IMMOMIO_CLIENT,redirect_uri:IMMOMIO_REDIRECT,response_type:'code',response_mode:'query',scope:'openid profile email',state:String(flow.state),code_challenge:codeChallenge,code_challenge_method:'S256',login_hint:email,prompt:'login'}))u.searchParams.set(k,String(v));return u.href}
async function resolve(value:any){
 const flow=await flowFor(value),provider=String(flow.provider),hint=await accountHint(flow),info=await participantInfo(flow);
 const base={ok:true,provider,accountHint:hint,participantLabel:info.participantLabel,origin:flow.origin,returnTarget:flow.return_target,expiresAt:flow.expires_at};
 if(provider==='immoscout'||provider==='immomio'||provider==='immowelt')return{...base,mode:'credentials'};
 const verifier=String(flow.code_verifier||'');if(!verifier)throw Error('auth_flow_expired');const codeChallenge=await challenge(verifier);
 if(provider==='kleinanzeigen')return{...base,mode:'provider_web',url:kleinUrl(flow,codeChallenge),requiresManualCallback:false,callbackTransport:'remote-browser-handoff'};
 if(provider==='immomio'){
  const email=clean(info.profileEmail,320);
  return{...base,mode:'provider_web',url:await immomioUrl(flow,codeChallenge,email),requiresManualCallback:true,callbackTransport:'provider-pkce'};
 }
 throw Error('provider_unsupported')
}
async function providerWeb(value:any,emailValue:any){
 const flow=await flowFor(value),verifier=String(flow.code_verifier||'');if(!verifier)throw Error('auth_flow_expired');
 const codeChallenge=await challenge(verifier),provider=String(flow.provider);
 if(provider==='kleinanzeigen')return{provider,url:kleinUrl(flow,codeChallenge)};
 if(provider==='immomio'){
  const hint=clean(emailValue,320)||await accountHint(flow);
  return{provider,url:await immomioUrl(flow,codeChallenge,hint)}
 }
 throw Error('provider_unsupported')
}
function decodeEmail(token:any){try{const p=String(token||'').split('.')[1];if(!p)return null;const json=JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=')));const email=clean(json?.email,320).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null}catch{return null}}
async function encryptConnection(userId:string,value:any){const raw=unb64(await secret('application_credential_key_v1'));if(raw.length!==32)throw Error('configuration_unavailable');const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),plain=enc.encode(JSON.stringify(value)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`${userId}:immomio:v1`)},key,plain));return{credential_ciphertext:b64(cipher),credential_iv:b64(iv),key_version:1}}
async function encryptProviderConnection(userId:string,provider:string,value:any){const raw=unb64(await secret('application_credential_key_v1'));if(raw.length!==32)throw Error('configuration_unavailable');const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),plain=enc.encode(JSON.stringify(value)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`${userId}:${provider}:v1`)},key,plain));return{credential_ciphertext:b64(cipher),credential_iv:b64(iv),key_version:1}}
function immoweltSession(value:any){const s=value&&typeof value==='object'?value:{};const cookies=Array.isArray(s.cookies)?s.cookies:[];if(!cookies.length||cookies.length>100)throw Error('provider_completion_failed');const safe=[];for(const row of cookies){const name=clean(row?.name,240),val=String(row?.value??'').slice(0,12000),domain=clean(row?.domain,320).toLowerCase();if(!name||!val||(!domain.endsWith('.immowelt.de')&&domain!=='immowelt.de'&&domain!=='signin.immowelt.de'))continue;safe.push({name,value:val,domain,path:clean(row?.path,500)||'/',expires:Number.isFinite(Number(row?.expires))?Number(row.expires):-1,httpOnly:row?.httpOnly===true,secure:row?.secure!==false,sameSite:clean(row?.sameSite,40)||undefined})}if(!safe.length)throw Error('provider_completion_failed');return{cookies:safe,userAgent:clean(s.userAgent,500)||'TraumWohnungHamburg/1.0'}}
async function completeSession(value:any,sessionValue:any,accountHintValue:any){const flow=await flowFor(value);if(String(flow.provider)!=='immowelt')throw Error('provider_unsupported');const session=immoweltSession(sessionValue),accountHint=clean(accountHintValue,320).toLowerCase();if(accountHint&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountHint))throw Error('provider_completion_failed');const encrypted=await encryptProviderConnection(String(flow.user_id),'immowelt',session),now=new Date().toISOString();const{error}=await db.from('platform_connections').upsert({user_id:flow.user_id,provider:'immowelt',status:'connected',...encrypted,account_hint:accountHint||null,expires_at:null,last_verified_at:now,last_error:null,updated_at:now},{onConflict:'user_id,provider'});if(error)throw Error('provider_completion_failed');await db.from('platform_auth_flows').update({consumed_at:now}).eq('id',flow.id);const result={status:'connected',authenticated:true,accountHint:accountHint||null,passwordStored:false,sessionStoredEncrypted:true};await notifyConnected(flow,result);return result}

async function verifyImmomio(accessToken:string){const query='query currentUser { user { id email } }';let response:Response;try{response=await fetch(IMMOMIO_GQL,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','origin':IMMOMIO_TENANT,'referer':IMMOMIO_TENANT+'/',authorization:accessToken},body:JSON.stringify({query,variables:{}}),signal:AbortSignal.timeout(20000)})}catch{throw Error('temporary_network_error')}const body=await response.json().catch(()=>null),user=body?.data?.user;if(!response.ok||body?.errors?.length||!user?.id)throw Error('token_exchange_failed');return user}
async function immomioPasswordLogin(value:any,emailValue:any,passwordValue:any){const flow=await flowFor(value);if(String(flow.provider)!=='immomio')throw Error('provider_unsupported');const email=clean(emailValue,320).toLowerCase(),password=String(passwordValue||'').slice(0,1024);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!password)throw Error('login_failed');const cfg=await resolveSso(email);let response:Response;try{response=await fetch(`${cfg.baseUrl}/realms/${cfg.realm}/protocol/openid-connect/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:new URLSearchParams({grant_type:'password',client_id:cfg.clientId,username:email,password,scope:'openid profile email'}),signal:AbortSignal.timeout(25000)})}catch{throw Error('temporary_network_error')}const token=await response.json().catch(()=>null);if(!response.ok||!token?.access_token||!token?.refresh_token){const desc=clean(token?.error_description,500).toLowerCase(),code=clean(token?.error,120).toLowerCase();if(/otp|totp|one.?time|authenticator|two.?factor/.test(desc))throw Error('provider_interactive_challenge');if(/temporar.*(disabled|locked)|account.*(disabled|locked)|too many.*(attempt|login)|brute.?force|locked out/.test(desc))throw Error('account_temporarily_locked');if(response.status===400||response.status===401||code==='invalid_grant')throw Error('login_failed');throw Error('provider_contract_unverified')}const user=await verifyImmomio(String(token.access_token)),verifiedEmail=clean(user?.email,320).toLowerCase()||decodeEmail(token.id_token)||email,expiresAt=new Date(Date.now()+Math.max(60,Number(token.expires_in||300))*1000).toISOString(),credentials={access_token:String(token.access_token),refresh_token:String(token.refresh_token),id_token:token.id_token?String(token.id_token):undefined,expires_at:expiresAt,base_url:cfg.baseUrl,realm:cfg.realm,client_id:cfg.clientId,redirect_uri:IMMOMIO_REDIRECT},encrypted=await encryptConnection(String(flow.user_id),credentials),now=new Date().toISOString();const {error}=await db.from('platform_connections').upsert({user_id:flow.user_id,provider:'immomio',status:'connected',...encrypted,account_hint:verifiedEmail,expires_at:expiresAt,last_verified_at:now,last_error:null,updated_at:now},{onConflict:'user_id,provider'});if(error)throw Error('provider_completion_failed');await db.from('platform_auth_flows').update({consumed_at:now}).eq('id',flow.id);return{status:'connected',authenticated:true,accountHint:verifiedEmail,passwordStored:false}}
function callbackFor(flow:any,value:any){const raw=String(value||'').trim();if(!raw||raw.length>8000)throw Error('invalid_callback_url');let u:URL;try{u=new URL(raw)}catch{throw Error('invalid_callback_url')}if(u.searchParams.get('state')!==String(flow.state))throw Error('invalid_callback_url');if(flow.provider==='kleinanzeigen'){if(u.protocol!=='https:'||u.hostname!=='login.kleinanzeigen.de'||u.pathname!=='/android/com.ebay.kleinanzeigen/callback'||(!u.searchParams.get('code')&&!u.searchParams.get('error')))throw Error('invalid_callback_url')}else if(flow.provider==='immomio'){if(u.protocol!=='https:'||u.hostname!=='tenant.immomio.com'||u.pathname!=='/de/auth/login'||!u.searchParams.get('code'))throw Error('invalid_callback_url')}else throw Error('provider_unsupported');return u.href}
async function internalCall(endpoint:string,body:any){const internal=await secret('internal_worker_secret'),r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)}),data=await r.json().catch(()=>null);if(!r.ok||!data)throw Error(data?.error||'provider_completion_failed');return data}
async function scoutPublic(body:any){
 const r=await fetch(SCOUT_AUTH,{method:'POST',headers:{'content-type':'application/json','origin':SUPABASE_ORIGIN},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok||!data){const e:any=new Error(data?.error||'provider_completion_failed');e.status=r.status;throw e}
 return data
}
async function passwordLogin(value:any,emailValue:any,passwordValue:any){
 const flow=await flowFor(value);let result:any;
 if(flow.provider==='immomio')result=await immomioPasswordLogin(value,emailValue,passwordValue);
 else if(flow.provider==='immoscout')result=await scoutPublic({action:'password_login',state:String(flow.state),email:emailValue,password:passwordValue});
 else if(flow.provider==='immowelt'){
  result=await internalCall(IMMOWELT_AUTH,{action:'password_login',state:String(flow.state),email:emailValue,password:passwordValue});
  if(result?.authenticated===true&&result?.session)return completeSession(value,result.session,result.accountHint||emailValue);
  return result;
 }else throw Error('provider_route_required');
 await notifyConnected(flow,result);return result
}
async function mfaStart(value:any,mfaTicket:any,factorId:any){
 const flow=await flowFor(value);
 if(flow.provider==='immowelt'){
  const result=await internalCall(IMMOWELT_AUTH,{action:'mfa_start',mfaTicket:String(mfaTicket||''),factorId:String(factorId||'')});
  if(result?.authenticated===true&&result?.session)return completeSession(value,result.session,result.accountHint);
  return result;
 }
 if(flow.provider!=='immoscout')throw Error('provider_interactive_challenge');
 return scoutPublic({action:'mfa_start',mfaTicket:String(mfaTicket||''),factorId:String(factorId||'')})
}
async function mfaVerify(value:any,mfaTicket:any,factorId:any,passCode:any){
 const flow=await flowFor(value);
 if(flow.provider==='immowelt'){
  const result=await internalCall(IMMOWELT_AUTH,{action:'mfa_verify',mfaTicket:String(mfaTicket||''),factorId:String(factorId||''),passCode:String(passCode||'')});
  if(result?.authenticated===true&&result?.session)return completeSession(value,result.session,result.accountHint);
  return result;
 }
 if(flow.provider!=='immoscout')throw Error('provider_interactive_challenge');
 const result=await scoutPublic({action:'mfa_verify',mfaTicket:String(mfaTicket||''),factorId:String(factorId||''),passCode:String(passCode||'')});
 await notifyConnected(flow,result);return result
}
async function status(value:any){
 const flow=await flowFor(value,true),info=await participantInfo(flow),connection=info.connection;
 return{ok:true,provider:flow.provider,status:connection?.status||'disconnected',connected:connection?.status==='connected',accountHint:connection?.account_hint||null,lastVerifiedAt:connection?.last_verified_at||null,lastError:connection?.last_error||null,participantLabel:info.participantLabel,origin:flow.origin,returnTarget:flow.return_target}
}
async function completeWeb(value:any,callbackUrl:any){
 const flow=await flowFor(value),userId=String(flow.user_id);let result:any;
 if(flow.provider==='immoscout')result=await internalCall(SCOUT_AUTH,{action:'complete_login',userId,callbackUrl:String(callbackUrl||'')});
 else{
  const url=callbackFor(flow,callbackUrl);
  if(flow.provider==='kleinanzeigen')throw Error('provider_route_required');
  if(flow.provider==='immomio')result=await internalCall(IMMOMIO_AUTH,{action:'complete_login',userId,callbackUrl:url});
  else throw Error('provider_unsupported');
 }
 await notifyConnected(flow,result);return result
}
const HEADERS={'content-type':'application/json','cache-control':'no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
function json(body:any,status=200){return new Response(JSON.stringify(body),{status,headers:HEADERS})}
function publicError(error:any){const code=String(error?.message||'auth_facade_failed'),safe=new Set(['invalid_ticket','auth_flow_expired','premium_required','provider_unsupported','profile_email_required','provider_contract_unverified','temporary_network_error','invalid_action','invalid_callback_url','provider_completion_failed','token_exchange_failed','login_failed','provider_interactive_challenge','human_verification_required','device_confirmation_required','provider_route_required','provider_email_required','mfa_required','mfa_factor_unsupported','mfa_invalid_code','mfa_challenge_failed','mfa_expired','invalid_state','account_temporarily_locked']);const status=code==='invalid_ticket'||code==='invalid_callback_url'?400:code==='auth_flow_expired'||code==='mfa_expired'||code==='invalid_state'?410:code==='premium_required'?403:code==='account_temporarily_locked'?423:code==='login_failed'||code==='mfa_invalid_code'?401:code.startsWith('mfa_')||code==='provider_interactive_challenge'||code==='human_verification_required'||code==='device_confirmation_required'||code==='provider_route_required'?409:503;return json({error:safe.has(code)?code:'auth_facade_failed'},status)}
Deno.serve(async req=>{try{
 if(req.method!=='POST')return new Response('method not allowed',{status:405,headers:{'cache-control':'no-store'}});
 const body=await req.json().catch(()=>({})),action=String(body.action||'');
 if(action==='resolve')return json(await resolve(body.ticket));
 if(action==='status')return json(await status(body.ticket));
 if(action==='provider_web')return json(await providerWeb(body.ticket,body.email));
 if(action==='password_login')return json(await passwordLogin(body.ticket,body.email,body.password));
 if(action==='mfa_start')return json(await mfaStart(body.ticket,body.mfaTicket,body.factorId));
 if(action==='mfa_verify')return json(await mfaVerify(body.ticket,body.mfaTicket,body.factorId,body.passCode));
 if(action==='complete_web')return json(await completeWeb(body.ticket,body.callbackUrl));
 if(action==='complete_session')return json(await completeSession(body.ticket,body.session,body.accountHint));
 throw Error('invalid_action')
}catch(error:any){return publicError(error)}});
