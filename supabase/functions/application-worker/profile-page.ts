const enc=new TextEncoder();
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const unb64url=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(v.length/4)*4,'=')),c=>c.charCodeAt(0));
async function secret(db:any){const {data,error}=await db.rpc('get_bot_secret',{secret_name:'application_credential_key_v1'});if(error||!data)throw Error('profile_key_unavailable');return unb64url(String(data).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));}
async function mac(db:any,payload:string){const key=await crypto.subtle.importKey('raw',await secret(db),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);return b64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(payload))));}
export async function createProfileToken(db:any,userId:string){const payload=b64url(enc.encode(JSON.stringify({u:userId,e:Date.now()+20*60_000,n:crypto.randomUUID()})));return `${payload}.${await mac(db,payload)}`;}

// Hosted Supabase Edge Function domains intentionally serve HTML as text/plain.
// Applicant profile editing therefore lives natively in Telegram. Legacy profile
// links simply return the user to the bot instead of exposing raw HTML source.
export async function handleProfilePage(_db:any,_request:Request){
 return Response.redirect('https://t.me/traumwohnunghamburgbot',303);
}
