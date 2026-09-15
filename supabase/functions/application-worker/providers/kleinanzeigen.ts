import {decryptCredentials,getConnection,markConnection,saveConnection} from '../credentials.ts';

const AUTH0_DOMAIN='login.kleinanzeigen.de';
const CLIENT_ID='uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const REDIRECT_URI='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const SCOPE='openid email profile offline_access';
const AUTHORIZE_URL=`https://${AUTH0_DOMAIN}/authorize`;
const TOKEN_URL=`https://${AUTH0_DOMAIN}/oauth/token`;
const encoder=new TextEncoder();

const b64url=(bytes:Uint8Array)=>{let raw='';for(const b of bytes)raw+=String.fromCharCode(b);return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
async function pkce(){const verifier=b64url(crypto.getRandomValues(new Uint8Array(32)));const digest=await crypto.subtle.digest('SHA-256',encoder.encode(verifier));return {verifier,challenge:b64url(new Uint8Array(digest))};}
function jwtClaims(token:string){try{const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const json=atob(part+'='.repeat((4-part.length%4)%4));return JSON.parse(json);}catch{return {};}}

async function tokenRequest(payload:Record<string,string>){
 const response=await fetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','user-agent':'Kleinanzeigen Android'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data?.access_token)throw Error(response.status===400?'platform_login_rejected':'platform_login_unavailable');
 return data;
}

export async function beginKleinanzeigenLogin(db:any,userId:string){
 const {verifier,challenge}=await pkce(),state=b64url(crypto.getRandomValues(new Uint8Array(18)));
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','kleinanzeigen').is('consumed_at',null);
 const {error}=await db.from('platform_auth_flows').insert({user_id:userId,provider:'kleinanzeigen',state,code_verifier:verifier,expires_at:new Date(Date.now()+10*60_000).toISOString()});
 if(error)throw Error('platform_login_state_failed');
 await markConnection(db,userId,'kleinanzeigen',{status:'pending',last_error:null});
 const params=new URLSearchParams({client_id:CLIENT_ID,response_type:'code',redirect_uri:REDIRECT_URI,scope:SCOPE,code_challenge:challenge,code_challenge_method:'S256',state,prompt:'login'});
 return {status:'login',url:`${AUTHORIZE_URL}?${params}`,requiresCallback:true,expiresIn:600};
}

export async function completeKleinanzeigenLogin(db:any,userId:string,redirectUrl:string){
 let url:URL;try{url=new URL(String(redirectUrl||'').trim());}catch{throw Error('platform_callback_invalid');}
 if(url.hostname!==AUTH0_DOMAIN||url.pathname!=='/android/com.ebay.kleinanzeigen/callback')throw Error('platform_callback_invalid');
 const code=url.searchParams.get('code'),state=url.searchParams.get('state');
 if(!code||!state)throw Error('platform_callback_invalid');
 const {data:flow,error}=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider','kleinanzeigen').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
 if(error||!flow?.code_verifier)throw Error('platform_login_expired');
 const data=await tokenRequest({grant_type:'authorization_code',client_id:CLIENT_ID,code,code_verifier:String(flow.code_verifier),redirect_uri:REDIRECT_URI});
 if(!data.refresh_token)throw Error('platform_refresh_token_missing');
 const claims=jwtClaims(String(data.id_token||'')),expiresAt=new Date(Date.now()+Number(data.expires_in||600)*1000).toISOString();
 await saveConnection(db,userId,'kleinanzeigen',{refresh_token:String(data.refresh_token),access_token:String(data.access_token),access_expires_at:expiresAt},{account_hint:claims.email?String(claims.email):null,expires_at:null});
 await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.id);
 return {status:'connected',accountHint:claims.email||null};
}

export async function kleinanzeigenAccessToken(db:any,userId:string){
 const row=await getConnection(db,userId,'kleinanzeigen');
 if(!row||row.status!=='connected')throw Error('platform_not_connected');
 const credentials=await decryptCredentials(db,row);
 const expiry=Date.parse(String(credentials.access_expires_at||''));
 if(credentials.access_token&&Number.isFinite(expiry)&&expiry>Date.now()+60_000)return {token:String(credentials.access_token),credentials,row};
 if(!credentials.refresh_token)throw Error('platform_not_connected');
 try{
  const data=await tokenRequest({grant_type:'refresh_token',client_id:CLIENT_ID,refresh_token:String(credentials.refresh_token)});
  const expiresAt=new Date(Date.now()+Number(data.expires_in||600)*1000).toISOString();
  const next={...credentials,refresh_token:String(data.refresh_token||credentials.refresh_token),access_token:String(data.access_token),access_expires_at:expiresAt};
  await saveConnection(db,userId,'kleinanzeigen',next,{account_hint:row.account_hint||null,expires_at:null});
  return {token:String(data.access_token),credentials:next,row};
 }catch(error){await markConnection(db,userId,'kleinanzeigen',{status:'needs_login',last_error:'token_refresh_failed'}).catch(()=>{});throw error;}
}

export async function checkKleinanzeigenConnection(db:any,userId:string){
 try{await kleinanzeigenAccessToken(db,userId);await markConnection(db,userId,'kleinanzeigen',{status:'connected',last_verified_at:new Date().toISOString(),last_error:null});return {authenticated:true};}
 catch(error){if(error?.message==='platform_not_connected')return {authenticated:false};return {authenticated:false,error:'needs_login'};}
}

export async function sendKleinanzeigenApplication(_db:any,_input:any){
 // Auth/token refresh is implemented and verified independently. Starting the first
 // conversation for a fresh ad is deliberately not guessed: production enablement
 // requires a controlled two-account request trace for that exact operation.
 return {success:false,status:'manual_required',error:'provider_contract_unverified'};
}
