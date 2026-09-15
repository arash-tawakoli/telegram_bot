import {getConnection,markConnection} from '../credentials.ts';
import {kleinanzeigenAccessToken} from './kleinanzeigen.ts';

const API_HOST='https://api.kleinanzeigen.de';
const GATEWAY_HOST='https://gateway.kleinanzeigen.de';
const APP_VERSION='2026.37.1';
const APP_BASIC='Basic '+btoa('android:TaR60pEttY');
const AD_FIELDS='id,user-id,category,contact-name,phone,displayoptions,attributes,status,title,description,link';
const XCF_PATH=(adId:string)=>`/user-contactdetails/api/v1/ad/${encodeURIComponent(adId)}/contact-form`;
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const norm=(v:any)=>String(v??'').replace(/\s+/g,' ').trim();

function installId(){return `${crypto.randomUUID()}${Date.now()}`}
function wenkseSessionId(){return crypto.randomUUID().replace(/-/g,'')}
function appHeaders(xapp:string){return{'X-EBAYK-APP':xapp,'X-ECG-USER-AGENT':`ebayk-android-app-${APP_VERSION}`,'X-ECG-USER-VERSION':APP_VERSION,'User-Agent':`Kleinanzeigen/${APP_VERSION} (Android 13; Pixel 7)`,'Accept':'application/json','Accept-Language':'de-DE'}}
function mainHeaders(token:string,email:string,xapp:string){return{...appHeaders(xapp),Authorization:APP_BASIC,'X-EBAYK-USERID-TOKEN':token,'X-ECG-Authorization-User':`email=${email},access=${token}`}}
function gatewayHeaders(token:string,xapp:string,withBody=false){const h:any={...appHeaders(xapp),Authorization:`Bearer ${token}`};if(withBody)h['Content-Type']='application/json';return h}
function publicHeaders(xapp:string){return{...appHeaders(xapp),Authorization:APP_BASIC,'X-ECG-IN':AD_FIELDS}}
function scalar(v:any):any{while(v&&typeof v==='object'&&'value'in v)v=v.value;return v}
function unwrap(body:any){if(!body||typeof body!=='object')return body;const k=Object.keys(body).find(x=>x.startsWith('{http'));let v=k?body?.[k]?.value:body;while(v&&typeof v==='object'&&Object.keys(v).length<=4&&'value'in v)v=v.value;return v}
async function request(url:string,init:RequestInit={}){try{const response=await fetch(url,{...init,signal:AbortSignal.timeout(30000)}),text=await response.text();let json:any=null;try{json=JSON.parse(text)}catch{}return{response,text,json}}catch(error:any){if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('temporary_network_error');throw Error('temporary_network_error')}}

