import {saveConnection,getConnection,markConnection,deleteConnection} from '../credentials.ts';
const DOMAIN='login.kleinanzeigen.de';
const API_HOST='https://api.kleinanzeigen.de';
const GATEWAY_HOST='https://gateway.kleinanzeigen.de';
const LEGACY_CLIENT_ID='uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const LEGACY_REDIRECT_URI='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const SCOPE='openid email profile offline_access';
const APP_VERSION='2026.25.0';
const APP_BASIC='Basic '+btoa('android:TaR60pEttY');
const enc=new TextEncoder();
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
async function challenge(verifier:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))}
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));

export type KleinanzeigenOAuthConfig={clientId:string,redirectUri:string};
export const legacyKleinanzeigenOAuthConfig=():KleinanzeigenOAuthConfig=>({clientId:LEGACY_CLIENT_ID,redirectUri:LEGACY_REDIRECT_URI});

function oauthConfig(value?:KleinanzeigenOAuthConfig|null):KleinanzeigenOAuthConfig{
 if(!value)return legacyKleinanzeigenOAuthConfig();
 const clientId=String(value.clientId||'').trim(),redirectUri=String(value.redirectUri||'').trim();
 if(!clientId||clientId.length>512)throw Error('oauth_client_invalid');
 let parsed:URL;try{parsed=new URL(redirectUri)}catch{throw Error('oauth_redirect_invalid')}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('oauth_redirect_invalid');
 return {clientId,redirectUri:parsed.href};
}

function validateCallbackTarget(actual:URL,redirectUri:string){
 let expected:URL;try{expected=new URL(redirectUri)}catch{throw Error('oauth_redirect_invalid')}
 if(actual.protocol!==expected.protocol||actual.hostname!==expected.hostname||actual.port!==expected.port||actual.pathname!==expected.pathname)throw Error('invalid_callback_url');
 for(const [key,value] of expected.searchParams.entries())if(actual.searchParams.get(key)!==value)throw Error('invalid_callback_url');
}

async function optionalSecret(db:any,name:string){
 try{const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)return null;return String(data);}catch{return null;}
}

async function tokenRequest(db:any,clientId:string,payload:Record<string,unknown>){
 const configuredClientId=await optionalSecret(db,'kleinanzeigen_oauth_client_id');
 const clientSecret=configuredClientId===clientId?await optionalSecret(db,'kleinanzeigen_oauth_client_secret'):null;
 const body:any={...payload,client_id:clientId};
 if(clientSecret)body.client_secret=clientSecret;
 const response=await fetch(`https://${DOMAIN}/oauth/token`,{
  method:'POST',headers:{'content-type':'application/json','accept':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(30000)
 });
 const token=await response.json().catch(()=>null);
 return {response,token};
}

export async function beginKleinanzeigenLogin(db:any,userId:string,config?:KleinanzeigenOAuthConfig|null){
 const oauth=oauthConfig(config);
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','kleinanzeigen').is('consumed_at',null);
 const verifier=random(),state=random().slice(0,32),codeChallenge=await challenge(verifier);
 const {error}=await db.from('platform_auth_flows').insert({user_id:userId,provider:'kleinanzeigen',state,code_verifier:verifier});
 if(error)throw Error('auth_flow_create_failed');
 const url=new URL(`https://${DOMAIN}/authorize`);
 for(const [k,v] of Object.entries({client_id:oauth.clientId,response_type:'code',redirect_uri:oauth.redirectUri,scope:SCOPE,code_challenge:codeChallenge,code_challenge_method:'S256',state,prompt:'login'}))url.searchParams.set(k,String(v));
 await markConnection(db,userId,'kleinanzeigen','pending');
 const legacy=oauth.redirectUri===LEGACY_REDIRECT_URI;
 return {status:'login',url:url.href,requiresCallback:legacy,automaticCallback:!legacy,bridgeRequired:legacy,transport:legacy?'safari-extension-bridge':'direct-oauth'};
}

async function finishKleinanzeigenLogin(db:any,flow:any,redirectUrl:string,config?:KleinanzeigenOAuthConfig|null){
 const oauth=oauthConfig(config);
 let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}
 validateCallbackTarget(url,oauth.redirectUri);
 const code=url.searchParams.get('code'),state=url.searchParams.get('state');
 if(!code||!state||state!==String(flow.state))throw Error('invalid_callback_url');
 const {response,token}=await tokenRequest(db,oauth.clientId,{grant_type:'authorization_code',code,code_verifier:flow.code_verifier,redirect_uri:oauth.redirectUri});
 if(!response.ok||!token?.access_token||!token?.refresh_token)throw Error('token_exchange_failed');
 const expiresAt=new Date(Date.now()+Number(token.expires_in||600)*1000).toISOString();
 let accountHint:string|null=null;
 if(token.id_token){try{const p=token.id_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');accountHint=JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,'='))).email||null}catch{}}
 await saveConnection(db,flow.user_id,'kleinanzeigen',{
  access_token:token.access_token,
  refresh_token:token.refresh_token,
  expires_at:expiresAt,
  oauth_client_id:oauth.clientId,
  oauth_redirect_uri:oauth.redirectUri
 },{account_hint:accountHint,expires_at:expiresAt});
 await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.id);
 return {status:'connected',authenticated:true,accountHint,userId:String(flow.user_id)};
}

export async function completeKleinanzeigenLogin(db:any,userId:string,redirectUrl:string,config?:KleinanzeigenOAuthConfig|null){
 let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}
 const state=url.searchParams.get('state');if(!state)throw Error('invalid_callback_url');
 const {data:flow,error}=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider','kleinanzeigen').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
 if(error||!flow)throw Error('auth_flow_expired');
 return finishKleinanzeigenLogin(db,flow,url.href,config);
}

