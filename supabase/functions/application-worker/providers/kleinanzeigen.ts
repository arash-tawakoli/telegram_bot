import {saveConnection,getConnection,markConnection,deleteConnection} from '../credentials.ts';

const DOMAIN='login.kleinanzeigen.de';
const API_HOST='https://api.kleinanzeigen.de';
const GATEWAY_HOST='https://gateway.kleinanzeigen.de';
const LEGACY_CLIENT_ID='uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const LEGACY_REDIRECT_URI='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const SCOPE='openid email profile offline_access';
const APP_VERSION='2026.37.1';
const APP_BASIC='Basic '+btoa('android:TaR60pEttY');
const AD_FIELDS='id,user-id,category,contact-name,phone,displayoptions,attributes,status,title,description,link';

const enc=new TextEncoder();
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const norm=(v:any)=>String(v??'').replace(/\s+/g,' ').trim();

async function challenge(verifier:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))}

export type KleinanzeigenOAuthConfig={clientId:string,redirectUri:string};
export const legacyKleinanzeigenOAuthConfig=():KleinanzeigenOAuthConfig=>({clientId:LEGACY_CLIENT_ID,redirectUri:LEGACY_REDIRECT_URI});

function oauthConfig(value?:KleinanzeigenOAuthConfig|null):KleinanzeigenOAuthConfig{
 if(!value)return legacyKleinanzeigenOAuthConfig();
 const clientId=String(value.clientId||'').trim(),redirectUri=String(value.redirectUri||'').trim();
 if(!clientId||clientId.length>512)throw Error('oauth_client_invalid');
 let parsed:URL;try{parsed=new URL(redirectUri)}catch{throw Error('oauth_redirect_invalid')}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('oauth_redirect_invalid');
 return{clientId,redirectUri:parsed.href};
}

function validateCallbackTarget(actual:URL,redirectUri:string){
 let expected:URL;try{expected=new URL(redirectUri)}catch{throw Error('oauth_redirect_invalid')}
 if(actual.protocol!==expected.protocol||actual.hostname!==expected.hostname||actual.port!==expected.port||actual.pathname!==expected.pathname)throw Error('invalid_callback_url');
 for(const[k,v]of expected.searchParams.entries())if(actual.searchParams.get(k)!==v)throw Error('invalid_callback_url');
}

async function optionalSecret(db:any,name:string){try{const{data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)return null;return String(data)}catch{return null}}

async function tokenRequest(db:any,clientId:string,payload:Record<string,unknown>){
 const configuredClientId=await optionalSecret(db,'kleinanzeigen_oauth_client_id');
 const clientSecret=configuredClientId===clientId?await optionalSecret(db,'kleinanzeigen_oauth_client_secret'):null;
 const body:any={...payload,client_id:clientId};if(clientSecret)body.client_secret=clientSecret;
 const response=await fetch(`https://${DOMAIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const token=await response.json().catch(()=>null);return{response,token};
}

export async function beginKleinanzeigenLogin(db:any,userId:string,config?:KleinanzeigenOAuthConfig|null){
 const oauth=oauthConfig(config);
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','kleinanzeigen').is('consumed_at',null);
 const verifier=random(),state=random().slice(0,32),codeChallenge=await challenge(verifier);
 const{error}=await db.from('platform_auth_flows').insert({user_id:userId,provider:'kleinanzeigen',state,code_verifier:verifier});if(error)throw Error('auth_flow_create_failed');
 const url=new URL(`https://${DOMAIN}/authorize`);
 for(const[k,v]of Object.entries({client_id:oauth.clientId,response_type:'code',redirect_uri:oauth.redirectUri,scope:SCOPE,code_challenge:codeChallenge,code_challenge_method:'S256',state,prompt:'login'}))url.searchParams.set(k,String(v));
 await markConnection(db,userId,'kleinanzeigen','pending');
 const legacy=oauth.redirectUri===LEGACY_REDIRECT_URI;
 return{status:'login',url:url.href,requiresCallback:legacy,automaticCallback:!legacy,bridgeRequired:legacy,transport:legacy?'safari-extension-bridge':'direct-oauth'};
}

async function finishKleinanzeigenLogin(db:any,flow:any,redirectUrl:string,config?:KleinanzeigenOAuthConfig|null){
 const oauth=oauthConfig(config);let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}
 validateCallbackTarget(url,oauth.redirectUri);
 const code=url.searchParams.get('code'),state=url.searchParams.get('state');if(!code||!state||state!==String(flow.state))throw Error('invalid_callback_url');
 const{response,token}=await tokenRequest(db,oauth.clientId,{grant_type:'authorization_code',code,code_verifier:flow.code_verifier,redirect_uri:oauth.redirectUri});
 if(!response.ok||!token?.access_token||!token?.refresh_token)throw Error('token_exchange_failed');
 const expiresAt=new Date(Date.now()+Number(token.expires_in||600)*1000).toISOString();let accountHint:string|null=null;
 if(token.id_token){try{const p=token.id_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');accountHint=JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,'='))).email||null}catch{}}
 await saveConnection(db,flow.user_id,'kleinanzeigen',{access_token:token.access_token,refresh_token:token.refresh_token,expires_at:expiresAt,oauth_client_id:oauth.clientId,oauth_redirect_uri:oauth.redirectUri},{account_hint:accountHint,expires_at:expiresAt});
 await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.id);
 return{status:'connected',authenticated:true,accountHint,userId:String(flow.user_id)};
}

export async function completeKleinanzeigenLogin(db:any,userId:string,redirectUrl:string,config?:KleinanzeigenOAuthConfig|null){
 let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}
 const state=url.searchParams.get('state');if(!state)throw Error('invalid_callback_url');
 const{data:flow,error}=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider','kleinanzeigen').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
 if(error||!flow)throw Error('auth_flow_expired');return finishKleinanzeigenLogin(db,flow,url.href,config);
}

