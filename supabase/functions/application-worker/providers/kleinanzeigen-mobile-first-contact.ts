import {getConnection,markConnection} from '../credentials.ts';
import {inspectKleinanzeigenInquiry,kleinanzeigenAccessToken} from './kleinanzeigen.ts';

const API_HOST='https://api.kleinanzeigen.de';
const GATEWAY_HOST='https://gateway.kleinanzeigen.de';
const APP_VERSION='2026.37.1';
const APP_BASIC='Basic '+btoa('android:TaR60pEttY');
const AD_FIELDS='id,user-id,category,contact-name,phone,displayoptions,attributes,status,title,description,link';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const norm=(v:any)=>String(v??'').replace(/\s+/g,' ').trim();

function installId(){return `${crypto.randomUUID()}${Date.now()}`}
function wenkseSessionId(){return crypto.randomUUID().replace(/-/g,'')}
function appHeaders(xapp:string){return{'X-EBAYK-APP':xapp,'X-ECG-USER-AGENT':`ebayk-android-app-${APP_VERSION}`,'X-ECG-USER-VERSION':APP_VERSION,'User-Agent':`Kleinanzeigen/${APP_VERSION} (Android 13; Pixel 7)`,'Accept':'application/json','Accept-Language':'de-DE'}}
function mainHeaders(token:string,email:string,xapp:string,withBody=false){const h:any={...appHeaders(xapp),Authorization:APP_BASIC,'X-EBAYK-USERID-TOKEN':token,'X-ECG-Authorization-User':`email=${email},access=${token}`};if(withBody)h['Content-Type']='application/json';return h}
function gatewayHeaders(token:string,xapp:string,withBody=false){const h:any={...appHeaders(xapp),Authorization:`Bearer ${token}`};if(withBody)h['Content-Type']='application/json';return h}
function publicHeaders(xapp:string){return{...appHeaders(xapp),Authorization:APP_BASIC,'X-ECG-IN':AD_FIELDS}}

function scalar(v:any):any{while(v&&typeof v==='object'&&'value'in v)v=v.value;return v}
function unwrap(body:any){if(!body||typeof body!=='object')return body;const k=Object.keys(body).find(x=>x.startsWith('{http'));let v=k?body?.[k]?.value:body;while(v&&typeof v==='object'&&Object.keys(v).length<=4&&'value'in v)v=v.value;return v}
async function request(url:string,init:RequestInit={}){try{const response=await fetch(url,{...init,signal:AbortSignal.timeout(30000)}),text=await response.text();let json:any=null;try{json=JSON.parse(text)}catch{}return{response,text,json}}catch(error:any){if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('temporary_network_error');throw Error('temporary_network_error')}}

async function account(db:any,userId:string,xapp:string){
 const token=String(await kleinanzeigenAccessToken(db,userId));
 const connection=await getConnection(db,userId,'kleinanzeigen');
 const email=String(connection?.row?.account_hint||'').trim();
 if(!email)throw Error('needs_login');
 const r=await request(`${API_HOST}/api/users/${encodeURIComponent(email)}/profile.json`,{headers:mainHeaders(token,email,xapp)});
 if(r.response.status===401||r.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login','profile_auth_failed').catch(()=>{});throw Error('needs_login')}
 if(!r.response.ok){if(r.response.status===429||r.response.status>=500)throw Error('temporary_network_error');throw Error('provider_contract_unverified')}
 const p=unwrap(r.json)||r.json,id=scalar(p?.data?.id??p?.id??r.json?.data?.id??r.json?.id??r.json?.value?.id);
 if(!id)throw Error('provider_contract_unverified');
 return{token,email,uid:String(id)};
}

function rows(body:any){const b=unwrap(body)||body;let r=b?.conversations??b?.data?.conversations??b?.data??[];if(r&&typeof r==='object'&&!Array.isArray(r))r=r.conversations??r.items??[];return Array.isArray(r)?r:[]}
function forAd(list:any[],adId:string){return list.find((x:any)=>String(x?.adId??x?.ad?.id??x?.advertisementId??'')===adId)||null}
function messages(body:any){const b=unwrap(body)||body,r=b?.messages??b?.data?.messages??[];return Array.isArray(r)?r:[]}
function exactOutbound(body:any,message:string){const wanted=norm(message);return messages(body).some((m:any)=>{const dir=String(m?.boundness??m?.direction??'').toUpperCase(),text=norm(m?.text??m?.textShort??m?.title??'');return(dir.includes('OUT')||dir==='SENT')&&text===wanted})}
function hasOutbound(body:any){return messages(body).some((m:any)=>{const dir=String(m?.boundness??m?.direction??'').toUpperCase();return dir.includes('OUT')||dir==='SENT'})}
function createdId(body:any){const b=unwrap(body)||body;for(const v of[b?.conversationId,b?.id,b?.conversation?.id,b?.data?.conversationId,b?.data?.id,b?.data?.conversation?.id]){const x=scalar(v);if(x)return String(x)}return null}

async function listMain(acct:any,xapp:string){const r=await request(`${API_HOST}/api/users/${encodeURIComponent(acct.uid)}/conversations?page=0&size=100`,{headers:mainHeaders(acct.token,acct.email,xapp)});return r.response.ok?rows(r.json):[]}
async function listGateway(acct:any,xapp:string){const r=await request(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(acct.uid)}/conversations?page=0&size=100`,{headers:gatewayHeaders(acct.token,xapp)});return r.response.ok?rows(r.json):[]}
async function openMain(acct:any,cid:string,xapp:string){const r=await request(`${API_HOST}/api/users/${encodeURIComponent(acct.uid)}/conversations/${encodeURIComponent(cid)}?contentWarnings=true`,{method:'PUT',headers:mainHeaders(acct.token,acct.email,xapp)});return r.response.ok?r.json:null}
async function openGateway(acct:any,cid:string,xapp:string){const r=await request(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(acct.uid)}/conversations/${encodeURIComponent(cid)}?contentWarnings=true`,{method:'PUT',headers:gatewayHeaders(acct.token,xapp)});return r.response.ok?r.json:null}