export async function completeKleinanzeigenCallback(db:any,redirectUrl:string,config?:KleinanzeigenOAuthConfig|null){
 let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}
 const oauth=oauthConfig(config);
 validateCallbackTarget(url,oauth.redirectUri);
 const state=url.searchParams.get('state');
 if(!state)throw Error('invalid_callback_url');
 const {data:flow,error}=await db.from('platform_auth_flows').select('*').eq('provider','kleinanzeigen').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
 if(error||!flow)throw Error('auth_flow_expired');
 if(url.searchParams.get('error')){
  await markConnection(db,String(flow.user_id),'kleinanzeigen','needs_login',String(url.searchParams.get('error')).slice(0,120)).catch(()=>{});
  throw Error('oauth_login_failed');
 }
 return finishKleinanzeigenLogin(db,flow,url.href,oauth);
}

async function refresh(db:any,userId:string,connection:any){
 const credentials=connection.credentials||{};
 if(credentials.access_token&&Date.parse(credentials.expires_at||'')>Date.now()+60000)return credentials;
 if(!credentials.refresh_token)throw Error('needs_login');
 const clientId=String(credentials.oauth_client_id||LEGACY_CLIENT_ID);
 const {response,token}=await tokenRequest(db,clientId,{grant_type:'refresh_token',refresh_token:credentials.refresh_token});
 if(!response.ok||!token?.access_token){await markConnection(db,userId,'kleinanzeigen','needs_login','refresh_failed');throw Error('needs_login');}
 const updated={
  ...credentials,
  access_token:token.access_token,
  refresh_token:token.refresh_token||credentials.refresh_token,
  expires_at:new Date(Date.now()+Number(token.expires_in||600)*1000).toISOString(),
  oauth_client_id:clientId
 };
 await saveConnection(db,userId,'kleinanzeigen',updated,{expires_at:updated.expires_at,account_hint:connection.row.account_hint});
 return updated;
}