async function account(db:any,userId:string){
 const token=String(await kleinanzeigenAccessToken(db,userId));
 const connection=await getConnection(db,userId,'kleinanzeigen');
 const email=String(connection?.row?.account_hint||'').trim();
 if(!email)throw Error('needs_login');
 const xapp=String(connection?.credentials?.x_ebayk_app||installId());
 const r=await request(`${API_HOST}/api/users/${encodeURIComponent(email)}/profile.json`,{headers:mainHeaders(token,email,xapp)});
 if(r.response.status===401||r.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login','profile_auth_failed').catch(()=>{});throw Error('needs_login')}
 if(!r.response.ok){if(r.response.status===429||r.response.status>=500)throw Error('temporary_network_error');throw Error('provider_contract_unverified')}
 const p=unwrap(r.json)||r.json,id=scalar(p?.data?.id??p?.id??r.json?.data?.id??r.json?.id??r.json?.value?.id);
 if(!id)throw Error('provider_contract_unverified');
 return{token,email,uid:String(id),xapp};
}

function adOwner(body:any){const b=unwrap(body)||body;return String(scalar(b?.['user-id']??b?.userId??b?.user?.id)||'')}
function contactAction(body:any){const b=unwrap(body)||body;return norm(scalar(b?.displayoptions?.['contact-button-on-vip']?.action?.type??b?.displayoptions?.contactButtonOnVip?.action?.type))}
function rows(body:any){const b=unwrap(body)||body;let r=b?.conversations??b?.data?.conversations??b?.data??[];if(r&&typeof r==='object'&&!Array.isArray(r))r=r.conversations??r.items??[];return Array.isArray(r)?r:[]}
function forAd(list:any[],adId:string){return list.find((x:any)=>String(x?.adId??x?.ad?.id??x?.advertisementId??'')===adId)||null}
function messages(body:any){const b=unwrap(body)||body,r=b?.messages??b?.data?.messages??[];return Array.isArray(r)?r:[]}
function messageText(m:any){return norm(m?.message??m?.text??m?.textShort??m?.textShortTrimmed??m?.body??m?.title??'')}
function outbound(m:any){const d=String(m?.boundness??m?.direction??'').toUpperCase();return d.includes('OUT')||d==='SENT'}
function exactOutbound(body:any,message:string){const wanted=norm(message);return messages(body).some((m:any)=>outbound(m)&&messageText(m)===wanted)}
function hasOutbound(body:any){return messages(body).some(outbound)}
function createdId(body:any){for(const v of[body?.conversationId,body?.data?.conversationId,body?.id,body?.data?.id,body?.conversation?.id,body?.data?.conversation?.id]){const id=scalar(v);if(id)return String(id)}return null}

async function listMain(acct:any){const r=await request(`${API_HOST}/api/users/${encodeURIComponent(acct.uid)}/conversations?page=0&size=100`,{headers:mainHeaders(acct.token,acct.email,acct.xapp)});return r.response.ok?rows(r.json):[]}
async function listGateway(acct:any){const r=await request(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(acct.uid)}/conversations?page=0&size=100`,{headers:gatewayHeaders(acct.token,acct.xapp)});return r.response.ok?rows(r.json):[]}
async function openMain(acct:any,cid:string){const r=await request(`${API_HOST}/api/users/${encodeURIComponent(acct.uid)}/conversations/${encodeURIComponent(cid)}?contentWarnings=true`,{method:'PUT',headers:mainHeaders(acct.token,acct.email,acct.xapp)});return r.response.ok?r.json:null}
async function openGateway(acct:any,cid:string){const r=await request(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(acct.uid)}/conversations/${encodeURIComponent(cid)}?contentWarnings=true`,{method:'PUT',headers:gatewayHeaders(acct.token,acct.xapp)});return r.response.ok?r.json:null}
async function currentConversation(acct:any,adId:string){const a=forAd(await listMain(acct),adId);if(a)return a;return forAd(await listGateway(acct),adId)}
async function verify(acct:any,adId:string,cid:string|null,message:string){for(const delay of[500,900,1600,2600,4200]){await wait(delay);let id=cid;const c=await currentConversation(acct,adId);if(c?.id)id=String(c.id);if(id){const g=await openGateway(acct,id);if(g&&exactOutbound(g,message))return{id,via:'gateway'};const a=await openMain(acct,id);if(a&&exactOutbound(a,message))return{id,via:'capi'}}if(c&&outbound(c)&&messageText(c)===norm(message))return{id:id||String(c.id||''),via:'list'}}return null}

function formControls(ui:any){const out:any[]=[];const walk=(v:any)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v)walk(x);return}if(v.type==='Control'&&typeof v.scope==='string')out.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')walk(x)};walk(ui);return out}
function formLabel(ui:any,key:string){const suffix=`/properties/${key}`;return norm(formControls(ui).find((c:any)=>String(c.scope).endsWith(suffix))?.label||key)}
function profileValue(key:string,profile:any,acct:any){const k=key.toLowerCase();if(/phone|telefon/.test(k))return profile?.phone??null;if(/email|mail/.test(k))return profile?.email||acct.email||null;if(/first.?name|vorname/.test(k))return profile?.first_name??null;if(/last.?name|nachname/.test(k))return profile?.last_name??null;if(/salutation|anrede/.test(k))return profile?.salutation??null;if(/household|numberofpeople|haushalt|personen/.test(k))return profile?.household_size??null;if(/income|einkommen/.test(k))return profile?.monthly_net_income??null;if(/employment|beruf|job/.test(k))return profile?.employment_status??null;if(/moveindate|move.?in|einzug/.test(k))return profile?.move_in_date??null;if(/pet|haustier/.test(k))return profile?.pets??null;if(/\bwbs\b|wohnungsberechtigung/.test(k))return profile?.wbs_status??null;if(/house.?number|hausnummer/.test(k))return profile?.house_number??null;if(/street|strasse|straße/.test(k))return profile?.street??null;if(/postcode|postal|\bplz\b/.test(k))return profile?.postcode??null;if(/city|stadt/.test(k))return profile?.city??null;return undefined}
function prepareRequired(form:any,profile:any,acct:any,message:string){
 const schema=form?.schema;
 if(!schema||!Array.isArray(schema.required))return{error:'required_field_contract_unverified'};
 const required=schema.required.map((x:any)=>String(x));
 if(!required.some((x:string)=>x.toLowerCase()==='message'))return{error:'required_field_contract_unverified'};
 const prefill=form?.data&&typeof form.data==='object'?form.data:{};
 const payload:any={},missing:any[]=[],unsupported:any[]=[],fields:any[]=[];
 for(const key of required){
  const label=formLabel(form?.uiSchema,key),type=String(schema?.properties?.[key]?.type||'');fields.push({id:key,label,type,required:true});
  let value:any;
  if(key.toLowerCase()==='message')value=message;
  else if(prefill[key]!==undefined&&prefill[key]!==null&&norm(prefill[key])!=='')value=prefill[key];
  else value=profileValue(key,profile,acct);
  if(value===undefined){unsupported.push({id:key,label,type});continue}
  if(value===null||norm(value)===''){missing.push({id:key,label,type});continue}
  payload[key]=value;
 }
 return{payload,fields,missing,unsupported};
}
async function contactForm(acct:any,adId:string){const r=await request(`${GATEWAY_HOST}${XCF_PATH(adId)}`,{headers:gatewayHeaders(acct.token,acct.xapp)});if(r.response.status===401||r.response.status===403)throw Error('needs_login');if(!r.response.ok){if(r.response.status===429||r.response.status>=500)throw Error('temporary_network_error');return{error:`contact_form_${r.response.status}`}}if(!r.json?.schema)return{error:'required_field_contract_unverified'};return{form:r.json}}

