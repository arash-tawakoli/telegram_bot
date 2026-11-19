import { getCentralProviderCredentials } from "./central-provider-credentials.js";
import { effectiveApplicationMessages } from "./application-text.js";
import { listingCategory } from "./matching.js";
import { personalizedKleinanzeigenMessage } from "./kleinanzeigen-application.js";

const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const object = value => {try {return typeof value==="string" ? JSON.parse(value) : value||{};}catch{return {};}};
function unwrapped(value) {
  if(!value||typeof value!=="object")return value;
  const wrapper=Object.keys(value).find(key=>key.startsWith("{http"));
  let current=wrapper?value[wrapper]?.value:value;
  for(let i=0;i<2&&current&&typeof current==="object"&&"value" in current&&Object.keys(current).length<=4;i++)
    current=current.value;
  return current;
}
function jwtId(token){
  try{
    const part=String(token||"").split(".")[1];
    if(!part)return null;
    const json=JSON.parse(atob(part.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(part.length/4)*4,"=")));
    const id=String(json.userId||json.user_id||json.uid||json.sub||"");
    return /^\d{3,24}$/.test(id)?id:null;
  }catch{return null;}
}
async function read(url,headers,method="GET"){
  try{
    const r=await fetch(url,{method,headers,signal:AbortSignal.timeout(13000)});
    return {ok:r.ok,status:r.status,body:await r.json().catch(()=>null)};
  }catch(error){return {ok:false,status:null,error:["AbortError","TimeoutError"].includes(String(error?.name))?"timeout":"network_error"};}
}
function rows(payload){
  const root=unwrapped(payload)||{};
  const r=root.conversations??root.data?.conversations??root.data??[];
  return Array.isArray(r)?r:Array.isArray(r?.items)?r.items:[];
}
function messages(payload){
  const root=unwrapped(payload)||{};
  const r=root.messages??root.data?.messages??[];
  return Array.isArray(r)?r:[];
}
function outboundMatch(item,text){
  const dir=String(item.direction??item.boundness??"").toUpperCase();
  return (dir==="SENT"||dir.includes("OUT"))&&clean(item.message??item.text??item.body??item.textShort??"")===clean(text);
}
async function accountUserId(credentials){
  const direct=jwtId(credentials.access_token)||jwtId(credentials.id_token);
  if(direct)return {id:direct,method:"token_claim"};
  const discovery=await read("https://login.kleinanzeigen.de/.well-known/openid-configuration",{accept:"application/json"});
  if(!discovery.ok)return {id:null,method:"oidc_discovery_error",http_status:discovery.status};
  let url;
  try{url=new URL(discovery.body?.userinfo_endpoint||"");}catch{return {id:null,method:"oidc_userinfo_missing"};}
  if(url.protocol!=="https:"||url.hostname!=="login.kleinanzeigen.de")return {id:null,method:"oidc_userinfo_unsupported"};
  const r=await read(url.href,{authorization:"Bearer "+credentials.access_token,accept:"application/json"});
  if(!r.ok)return {id:null,method:"oidc_userinfo_error",http_status:r.status};
  const id=String(r.body?.userId||r.body?.user_id||r.body?.uid||r.body?.sub||"");
  return /^\d{3,24}$/.test(id)?{id,method:"oidc_userinfo"}:{id:null,method:"oidc_non_numeric"};
}
export async function reconcileKleinanzeigenReadbackOnce(sql,env){
  const id=String(env.KLEINANZEIGEN_READBACK_APPLICATION_ID||"");
  if(env.PREVIEW_MODE==="1"||!/^[0-9a-f-]{36}$/i.test(id))return {status:"disabled"};
  const result=await sql.unsafe("SELECT a.id,a.submission_started_at,oi.external_id,oi.facts,ap.profile FROM applications a JOIN offer_identities oi ON oi.id=a.offer_identity_id JOIN applicant_profiles ap ON ap.participant_id=a.participant_id JOIN participants p ON p.id=a.participant_id WHERE a.id=$1 AND a.provider='kleinanzeigen' AND a.test_mode=1 AND a.status='manual_required' AND a.last_error='submission_unconfirmed' AND a.sent_at IS NULL AND a.submission_started_at IS NOT NULL AND p.telegram_user_id=8538226539 LIMIT 1",[id]);
  if(!result.length)return {status:"not_eligible"};
  const eventId=crypto.randomUUID();
  const claimed=await sql.unsafe("INSERT INTO application_events(id,application_id,provider,event_type,status,reason,metadata) SELECT $1,$2,'kleinanzeigen','inbox_readback','processing','started','{}' WHERE NOT EXISTS(SELECT 1 FROM application_events WHERE application_id=$2 AND event_type='inbox_readback') RETURNING id",[eventId,id]);
  if(!claimed.length)return {status:"already_checked"};
  const finish=async(reason,meta={})=>{
    await sql.unsafe("UPDATE application_events SET status='manual_required',reason=$1,metadata=$2 WHERE id=$3",[reason,JSON.stringify(meta),eventId]);
    return {status:reason,...meta};
  };
  let central;
  try{central=await getCentralProviderCredentials(sql,env,"kleinanzeigen",{testMode:true});}
  catch(e){const code=String(e?.message||"");return finish(["needs_login","central_provider_unavailable","temporary_network_error","credential_decrypt_failed"].includes(code)?code:"credential_unverified");}
  const token=central.credentials?.access_token;
  const expiry=Date.parse(String(central.credentials?.expires_at||""));
  if(!token||!Number.isFinite(expiry)||expiry<=Date.now())return finish("token_expired_after_refresh");
  const profile=effectiveApplicationMessages(object(result[0].profile));
  const facts=object(result[0].facts);
  const text=personalizedKleinanzeigenMessage(profile,listingCategory(facts)==="Haus"?profile.message_house:profile.message_apartment);
  if(!text)return finish("original_message_unavailable");
  const user=await accountUserId(central.credentials);
  const owner=user.id||central.accountHint;
  if(!owner)return finish("inbox_user_id_unavailable",{identity_source:user.method,identity_http_status:user.http_status||null});
  const headers={authorization:"Bearer "+token,accept:"application/json","accept-language":"de-DE",
    ...(central.credentials.x_ebayk_app?{"x-ebayk-app":central.credentials.x_ebayk_app,
      "x-ecg-user-agent":"ebayk-android-app-2026.37.1","x-ecg-user-version":"2026.37.1"}:{})};
  const base="https://gateway.kleinanzeigen.de/messagebox/api/users/"+encodeURIComponent(owner);
  const inbox=await read(base+"/conversations?page=0&size=100",headers);
  if(!inbox.ok)return finish("inbox_read_failed",{inbox_http_status:inbox.status,transport_error:inbox.error||null,identity_source:user.method});
  const matching=rows(inbox.body).filter(item=>String(item.adId??item.ad?.id??item.advertisementId??"")===String(result[0].external_id));
  if(!matching.length)return finish("conversation_not_visible",{inbox_http_status:inbox.status,identity_source:user.method});
  let confirmed=false,conversationHttp=null;
  for(const item of matching.slice(0,3)){
    if(messages(item).some(message=>outboundMatch(message,text))){confirmed=true;break;}
    const conversation=String(item.id??item.conversationId??"");
    if(!conversation||conversation.length>160)continue;
    // The legacy provider reads conversation contents via PUT (may mark read).
    // This does not submit a new application or send any message.
    const opened=await read(base+"/conversations/"+encodeURIComponent(conversation)+"?contentWarnings=true",headers,"PUT");
    conversationHttp=opened.status;
    if(opened.ok&&messages(opened.body).some(message=>outboundMatch(message,text))){confirmed=true;break;}
  }
  if(!confirmed)return finish("outbound_not_verified",{inbox_http_status:inbox.status,conversation_http_status:conversationHttp,identity_source:user.method});
  const updated=await sql.unsafe("UPDATE applications SET status='sent',last_error=NULL,sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='manual_required' AND last_error='submission_unconfirmed' AND submission_started_at IS NOT NULL AND sent_at IS NULL RETURNING id",[id]);
  if(!updated.length)return finish("reconciliation_conflict");
  await sql.unsafe("UPDATE application_events SET status='sent',reason='verified_exact_outbound',metadata=$1 WHERE id=$2",[JSON.stringify({exact_outbound:true,confirmation:"kleinanzeigen_messagebox_readback"}),eventId]);
  return {status:"verified_exact_outbound"};
}