export async function checkKleinanzeigenConnection(db:any,userId:string){
 const connection=await getConnection(db,userId,'kleinanzeigen');
 if(!connection)return {authenticated:false};
 try{await refresh(db,userId,connection);return {authenticated:true};}catch{return {authenticated:false};}
}
export async function disconnectKleinanzeigen(db:any,userId:string){await deleteConnection(db,userId,'kleinanzeigen');return {status:'disconnected'};}
export async function kleinanzeigenAccessToken(db:any,userId:string){const c=await getConnection(db,userId,'kleinanzeigen');if(!c)throw Error('needs_login');return (await refresh(db,userId,c)).access_token;}

function appBaseHeaders(){return {
 'X-EBAYK-APP':`${crypto.randomUUID()}${Date.now()}`,
 'X-ECG-USER-AGENT':`ebayk-android-app-${APP_VERSION}`,
 'X-ECG-USER-VERSION':APP_VERSION,
 'User-Agent':`Kleinanzeigen/${APP_VERSION} (Android 13; Pixel 7)`,
 'Accept':'application/json','Accept-Language':'de-DE'
};}
function mainApiHeaders(token?:string,email?:string){const headers:any={...appBaseHeaders(),Authorization:APP_BASIC};if(token){headers['X-EBAYK-USERID-TOKEN']=token;if(email)headers['X-ECG-Authorization-User']=`email=${email},access=${token}`;}return headers;}
function gatewayHeaders(token:string){return {...appBaseHeaders(),Authorization:`Bearer ${token}`,'Content-Type':'application/json'};}
function scalar(value:any):any{while(value&&typeof value==='object'&&'value' in value)value=value.value;return value;}
async function apiRequest(url:string,init:RequestInit){
 try{
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(30000)});
  const text=await response.text();let json:any=null;try{json=JSON.parse(text)}catch{}
  return {response,json,text};
 }catch(error:any){
  if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('temporary_network_error');
  throw Error('temporary_network_error');
 }
}
async function session(db:any,userId:string){
 const connection=await getConnection(db,userId,'kleinanzeigen');
 if(!connection)throw Error('needs_login');
 const credentials=await refresh(db,userId,connection),email=String(connection.row.account_hint||'').trim();
 if(!email)throw Error('needs_login');
 return {token:String(credentials.access_token),email};
}
async function accountId(db:any,userId:string){
 const s=await session(db,userId);
 const result=await apiRequest(`${API_HOST}/api/users/${encodeURIComponent(s.email)}/profile.json`,{method:'GET',headers:mainApiHeaders(s.token,s.email)});
 if(result.response.status===401||result.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login','profile_auth_failed').catch(()=>{});throw Error('needs_login');}
 if(!result.response.ok){if(result.response.status===429||result.response.status>=500)throw Error('temporary_network_error');throw Error('provider_contract_unverified');}
 const id=scalar(result.json?.data?.id??result.json?.id??result.json?.value?.id);
 if(!id)throw Error('provider_contract_unverified');
 return {...s,id:String(id)};
}
function conversationRows(body:any){let rows=body?.conversations??body?.data??[];if(rows&&typeof rows==='object'&&!Array.isArray(rows))rows=rows.conversations??rows.items??[];return Array.isArray(rows)?rows:[];}
async function listConversations(uid:string,token:string){
 const result=await apiRequest(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(uid)}/conversations?page=0&size=100`,{method:'GET',headers:gatewayHeaders(token)});
 if(result.response.status===401||result.response.status===403)throw Error('needs_login');
 if(!result.response.ok){if(result.response.status===429||result.response.status>=500)throw Error('temporary_network_error');throw Error('provider_contract_unverified');}
 return conversationRows(result.json);
}
async function openConversation(uid:string,conversationId:string,token:string){
 const result=await apiRequest(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(uid)}/conversations/${encodeURIComponent(conversationId)}?contentWarnings=true`,{method:'PUT',headers:gatewayHeaders(token)});
 if(!result.response.ok)return null;
 return result.json;
}
function outboundMessageExists(body:any,message:string){const rows=body?.messages??body?.data?.messages??[];return Array.isArray(rows)&&rows.some((entry:any)=>{const direction=String(entry?.boundness??entry?.direction??'').toUpperCase(),text=String(entry?.text??entry?.textShort??entry?.title??'').trim();return direction.includes('OUT')&&text===message.trim();});}
function createdConversationId(body:any){for(const value of [body?.id,body?.data?.id,body?.conversation?.id,body?.data?.conversation?.id,body?.value?.id]){const id=scalar(value);if(id)return String(id);}return null;}