export async function completeKleinanzeigenCallback(db:any,redirectUrl:string,config?:KleinanzeigenOAuthConfig|null){
 let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}
 const oauth=oauthConfig(config);validateCallbackTarget(url,oauth.redirectUri);const state=url.searchParams.get('state');if(!state)throw Error('invalid_callback_url');
 const{data:flow,error}=await db.from('platform_auth_flows').select('*').eq('provider','kleinanzeigen').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
 if(error||!flow)throw Error('auth_flow_expired');
 if(url.searchParams.get('error')){await markConnection(db,String(flow.user_id),'kleinanzeigen','needs_login',String(url.searchParams.get('error')).slice(0,120)).catch(()=>{});throw Error('oauth_login_failed')}
 return finishKleinanzeigenLogin(db,flow,url.href,oauth);
}

async function refresh(db:any,userId:string,connection:any){
 const credentials=connection.credentials||{};
 if(credentials.access_token&&Date.parse(credentials.expires_at||'')>Date.now()+60000)return credentials;
 if(!credentials.refresh_token)throw Error('needs_login');
 const clientId=String(credentials.oauth_client_id||LEGACY_CLIENT_ID),{response,token}=await tokenRequest(db,clientId,{grant_type:'refresh_token',refresh_token:credentials.refresh_token});
 if(!response.ok||!token?.access_token){await markConnection(db,userId,'kleinanzeigen','needs_login','refresh_failed');throw Error('needs_login')}
 const updated={...credentials,access_token:token.access_token,refresh_token:token.refresh_token||credentials.refresh_token,expires_at:new Date(Date.now()+Number(token.expires_in||600)*1000).toISOString(),oauth_client_id:clientId};
 await saveConnection(db,userId,'kleinanzeigen',updated,{expires_at:updated.expires_at,account_hint:connection.row.account_hint});return updated;
}

export async function disconnectKleinanzeigen(db:any,userId:string){await deleteConnection(db,userId,'kleinanzeigen');return{status:'disconnected'}}
export async function kleinanzeigenAccessToken(db:any,userId:string){const c=await getConnection(db,userId,'kleinanzeigen');if(!c)throw Error('needs_login');return(await refresh(db,userId,c)).access_token}

