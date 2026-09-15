import {saveConnection,getConnection,markConnection,deleteConnection} from '../credentials.ts';
const DOMAIN='login.kleinanzeigen.de';
const CLIENT_ID='uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const REDIRECT_URI='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const SCOPE='openid email profile offline_access';
const enc=new TextEncoder();
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
async function challenge(verifier:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))}
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));

export async function beginKleinanzeigenLogin(db:any,userId:string){
 const verifier=random(),state=random().slice(0,32),codeChallenge=await challenge(verifier);
 const {error}=await db.from('platform_auth_flows').insert({user_id:userId,provider:'kleinanzeigen',state,code_verifier:verifier});
 if(error)throw Error('auth_flow_create_failed');
 const url=new URL(`https://${DOMAIN}/authorize`);
 for(const [k,v] of Object.entries({client_id:CLIENT_ID,response_type:'code',redirect_uri:REDIRECT_URI,scope:SCOPE,code_challenge:codeChallenge,code_challenge_method:'S256',state,prompt:'login'}))url.searchParams.set(k,String(v));
 await markConnection(db,userId,'kleinanzeigen','pending');
 return {status:'login',url:url.href,requiresCallback:true};
}

export async function completeKleinanzeigenLogin(db:any,userId:string,redirectUrl:string){
 let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}
 const code=url.searchParams.get('code'),state=url.searchParams.get('state');
 if(!code||!state)throw Error('invalid_callback_url');
 const {data:flow,error}=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider','kleinanzeigen').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
 if(error||!flow)throw Error('auth_flow_expired');
 const response=await fetch(`https://${DOMAIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','user-agent':'Kleinanzeigen Android'},body:JSON.stringify({grant_type:'authorization_code',client_id:CLIENT_ID,code,code_verifier:flow.code_verifier,redirect_uri:REDIRECT_URI}),signal:AbortSignal.timeout(30000)});
 const token=await response.json().catch(()=>null);
 if(!response.ok||!token?.access_token||!token?.refresh_token)throw Error('token_exchange_failed');
 const expiresAt=new Date(Date.now()+Number(token.expires_in||600)*1000).toISOString();
 let accountHint:string|null=null;
 if(token.id_token){try{const p=token.id_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');accountHint=JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,'='))).email||null}catch{}}
 await saveConnection(db,userId,'kleinanzeigen',{access_token:token.access_token,refresh_token:token.refresh_token,expires_at:expiresAt},{account_hint:accountHint,expires_at:expiresAt});
 await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.id);
 return {status:'connected',authenticated:true,accountHint};
}

async function refresh(db:any,userId:string,connection:any){
 const credentials=connection.credentials||{};
 if(credentials.access_token&&Date.parse(credentials.expires_at||'')>Date.now()+60000)return credentials;
 if(!credentials.refresh_token)throw Error('needs_login');
 const response=await fetch(`https://${DOMAIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({grant_type:'refresh_token',client_id:CLIENT_ID,refresh_token:credentials.refresh_token}),signal:AbortSignal.timeout(30000)});
 const token=await response.json().catch(()=>null);
 if(!response.ok||!token?.access_token){await markConnection(db,userId,'kleinanzeigen','needs_login','refresh_failed');throw Error('needs_login');}
 const updated={access_token:token.access_token,refresh_token:token.refresh_token||credentials.refresh_token,expires_at:new Date(Date.now()+Number(token.expires_in||600)*1000).toISOString()};
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