export async function sendKleinanzeigenApplication(input:any){
 const {db,user,profile,listing,message,authorize}=input||{};
 const userId=String(user?.id||''),adId=String(listing?.external_id||listing?.source_listing_key||'').match(/\d{6,20}/)?.[0]||'';
 if(!userId||!adId||!message)return {success:false,status:'manual_required',error:'provider_contract_unverified'};
 const ad=await apiRequest(`${API_HOST}/api/ads/${encodeURIComponent(adId)}.json`,{method:'GET',headers:mainApiHeaders()});
 if(ad.response.status===404||ad.response.status===410)return {success:false,status:'failed',error:'listing_unavailable'};
 if(!ad.response.ok){if(ad.response.status===429||ad.response.status>=500)throw Error('temporary_network_error');return {success:false,status:'manual_required',error:'provider_contract_unverified'};}
 const account=await accountId(db,userId);
 let conversations=await listConversations(account.id,account.token);
 let existing=conversations.find((entry:any)=>String(entry?.adId??entry?.ad?.id??'')===adId&&String(entry?.role||'').toUpperCase()==='BUYER');
 if(existing?.id){
  const opened=await openConversation(account.id,String(existing.id),account.token);
  if(opened&&outboundMessageExists(opened,message))return {success:true,status:'sent'};
  return {success:false,status:'manual_required',error:'conversation_exists'};
 }
 if(typeof authorize!=='function'||await authorize()!==true)return {success:false,status:'failed',error:'send_not_authorized'};
 const contactName=String([profile?.first_name,profile?.last_name].filter(Boolean).join(' ')).trim().slice(0,120);
 if(!contactName)return {success:false,status:'manual_required',error:'profile_incomplete'};
 const createUrl=new URL(`${API_HOST}/api/users/${encodeURIComponent(account.id)}/create-conversation/${encodeURIComponent(adId)}`);createUrl.searchParams.set('contactName',contactName);
 const created=await apiRequest(createUrl.href,{method:'POST',headers:mainApiHeaders(account.token,account.email)});
 if(created.response.status===401||created.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login','create_conversation_auth_failed').catch(()=>{});return {success:false,status:'manual_required',error:'needs_login'};}
 if(!created.response.ok)return {success:false,status:'manual_required',error:'submission_unconfirmed'};
 let conversationId=createdConversationId(created.json);
 if(!conversationId){
  conversations=await listConversations(account.id,account.token);
  existing=conversations.find((entry:any)=>String(entry?.adId??entry?.ad?.id??'')===adId&&String(entry?.role||'').toUpperCase()==='BUYER');
  conversationId=existing?.id?String(existing.id):null;
 }
 if(!conversationId)return {success:false,status:'manual_required',error:'submission_unconfirmed'};
 const sendUrl=new URL(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(account.id)}/conversations/${encodeURIComponent(conversationId)}`);sendUrl.searchParams.set('warnPhoneNumber','false');sendUrl.searchParams.set('warnEmail','false');sendUrl.searchParams.set('warnBankDetails','false');
 const sent=await apiRequest(sendUrl.href,{method:'POST',headers:gatewayHeaders(account.token),body:JSON.stringify({message})});
 if(sent.response.status===401||sent.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login','message_auth_failed').catch(()=>{});return {success:false,status:'manual_required',error:'needs_login'};}
 if(!sent.response.ok)return {success:false,status:'manual_required',error:'submission_unconfirmed'};
 const opened=await openConversation(account.id,conversationId,account.token);
 if(!opened||!outboundMessageExists(opened,message))return {success:false,status:'manual_required',error:'submission_unconfirmed'};
 return {success:true,status:'sent'};
}