function appBaseHeaders(xIn?:string){
 const h:any={'X-ECG-USER-AGENT':`ebayk-android-app-${APP_VERSION}`,'X-ECG-USER-VERSION':APP_VERSION,'User-Agent':'okhttp/4.10.0','Accept':'application/json','Accept-Language':'de-DE'};
 if(xIn)h['X-ECG-IN']=xIn;return h;
}
function publicApiHeaders(xIn?:string){return{...appBaseHeaders(xIn),Authorization:APP_BASIC}}
function currentMainApiHeaders(token:string,xIn?:string){return{...appBaseHeaders(xIn),Authorization:APP_BASIC,'X-ECG-Authorization-User':`Bearer ${token}`}}
function legacyMainApiHeaders(token:string,email:string,xIn?:string){return{...appBaseHeaders(xIn),Authorization:APP_BASIC,'X-EBAYK-USERID-TOKEN':token,'X-ECG-Authorization-User':`email=${email},access=${token}`}}
function gatewayHeaders(token:string,withBody=false){const h:any={...appBaseHeaders(),Authorization:`Bearer ${token}`};if(withBody)h['Content-Type']='application/json';return h}

function scalar(v:any):any{while(v&&typeof v==='object'&&'value'in v)v=v.value;return v}
function unwrapPayload(body:any){if(!body||typeof body!=='object')return{};const k=Object.keys(body).find(x=>x.startsWith('{http'));let v=k?body?.[k]?.value:body;while(v&&typeof v==='object'&&Object.keys(v).length<=4&&'value'in v)v=v.value;return v&&typeof v==='object'?v:{}}
function adOwnerId(body:any){const a=unwrapPayload(body);return String(scalar(a?.['user-id']??a?.userId??a?.user?.id)||'')}
function categoryId(body:any){const a=unwrapPayload(body);return String(scalar(a?.category?.id??a?.categoryId??a?.['category-id'])||'')}

async function apiRequest(url:string,init:RequestInit){
 try{const response=await fetch(url,{...init,signal:AbortSignal.timeout(30000)}),text=await response.text();let json:any=null;try{json=JSON.parse(text)}catch{}return{response,json,text}}
 catch(error:any){if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('temporary_network_error');throw Error('temporary_network_error')}
}

async function session(db:any,userId:string){
 const c=await getConnection(db,userId,'kleinanzeigen');if(!c)throw Error('needs_login');
 const credentials=await refresh(db,userId,c),email=String(c.row.account_hint||'').trim();if(!email)throw Error('needs_login');
 return{token:String(credentials.access_token),email};
}

async function authenticatedMainRequest(s:any,url:string,init:RequestInit={},xIn?:string){
 const current=await apiRequest(url,{...init,headers:{...currentMainApiHeaders(s.token,xIn),...(init.headers||{})}});
 if(current.response.status!==401&&current.response.status!==403)return{...current,authMode:'bearer' as const};
 const legacy=await apiRequest(url,{...init,headers:{...legacyMainApiHeaders(s.token,s.email,xIn),...(init.headers||{})}});
 return{...legacy,authMode:'legacy' as const};
}

function profileNameFromPayload(body:any){
 const root=unwrapPayload(body),seen=new Set<any>();
 function walk(v:any,depth=0):string{
  if(!v||typeof v!=='object'||depth>6||seen.has(v))return'';seen.add(v);
  for(const k of['profileName','profile-name','contactName','contact-name','displayName','display-name','nickname','userName','username']){const x=scalar(v?.[k]);if(typeof x==='string'&&x.trim()&&!x.includes('@'))return x.trim()}
  for(const x of Object.values(v)){const found=walk(x,depth+1);if(found)return found}
  return'';
 }
 return walk(root)||walk(body);
}

