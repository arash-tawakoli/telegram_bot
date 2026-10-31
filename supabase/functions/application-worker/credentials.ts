const enc=new TextEncoder(),dec=new TextDecoder();
const b64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};
const unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function keyMaterial(db:any,version=1){const name=`application_credential_key_v${version}`;const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('credential_key_unavailable');const raw=unb64(String(data));if(raw.length!==32)throw Error('credential_key_invalid');return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function encryptCredentials(db:any,userId:string,provider:string,value:unknown,keyVersion=1){const key=await keyMaterial(db,keyVersion),iv=crypto.getRandomValues(new Uint8Array(12));const aad=enc.encode(`${userId}:${provider}:v${keyVersion}`);const plain=enc.encode(JSON.stringify(value));const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plain));return {credential_ciphertext:b64(cipher),credential_iv:b64(iv),key_version:keyVersion};}
export async function decryptCredentials(db:any,row:any){if(!row?.credential_ciphertext||!row?.credential_iv)return null;const version=Number(row.key_version)||1,key=await keyMaterial(db,version),aad=enc.encode(`${row.user_id}:${row.provider}:v${version}`);try{const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(row.credential_iv),additionalData:aad},key,unb64(row.credential_ciphertext));return JSON.parse(dec.decode(plain));}catch{throw Error('credential_decrypt_failed');}}
export async function saveConnection(db:any,userId:string,provider:string,credentials:unknown,patch:any={}){const encrypted=credentials==null?{credential_ciphertext:null,credential_iv:null,key_version:1}:await encryptCredentials(db,userId,provider,credentials,1);const {error}=await db.from('platform_connections').upsert({user_id:userId,provider,status:'connected',...encrypted,last_verified_at:new Date().toISOString(),last_error:null,...patch},{onConflict:'user_id,provider'});if(error)throw Error('connection_save_failed');}
export async function getConnection(db:any,userId:string,provider:string){const {data,error}=await db.from('platform_connections').select('*').eq('user_id',userId).eq('provider',provider).maybeSingle();if(error)throw Error('connection_read_failed');return data?{row:data,credentials:await decryptCredentials(db,data)}:null;}
export async function markConnection(db:any,userId:string,provider:string,status:string,lastError:string|null=null,patch:any={}){const {error}=await db.from('platform_connections').upsert({user_id:userId,provider,status,last_error:lastError,updated_at:new Date().toISOString(),...patch},{onConflict:'user_id,provider'});if(error)throw Error('connection_update_failed');}
export async function deleteConnection(db:any,userId:string,provider:string){const {error}=await db.from('platform_connections').delete().eq('user_id',userId).eq('provider',provider);if(error)throw Error('disconnect_failed');}

export async function recordRefreshResult(db:any,userId:string,provider:string,success:boolean,error:string|null=null,expiresAt:string|null=null){
 const {error:rpcError}=await db.rpc('record_platform_connection_refresh',{
  p_user:userId,
  p_provider:provider,
  p_success:success,
  p_error:error,
  p_expires_at:expiresAt
 });
 if(rpcError)console.error('connection_refresh_telemetry',provider,rpcError.message);
}


const CENTRAL_IMMOSCOUT_WORKER='https://immoscout-central-token-staging.arash-ce5.workers.dev';
async function centralImmoScoutApi(db:any,path:string,method='GET',body:any=undefined){
 const {data,error}=await db.rpc('get_bot_secret',{secret_name:'immoscout_central_cloudflare_api_secret'});
 if(error||!data)throw Error('central_credential_service_unavailable');
 let response:Response;
 try{
  response=await fetch(`${CENTRAL_IMMOSCOUT_WORKER}${path}`,{
   method,
   headers:{authorization:`Bearer ${String(data)}`,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
   signal:AbortSignal.timeout(15000)
  });
 }catch{throw Error('temporary_network_error')}
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result){
  if(response.status===404&&['needs_login','credential_not_connected'].includes(String(result?.error||'')))return null;
  throw Error(result?.error||'central_credential_service_unavailable');
 }
 return result;
}
export async function getCentralImmoScoutConnection(db:any){
 const result=await centralImmoScoutApi(db,'/internal/credentials','GET');
 if(!result)return null;
 const {account_hint,enabled,status,...credentials}=result;
 return{row:{account_hint,status,enabled:enabled===true,expires_at:credentials.expires_at},credentials};
}
export async function saveCentralImmoScoutCredentials(db:any,credentials:any){
 const result=await centralImmoScoutApi(db,'/internal/store','POST',{
  account_hint:'arash@nexalabs.de',
  access_token:credentials?.access_token,
  refresh_token:credentials?.refresh_token,
  id_token:credentials?.id_token||null,
  token_type:credentials?.token_type||'Bearer',
  scope:credentials?.scope||'openid profile offline_access',
  expires_at:credentials?.expires_at,
  preserve_enabled:true
 });
 if(!result?.stored)throw Error('central_credential_update_failed');
}
export async function markCentralImmoScoutConnection(db:any,status:string,lastError:string|null=null){
 const result=await centralImmoScoutApi(db,'/internal/mark','POST',{status,last_error:lastError});
 if(result?.status!==status)throw Error('central_credential_status_update_failed');
}
