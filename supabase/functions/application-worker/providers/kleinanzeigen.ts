import {saveConnection,getConnection,markConnection,deleteConnection} from '../credentials.ts';
const DOMAIN='login.kleinanzeigen.de';
const LEGACY_CLIENT_ID='uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const LEGACY_REDIRECT_URI='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const SCOPE='openid email profile offline_access';
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

// The OAuth/session contract is verified. The first-message/new-conversation request
// is deliberately gated until a controlled two-account test proves its exact contract.
export async function sendKleinanzeigenApplication(){return {success:false,status:'manual_required',error:'provider_contract_unverified'};}