async function account(db:any,userId:string){
 const s=await session(db,userId);
 const r=await authenticatedMainRequest(s,`${API_HOST}/api/users/${encodeURIComponent(s.email)}/profile.json`,{method:'GET'});
 if(r.response.status===401||r.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login','profile_auth_failed').catch(()=>{});throw Error('needs_login')}
 if(!r.response.ok){if(r.response.status===429||r.response.status>=500)throw Error('temporary_network_error');throw Error('provider_contract_unverified')}
 const p=unwrapPayload(r.json);const id=scalar(p?.data?.id??p?.id??r.json?.data?.id??r.json?.id??r.json?.value?.id);
 if(!id)throw Error('provider_contract_unverified');
 return{...s,id:String(id),profileName:profileNameFromPayload(r.json),authMode:r.authMode};
}

export async function checkKleinanzeigenConnection(db:any,userId:string){
 const c=await getConnection(db,userId,'kleinanzeigen');if(!c)return{authenticated:false};
 try{const a=await account(db,userId);return{authenticated:true,authMode:a.authMode,clientVersion:APP_VERSION}}catch{return{authenticated:false}}
}

function conversationRows(body:any){let rows=body?.conversations??body?.data?.conversations??body?.data??[];if(rows&&typeof rows==='object'&&!Array.isArray(rows))rows=rows.conversations??rows.items??[];return Array.isArray(rows)?rows:[]}
function conversationForAd(rows:any[],adId:string){return rows.find((e:any)=>String(e?.adId??e?.ad?.id??e?.advertisementId??'')===adId)||null}
async function listConversations(uid:string,token:string){const r=await apiRequest(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(uid)}/conversations?page=0&size=100`,{method:'GET',headers:gatewayHeaders(token)});if(r.response.status===401||r.response.status===403)throw Error('needs_login');if(!r.response.ok){if(r.response.status===429||r.response.status>=500)throw Error('temporary_network_error');throw Error('provider_contract_unverified')}return conversationRows(r.json)}
async function openConversation(uid:string,cid:string,token:string){const r=await apiRequest(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(uid)}/conversations/${encodeURIComponent(cid)}?contentWarnings=true`,{method:'PUT',headers:gatewayHeaders(token)});return r.response.ok?r.json:null}
function outboundTexts(body:any){const rows=body?.messages??body?.data?.messages??[];if(!Array.isArray(rows))return[];return rows.map((e:any)=>{const d=String(e?.boundness??e?.direction??'').toUpperCase();return d.includes('OUT')?norm(e?.text??e?.textShort??e?.title??''):null}).filter((v:any)=>v!==null)}
function outboundMessageExists(body:any,message:string){const wanted=norm(message);return outboundTexts(body).some((v:string)=>v===wanted)}
function anyOutboundMessageExists(body:any){return outboundTexts(body).length>0}
function createdConversationId(body:any){for(const v of[body?.conversationId,body?.data?.conversationId,body?.id,body?.data?.id,body?.conversation?.id,body?.data?.conversation?.id,body?.value?.id]){const id=scalar(v);if(id)return String(id)}return null}
async function findConversationWithRetry(uid:string,token:string,adId:string){for(const d of[700,1400,2600]){await wait(d);const c=conversationForAd(await listConversations(uid,token),adId);if(c?.id)return c}return null}
async function verifyOutboundWithRetry(uid:string,cid:string,token:string,adId:string,message:string){const wanted=norm(message);for(const d of[700,1400,2600,4200]){await wait(d);const opened=await openConversation(uid,cid,token);if(opened&&outboundMessageExists(opened,message))return true;const c=conversationForAd(await listConversations(uid,token),adId);if(c&&norm(c?.textShortTrimmed??c?.textShort??c?.preview)===wanted)return true}return false}

function contactAction(body:any){const a=unwrapPayload(body);return norm(scalar(a?.displayoptions?.['contact-button-on-vip']?.action?.type??a?.displayoptions?.contactButtonOnVip?.action?.type));}
function contactConfig(body:any){const a=unwrapPayload(body);return a?.displayoptions?.['contact-button-on-vip']?.action?.data??a?.displayoptions?.contactButtonOnVip?.action?.data??a?.contactForm??a?.inquiryForm??a?.requestForm??null;}

type InquiryRequirement={id:string,label:string,type:string,source:string,path:string};
function requirementKey(v:any,path:string[]){return norm(scalar(v?.id??v?.name??v?.key??v?.field??v?.attribute??path[path.length-1]));}
function requirementLabel(v:any){return norm(scalar(v?.label??v?.title??v?.localizedLabel??v?.['localized-label']??v?.displayName));}
function isApplicantDescriptor(text:string){return/(message|nachricht|phone|telefon|email|mail|income|einkommen|household|haushalt|move|einzug|employment|beruf|job|pets?|haustier|wbs|wohnungsberechtigung|address|adresse|street|strasse|straße|postcode|postal|plz|city|stadt|first.?name|vorname|last.?name|nachname|salutation|anrede)/i.test(text)}
function collectExplicitRequirements(root:any,source:string){
 const out:InquiryRequirement[]=[];const seen=new Set<string>();
 function walk(v:any,path:string[],depth:number){
  if(!v||typeof v!=='object'||depth>9)return;
  if(Array.isArray(v)){for(let i=0;i<Math.min(v.length,80);i++)walk(v[i],[...path,String(i)],depth+1);return}
  const id=requirementKey(v,path),label=requirementLabel(v),type=norm(scalar(v?.type??v?.inputType??v?.input_type));
  const required=v?.required===true||v?.mandatory===true||v?.isRequired===true||norm(scalar(v?.requirement)).toLowerCase()==='required';
  const descriptor=[path.join('.'),id,label,type].join(' ');
  if(required&&isApplicantDescriptor(descriptor)){const key=`${source}:${path.join('.')}:${id}`;if(!seen.has(key)){seen.add(key);out.push({id:id||path[path.length-1]||'field',label,type,source,path:path.join('.')})}}
  for(const[k,x]of Object.entries(v))walk(x,[...path,k],depth+1);
 }
 walk(root,[],0);return out;
}