export async function sendKleinanzeigenMobileFirstContact(input:any){
 const{db,user,profile,listing,message,authorize}=input||{},userId=String(user?.id||''),adId=String(listing?.external_id||listing?.source_listing_key||'').match(/\d{6,20}/)?.[0]||'';
 if(!userId||!adId||!message)return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 const acct=await account(db,userId);
 const ad=await request(`${API_HOST}/api/ads/${encodeURIComponent(adId)}.json`,{headers:publicHeaders(acct.xapp)});
 if(ad.response.status===404||ad.response.status===410)return{success:false,status:'failed',error:'listing_unavailable'};
 if(!ad.response.ok){if(ad.response.status===429||ad.response.status>=500)throw Error('temporary_network_error');return{success:false,status:'manual_required',error:`ad_lookup_${ad.response.status}`}}
 if(adOwner(ad.json)&&adOwner(ad.json)===acct.uid)return{success:false,status:'manual_required',error:'self_listing'};
 const action=contactAction(ad.json);if(action&&action.toLowerCase()!=='conversation')return{success:false,status:'manual_required',error:'contact_action_unsupported'};

 const cf=await contactForm(acct,adId);if('error'in cf)return{success:false,status:'manual_required',error:cf.error};
 const prepared:any=prepareRequired(cf.form,profile,acct,message);if(prepared.error)return{success:false,status:'manual_required',error:prepared.error};
 if(prepared.unsupported.length)return{success:false,status:'manual_required',error:'required_field_contract_unverified'};
 if(prepared.missing.length)return{success:false,status:'manual_required',error:'required_profile_data_missing'};

 const existing=await currentConversation(acct,adId);
 if(existing?.id){const g=await openGateway(acct,String(existing.id)),a=g?null:await openMain(acct,String(existing.id)),opened=g||a;if(opened&&exactOutbound(opened,message))return{success:true,status:'sent'};if(opened&&hasOutbound(opened))return{success:false,status:'manual_required',error:'conversation_exists'}}
 if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'failed',error:'send_not_authorized'};

 const sent=await request(`${GATEWAY_HOST}${XCF_PATH(adId)}`,{method:'POST',headers:{...gatewayHeaders(acct.token,acct.xapp,true),'X-EBAYK-WENKSE-SESSION-ID':wenkseSessionId()},body:JSON.stringify(prepared.payload)});
 if(sent.response.status===401||sent.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login',`first_contact_${sent.response.status}`).catch(()=>{});return{success:false,status:'manual_required',error:'needs_login'}}
 if(sent.response.status===429||sent.response.status>=500)throw Error('temporary_network_error');
 if(!sent.response.ok)return{success:false,status:'manual_required',error:`first_contact_${sent.response.status}`};
 const cid=createdId(sent.json)||String(existing?.id||'')||null;
 if(!cid)return{success:false,status:'manual_required',error:'first_contact_conversation_id_missing'};
 const verified=await verify(acct,adId,cid,message);
 if(!verified)return{success:false,status:'manual_required',error:'message_accepted_unconfirmed'};
 return{success:true,status:'sent'};
}
