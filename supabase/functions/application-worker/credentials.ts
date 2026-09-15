const encoder=new TextEncoder();
const decoder=new TextDecoder();
const KEY_NAME='application_credential_key_v1';

function bytesToBase64(bytes:Uint8Array){let out='';for(const value of bytes)out+=String.fromCharCode(value);return btoa(out);}
function base64ToBytes(value:string){const raw=atob(value);const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}

async function cryptoKey(db:any){
 const {data,error}=await db.rpc('get_bot_secret',{secret_name:KEY_NAME});
 if(error||!data)throw Error('credential_key_unavailable');
 const raw=base64ToBytes(String(data));
 if(raw.byteLength!==32)throw Error('credential_key_invalid');
 return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
}

const aad=(userId:string,provider:string,keyVersion=1)=>encoder.encode(`${userId}:${provider}:v${keyVersion}`);

export async function encryptCredentials(db:any,userId:string,provider:string,value:Record<string,unknown>){
 const keyVersion=1,iv=crypto.getRandomValues(new Uint8Array(12)),key=await cryptoKey(db);
 const plain=encoder.encode(JSON.stringify(value));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(userId,provider,keyVersion)},key,plain);
 return {credential_ciphertext:bytesToBase64(new Uint8Array(encrypted)),credential_iv:bytesToBase64(iv),key_version:keyVersion};
}

export async function decryptCredentials(db:any,row:any){
 if(!row?.credential_ciphertext||!row?.credential_iv)throw Error('platform_not_connected');
 const key=await cryptoKey(db),iv=base64ToBytes(String(row.credential_iv)),cipher=base64ToBytes(String(row.credential_ciphertext));
 try{
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(String(row.user_id),String(row.provider),Number(row.key_version)||1)},key,cipher);
  return JSON.parse(decoder.decode(plain));
 }catch{throw Error('platform_credentials_invalid');}
}

export async function getConnection(db:any,userId:string,provider:string){
 const {data,error}=await db.from('platform_connections').select('*').eq('user_id',userId).eq('provider',provider).maybeSingle();
 if(error)throw Error('platform_connection_read_failed');
 return data;
}

export async function saveConnection(db:any,userId:string,provider:string,credentials:Record<string,unknown>,meta:Record<string,unknown>={}){
 const encrypted=await encryptCredentials(db,userId,provider,credentials);
 const row={user_id:userId,provider,status:'connected',...encrypted,last_verified_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString(),...meta};
 const {data,error}=await db.from('platform_connections').upsert(row,{onConflict:'user_id,provider'}).select('*').single();
 if(error)throw Error('platform_connection_write_failed');
 return data;
}

export async function markConnection(db:any,userId:string,provider:string,patch:Record<string,unknown>){
 const {error}=await db.from('platform_connections').upsert({user_id:userId,provider,updated_at:new Date().toISOString(),...patch},{onConflict:'user_id,provider'});
 if(error)throw Error('platform_connection_write_failed');
}

export async function deleteConnection(db:any,userId:string,provider:string){
 const {error}=await db.from('platform_connections').delete().eq('user_id',userId).eq('provider',provider);
 if(error)throw Error('platform_disconnect_failed');
}