function valueForRequirement(f:InquiryRequirement,profile:any,acct:any,message:string){
 const key=`${f.id} ${f.label} ${f.path}`.toLowerCase();
 if(/message|nachricht/.test(key))return message;
 if(/phone|telefon/.test(key))return profile?.phone??null;
 if(/email|e-mail|mail/.test(key))return profile?.email||acct.email||null;
 if(/household|haushalt/.test(key))return profile?.household_size??null;
 if(/income|einkommen/.test(key))return profile?.monthly_net_income??null;
 if(/move|einzug/.test(key))return profile?.move_in_date??null;
 if(/employment|beruf|job/.test(key))return profile?.employment_status??null;
 if(/pet|haustier/.test(key))return profile?.pets??null;
 if(/\bwbs\b|wohnungsberechtigung/.test(key))return profile?.wbs_status??null;
 if(/salutation|anrede/.test(key))return profile?.salutation??null;
 if(/first.?name|vorname/.test(key))return profile?.first_name??null;
 if(/last.?name|nachname/.test(key))return profile?.last_name??null;
 if(/house.?number|hausnummer/.test(key))return profile?.house_number??null;
 if(/street|strasse|straße/.test(key))return profile?.street??null;
 if(/postcode|postal|\bplz\b/.test(key))return profile?.postcode??null;
 if(/city|stadt/.test(key))return profile?.city??null;
 if(/address|adresse/.test(key)){const parts=[profile?.street,profile?.house_number,profile?.postcode,profile?.city].filter(Boolean);return parts.length>=3?parts.join(' '):null}
 return undefined;
}

async function inquiryPreflight(adResponse:any,message:string,profile:any,acct:any){
 const action=contactAction(adResponse.json),cat=categoryId(adResponse.json),cfg=contactConfig(adResponse.json);
 const explicit=cfg?collectExplicitRequirements(cfg,'contact_config'):[];
 const required:InquiryRequirement[]=[{id:'message',label:'Nachricht',type:'TEXT',source:'builtin',path:'message'}];
 const dedup=new Map<string,InquiryRequirement>();for(const f of [...required,...explicit])dedup.set(`${f.id}|${f.label}`.toLowerCase(),f);
 const fields=[...dedup.values()],answers:any={},missing:InquiryRequirement[]=[],unsupported:InquiryRequirement[]=[];
 for(const f of fields){const value=valueForRequirement(f,profile,acct,message);if(value===undefined){unsupported.push(f);continue}if(value===null||String(value).trim()===''){missing.push(f);continue}answers[f.id]=value}
 return{action,categoryId:cat,requiredFields:fields,answers,missing,unsupported,dynamicConfigDetected:!!cfg};
}

export async function inspectKleinanzeigenInquiry(input:any){
 const{db,user,profile,listing,message}=input||{},userId=String(user?.id||''),adId=String(listing?.external_id||listing?.source_listing_key||'').match(/\d{6,20}/)?.[0]||'';
 if(!userId||!adId||!message)return{ok:false,error:'provider_contract_unverified'};
 const ad=await apiRequest(`${API_HOST}/api/ads/${encodeURIComponent(adId)}.json`,{method:'GET',headers:publicApiHeaders(AD_FIELDS)});
 if(!ad.response.ok)return{ok:false,error:`ad_lookup_${ad.response.status}`};
 const acct=await account(db,userId),preflight=await inquiryPreflight(ad,message,profile,acct);
 return{ok:!preflight.unsupported.length&&!preflight.missing.length,clientVersion:APP_VERSION,authMode:acct.authMode,accountProfileNamePresent:!!acct.profileName,...preflight};
}