async function currentConversation(acct:any,adId:string,xapp:string){const a=forAd(await listMain(acct,xapp),adId);if(a)return a;return forAd(await listGateway(acct,xapp),adId)}
async function verify(acct:any,adId:string,cid:string|null,message:string,xapp:string){for(const d of[700,1400,2600,4200]){await wait(d);let id=cid;const c=await currentConversation(acct,adId,xapp);if(c?.id)id=String(c.id);if(id){const a=await openMain(acct,id,xapp);if(a&&exactOutbound(a,message))return{id,via:'capi'};const g=await openGateway(acct,id,xapp);if(g&&exactOutbound(g,message))return{id,via:'gateway'}}if(c&&norm(c?.textShortTrimmed??c?.textShort??c?.preview)===norm(message)&&String(c?.boundness??'').toUpperCase().includes('OUT'))return{id:id||String(c.id||''),via:'list'}}return null}

function findNumber(root:any,names:Set<string>){const seen=new Set<any>();function walk(v:any,depth=0):number|null{if(!v||typeof v!=='object'||depth>8||seen.has(v))return null;seen.add(v);for(const[k,x]of Object.entries(v)){if(names.has(k)&&Number.isFinite(Number(scalar(x))))return Number(scalar(x));const y=walk(x,depth+1);if(y!==null)return y}return null}return walk(root)}
function fieldDescriptor(v:any,path:string[]){return norm([v?.name,v?.id,v?.key,v?.field,v?.label,v?.title,path.join('.')].map(scalar).join(' ')).toLowerCase()}
function requiredFields(root:any){const out:any[]=[];const seen=new Set<any>();function walk(v:any,path:string[],depth=0){if(!v||typeof v!=='object'||depth>10||seen.has(v))return;seen.add(v);if(Array.isArray(v)){for(let i=0;i<Math.min(v.length,100);i++)walk(v[i],[...path,String(i)],depth+1);return}const required=v?.required===true||v?.mandatory===true||v?.isRequired===true||String(scalar(v?.requirement)||'').toLowerCase()==='required';if(required){const key=String(scalar(v?.name??v?.id??v?.key??v?.field)||'').trim();if(key)out.push({key,descriptor:fieldDescriptor(v,path)})}for(const[k,x]of Object.entries(v))walk(x,[...path,k],depth+1)}walk(root,[]);return out}
function profileValue(field:any,profile:any){const k=field.descriptor;if(/income|einkommen/.test(k))return profile?.monthly_net_income;if(/employment|beruf|job/.test(k))return profile?.employment_status;if(/household|numberofpeople|haushalt|personen/.test(k))return profile?.household_size;if(/pet|haustier/.test(k))return profile?.pets;if(/moveindate|move.?in|einzug/.test(k))return profile?.move_in_date;if(/wbs|wohnungsberechtigung/.test(k))return profile?.wbs_status;if(/phone|telefon/.test(k))return profile?.phone;if(/firstname|first.?name|vorname/.test(k))return profile?.first_name;if(/lastname|last.?name|nachname/.test(k))return profile?.last_name;if(/jobtitle/.test(k))return profile?.employment_status;return undefined}
async function seekerPreflight(acct:any,profile:any,xapp:string){const url=`${GATEWAY_HOST}/real-estate-seeker-profile/api/v1/seeker-profile/${encodeURIComponent(acct.uid)}/form`,r=await request(url,{headers:gatewayHeaders(acct.token,xapp)});if(r.response.status===404)return{ok:true,missing:0};if(!r.response.ok){if(r.response.status===401||r.response.status===403)throw Error('needs_login');if(r.response.status===429||r.response.status>=500)throw Error('temporary_network_error');return{ok:false,error:`seeker_form_${r.response.status}`}}const root=unwrap(r.json)||r.json,missing=findNumber(root,new Set(['missingMandatoryFieldsCount','missing_mandatory_fields_count']))??0;if(missing<=0)return{ok:true,missing:0};const req=requiredFields(root),payload:any={},unsupported:any[]=[];for(const f of req){const value=profileValue(f,profile);if(value===undefined||value===null||norm(value)==='')unsupported.push(f.key);else payload[f.key]=value}if(unsupported.length||!Object.keys(payload).length)return{ok:false,error:'required_profile_data_missing',unsupported};const post=await request(url,{method:'POST',headers:gatewayHeaders(acct.token,xapp,true),body:JSON.stringify(payload)});if(!post.response.ok)return{ok:false,error:post.response.status===400||post.response.status===422?'required_profile_data_rejected':`seeker_form_update_${post.response.status}`};const check=await request(url,{headers:gatewayHeaders(acct.token,xapp)}),remaining=check.response.ok?(findNumber(unwrap(check.json)||check.json,new Set(['missingMandatoryFieldsCount','missing_mandatory_fields_count']))??missing):missing;return remaining===0?{ok:true,missing:0,updated:Object.keys(payload)}:{ok:false,error:'required_profile_data_missing'} }

