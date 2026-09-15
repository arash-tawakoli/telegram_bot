import {getConnection} from '../credentials.ts';
import {kleinanzeigenAccessToken} from './kleinanzeigen.ts';

const API_HOST='https://api.kleinanzeigen.de';
const GATEWAY_HOST='https://gateway.kleinanzeigen.de';
const APP_VERSION='2026.25.0';
const AD_NS='{http://www.ebayclassifiedsgroup.com/schema/ad/v1}ad';

async function optionalSecret(db:any,name:string){
 try{const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)return null;return String(data);}catch{return null;}
}

function installId(){return `${crypto.randomUUID()}${Date.now()}`;}
function scalar(value:any):any{
 let current=value;
 for(let i=0;i<5&&current&&typeof current==='object'&&'value' in current;i++)current=current.value;
 return current;
}
function conversationItems(body:any){
 let items=body?.conversations??body?.data??[];
 if(items&&typeof items==='object'&&!Array.isArray(items))items=items.conversations??items.items??[];
 return Array.isArray(items)?items:[];
}
function conversationId(body:any){
 return String(body?.id??body?.conversation?.id??body?.data?.id??body?.data?.conversation?.id??'').trim()||null;
}
function conversationAdId(row:any){
 return String(row?.adId??row?.ad_id??row?.ad?.id??'').trim();
}

async function context(db:any,userId:string){
 const [token,connection,basicUser,basicPassword]=await Promise.all([
  kleinanzeigenAccessToken(db,userId),
  getConnection(db,userId,'kleinanzeigen'),
  optionalSecret(db,'kleinanzeigen_mobile_basic_user'),
  optionalSecret(db,'kleinanzeigen_mobile_basic_password')
 ]);
 const email=String(connection?.row?.account_hint||'').trim();
 if(!email||!email.includes('@'))throw Error('needs_login');
 if(!basicUser||!basicPassword)throw Error('mobile_api_credentials_unavailable');
 const common={
  'X-EBAYK-APP':installId(),
  'X-ECG-USER-AGENT':`ebayk-android-app-${APP_VERSION}`,
  'X-ECG-USER-VERSION':APP_VERSION,
  'User-Agent':`Kleinanzeigen/${APP_VERSION} (Android 13; Pixel 7)`,
  'Accept':'application/json',
  'Accept-Language':'de-DE'
 };
 const basic=`Basic ${btoa(`${basicUser}:${basicPassword}`)}`;
 const mainHeaders={
  ...common,
  'Authorization':basic,
  'X-EBAYK-USERID-TOKEN':token,
  'X-ECG-Authorization-User':`email=${email},access=${token}`
 };
 const profileResponse=await fetch(`${API_HOST}/api/users/${encodeURIComponent(email)}/profile.json`,{headers:mainHeaders,signal:AbortSignal.timeout(20000)});
 if(!profileResponse.ok)throw Error(`account_probe_${profileResponse.status}`);
 const profile=await profileResponse.json().catch(()=>null);
 const uid=String(profile?.data?.id??profile?.id??'').trim();
 if(!uid)throw Error('account_id_unavailable');
 return {token,email,uid,common,mainHeaders};
}

async function listConversations(ctx:any){
 const response=await fetch(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(ctx.uid)}/conversations?page=0&size=100`,{
  headers:{...ctx.common,'Authorization':`Bearer ${ctx.token}`},
  signal:AbortSignal.timeout(20000)
 });
 if(!response.ok)throw Error(`conversation_probe_${response.status}`);
 return conversationItems(await response.json().catch(()=>null));
}

async function adOwner(ctx:any,adId:string){
 const response=await fetch(`${API_HOST}/api/ads/${encodeURIComponent(adId)}.json`,{headers:ctx.mainHeaders,signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`ad_probe_${response.status}`);
 const body=await response.json().catch(()=>null);
 let ad=body?.[AD_NS]??body;
 if(ad&&typeof ad==='object'&&'value' in ad)ad=ad.value;
 const owner=scalar(ad?.['user-id']??ad?.userId??ad?.user_id);
 return owner==null?null:String(owner);
}

export async function sendKleinanzeigenApplication(input:any){
 const {db,user,profile,listing,message,authorize}=input||{};
 const userId=String(user?.id||''),adId=String(listing?.external_id||listing?.source_listing_key||'').trim();
 if(!userId||!/^\d+$/.test(adId))return {success:false,status:'failed',error:'listing_external_id_missing'};

 const ctx=await context(db,userId);
 const owner=await adOwner(ctx,adId);
 if(owner&&owner===String(ctx.uid))return {success:false,status:'manual_required',error:'same_account_listing'};

 let conversations=await listConversations(ctx);
 const existing=conversations.find((row:any)=>conversationAdId(row)===adId);
 if(existing)return {success:false,status:'manual_required',error:'existing_conversation'};

 const allowed=await authorize();
 if(!allowed)return {success:false,status:'failed',error:'authorization_denied'};

 const contactName=String([profile?.first_name,profile?.last_name].filter(Boolean).join(' ')||profile?.first_name||'Interessent').trim().slice(0,120);
 let createResponse:Response;
 try{
  const url=new URL(`${API_HOST}/api/users/${encodeURIComponent(ctx.uid)}/create-conversation/${encodeURIComponent(adId)}`);
  url.searchParams.set('contactName',contactName);
  createResponse=await fetch(url,{method:'POST',headers:ctx.mainHeaders,signal:AbortSignal.timeout(20000)});
 }catch{throw Error('submission_unconfirmed');}
 if(!createResponse.ok)return {success:false,status:'manual_required',error:`create_conversation_${createResponse.status}`};
 const created=await createResponse.json().catch(()=>null);
 let convId=conversationId(created);
 if(!convId){
  try{conversations=await listConversations(ctx);}catch{return {success:false,status:'manual_required',error:'conversation_id_unconfirmed'};}
  const found=conversations.find((row:any)=>conversationAdId(row)===adId);
  convId=found?String(found.id||found.conversationId||'').trim()||null:null;
 }
 if(!convId)return {success:false,status:'manual_required',error:'conversation_id_unconfirmed'};

 let sendResponse:Response;
 try{
  const url=new URL(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(ctx.uid)}/conversations/${encodeURIComponent(convId)}`);
  url.searchParams.set('warnPhoneNumber','false');
  url.searchParams.set('warnEmail','false');
  url.searchParams.set('warnBankDetails','false');
  sendResponse=await fetch(url,{
   method:'POST',
   headers:{...ctx.common,'Authorization':`Bearer ${ctx.token}`,'Content-Type':'application/json'},
   body:JSON.stringify({message:String(message||'').slice(0,4000)}),
   signal:AbortSignal.timeout(20000)
  });
 }catch{throw Error('submission_unconfirmed');}
 if(!sendResponse.ok)return {success:false,status:'manual_required',error:`message_send_${sendResponse.status}`};
 return {success:true,status:'sent'};
}