export async function sendKleinanzeigenApplication(input:any){
 const{db,user,profile,listing,message,authorize}=input||{},userId=String(user?.id||''),adId=String(listing?.external_id||listing?.source_listing_key||'').match(/\d{6,20}/)?.[0]||'';
 if(!userId||!adId||!message)return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 const ad=await apiRequest(`${API_HOST}/api/ads/${encodeURIComponent(adId)}.json`,{method:'GET',headers:publicApiHeaders(AD_FIELDS)});
 if(ad.response.status===404||ad.response.status===410)return{success:false,status:'failed',error:'listing_unavailable'};
 if(!ad.response.ok){if(ad.response.status===429||ad.response.status>=500)throw Error('temporary_network_error');return{success:false,status:'manual_required',error:`ad_lookup_${ad.response.status}`}}
 const acct=await account(db,userId),ownerId=adOwnerId(ad.json);if(ownerId&&ownerId===acct.id)return{success:false,status:'manual_required',error:'self_listing'};
 const preflight=await inquiryPreflight(ad,message,profile,acct);
 if(preflight.action&&preflight.action.toLowerCase()!=='conversation')return{success:false,status:'manual_required',error:'contact_action_unsupported'};
 if(preflight.unsupported.length)return{success:false,status:'manual_required',error:'required_field_contract_unverified'};
 if(preflight.missing.length)return{success:false,status:'manual_required',error:'required_profile_data_missing'};
 if(!acct.profileName)return{success:false,status:'manual_required',error:'account_profile_name_unavailable'};
 await wait(900);
 let existing=conversationForAd(await listConversations(acct.id,acct.token),adId),cid:string|null=null;
 if(existing?.id){cid=String(existing.id);const opened=await openConversation(acct.id,cid,acct.token);if(opened&&outboundMessageExists(opened,message))return{success:true,status:'sent'};if(opened&&anyOutboundMessageExists(opened))return{success:false,status:'manual_required',error:'conversation_exists'}}
 if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'failed',error:'send_not_authorized'};
 if(!cid){
  await wait(900);const createUrl=new URL(`${API_HOST}/api/users/${encodeURIComponent(acct.id)}/create-conversation/${encodeURIComponent(adId)}`);createUrl.searchParams.set('contactName',acct.profileName.slice(0,120));
  const headers=acct.authMode==='bearer'?currentMainApiHeaders(acct.token):legacyMainApiHeaders(acct.token,acct.email);
  const created=await apiRequest(createUrl.href,{method:'POST',headers});
  if(created.response.status===401||created.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login','create_conversation_auth_failed').catch(()=>{});return{success:false,status:'manual_required',error:'needs_login'}}
  if(!created.response.ok)return{success:false,status:'manual_required',error:`create_conversation_${created.response.status}`};
  cid=createdConversationId(created.json);if(!cid){existing=await findConversationWithRetry(acct.id,acct.token,adId);cid=existing?.id?String(existing.id):null}
  if(!cid)return{success:false,status:'manual_required',error:'create_conversation_unconfirmed'};
 }
 await wait(1500);const sendUrl=new URL(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(acct.id)}/conversations/${encodeURIComponent(cid)}`);
 sendUrl.searchParams.set('warnPhoneNumber','true');sendUrl.searchParams.set('warnEmail','true');sendUrl.searchParams.set('warnBankDetails','true');
 const sent=await apiRequest(sendUrl.href,{method:'POST',headers:gatewayHeaders(acct.token,true),body:JSON.stringify({message})});
 if(sent.response.status===401||sent.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login','message_auth_failed').catch(()=>{});return{success:false,status:'manual_required',error:'needs_login'}}
 if(!sent.response.ok)return{success:false,status:'manual_required',error:`message_send_${sent.response.status}`};
 if(!await verifyOutboundWithRetry(acct.id,cid,acct.token,adId,message))return{success:false,status:'manual_required',error:'message_accepted_unconfirmed'};
 return{success:true,status:'sent'};
}