export async function sendKleinanzeigenMobileFirstContact(input:any){
 const{db,user,profile,listing,message,authorize}=input||{},userId=String(user?.id||''),adId=String(listing?.external_id||listing?.source_listing_key||'').match(/\d{6,20}/)?.[0]||'';
 if(!userId||!adId||!message)return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 const xapp=installId();
 const inspection=await inspectKleinanzeigenInquiry(input);
 if(!inspection?.ok)return{success:false,status:'manual_required',error:inspection?.missing?.length?'required_profile_data_missing':inspection?.unsupported?.length?'required_field_contract_unverified':inspection?.error||'provider_contract_unverified'};
 if(inspection?.action&&String(inspection.action).toLowerCase()!=='conversation')return{success:false,status:'manual_required',error:'contact_action_unsupported'};
 const acct=await account(db,userId,xapp);
 const seeker=await seekerPreflight(acct,profile,xapp);if(!seeker.ok)return{success:false,status:'manual_required',error:seeker.error||'required_profile_data_missing'};
 const ad=await request(`${API_HOST}/api/ads/${encodeURIComponent(adId)}.json`,{headers:publicHeaders(xapp)});if(ad.response.status===404||ad.response.status===410)return{success:false,status:'failed',error:'listing_unavailable'};if(!ad.response.ok){if(ad.response.status===429||ad.response.status>=500)throw Error('temporary_network_error');return{success:false,status:'manual_required',error:`ad_lookup_${ad.response.status}`}}
 const owner=String(scalar((unwrap(ad.json)||ad.json)?.['user-id']??(unwrap(ad.json)||ad.json)?.userId)||'');if(owner&&owner===acct.uid)return{success:false,status:'manual_required',error:'self_listing'};
 const existing=await currentConversation(acct,adId,xapp);if(existing?.id){const a=await openMain(acct,String(existing.id),xapp),g=a?null:await openGateway(acct,String(existing.id),xapp);const opened=a||g;if(opened&&exactOutbound(opened,message))return{success:true,status:'sent'};if(opened&&hasOutbound(opened))return{success:false,status:'manual_required',error:'conversation_exists'}}
 if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'failed',error:'send_not_authorized'};
 const sid=wenkseSessionId();
 const endpoint=`${API_HOST}/api/users/${encodeURIComponent(acct.uid)}/conversations`;
 const headers:any={...mainHeaders(acct.token,acct.email,xapp,true),'X-EBAYK-WENKSE-SESSION-ID':sid};
 const sent=await request(endpoint,{method:'POST',headers,body:JSON.stringify({message,adId})});
 if(sent.response.status===401||sent.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login',`first_contact_${sent.response.status}`).catch(()=>{});return{success:false,status:'manual_required',error:'needs_login'}}
 if(sent.response.status===429||sent.response.status>=500)throw Error('temporary_network_error');
 if(!sent.response.ok)return{success:false,status:'manual_required',error:`first_contact_${sent.response.status}`};
 if(exactOutbound(sent.json,message))return{success:true,status:'sent'};
 const cid=createdId(sent.json)||String(existing?.id||'')||null,verified=await verify(acct,adId,cid,message,xapp);
 if(!verified)return{success:false,status:'manual_required',error:'message_accepted_unconfirmed'};
 return{success:true,status:'sent'};
}
