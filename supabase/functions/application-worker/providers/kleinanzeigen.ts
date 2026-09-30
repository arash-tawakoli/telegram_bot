import {claimPlatformConnectFlow,completePlatformConnectFlow} from '../../_shared/platform-auth-flow.ts';
import {encryptCredentials,saveConnection,getConnection,markConnection,deleteConnection,recordRefreshResult} from '../credentials.ts';
import {providerEnumCandidates,providerSalutation,providerEmployment,providerHousehold,providerIncome,providerMoveIn} from '../../_shared/application-profile-adapters.ts';

const DOMAIN='login.kleinanzeigen.de';
const API_HOST='https://api.kleinanzeigen.de';
const GATEWAY_HOST='https://gateway.kleinanzeigen.de';
const LEGACY_CLIENT_ID='uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const LEGACY_REDIRECT_URI='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const SCOPE='openid email profile offline_access';
const APP_VERSION='2026.37.1';
const APP_BASIC='Basic '+btoa('android:TaR60pEttY');
const AD_FIELDS='id,user-id,category,contact-name,displayoptions,status,title,link';
const XCF_PATH=(adId:string)=>`/user-contactdetails/api/v1/ad/${encodeURIComponent(adId)}/contact-form`;
const enc=new TextEncoder();
const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const norm=(v:any)=>String(v??'').replace(/\s+/g,' ').trim();

export type KleinanzeigenOAuthConfig={clientId:string,redirectUri:string};
export const legacyKleinanzeigenOAuthConfig=():KleinanzeigenOAuthConfig=>({clientId:LEGACY_CLIENT_ID,redirectUri:LEGACY_REDIRECT_URI});
async function challenge(verifier:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(verifier))))}
function oauthConfig(value?:KleinanzeigenOAuthConfig|null):KleinanzeigenOAuthConfig{if(!value)return legacyKleinanzeigenOAuthConfig();const clientId=String(value.clientId||'').trim(),redirectUri=String(value.redirectUri||'').trim();if(!clientId||clientId.length>512)throw Error('oauth_client_invalid');let parsed:URL;try{parsed=new URL(redirectUri)}catch{throw Error('oauth_redirect_invalid')}if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('oauth_redirect_invalid');return{clientId,redirectUri:parsed.href}}
function validateCallbackTarget(actual:URL,redirectUri:string){let expected:URL;try{expected=new URL(redirectUri)}catch{throw Error('oauth_redirect_invalid')}if(actual.protocol!==expected.protocol||actual.hostname!==expected.hostname||actual.port!==expected.port||actual.pathname!==expected.pathname)throw Error('invalid_callback_url');for(const[k,v]of expected.searchParams.entries())if(actual.searchParams.get(k)!==v)throw Error('invalid_callback_url')}
async function optionalSecret(db:any,name:string){try{const{data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)return null;return String(data)}catch{return null}}
async function tokenRequest(db:any,clientId:string,payload:Record<string,unknown>){const configuredClientId=await optionalSecret(db,'kleinanzeigen_oauth_client_id'),clientSecret=configuredClientId===clientId?await optionalSecret(db,'kleinanzeigen_oauth_client_secret'):null,body:any={...payload,client_id:clientId};if(clientSecret)body.client_secret=clientSecret;const response=await fetch(`https://${DOMAIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)}),token=await response.json().catch(()=>null);return{response,token}}
export async function beginKleinanzeigenLogin(db:any,userId:string,config?:KleinanzeigenOAuthConfig|null,meta:any={}){
 const oauth=oauthConfig(config),origin=String(meta?.origin||'')||null,returnTarget=String(meta?.returnTarget||'')||null,issuedBy=meta?.issuedBy?String(meta.issuedBy):null;
 const reuseWindowMs=Math.max(0,Math.min(5*60*1000,Number(meta?.reuseWindowMs||0)));
 if(reuseWindowMs>0){
  let q=db.from('platform_auth_flows').select('state,code_verifier,created_at,expires_at,origin,return_target,issued_by')
   .eq('user_id',userId).eq('provider','kleinanzeigen').is('consumed_at',null)
   .gt('expires_at',new Date().toISOString()).gt('created_at',new Date(Date.now()-reuseWindowMs).toISOString())
   .eq('origin',origin).eq('return_target',returnTarget).order('created_at',{ascending:false}).limit(1);
  if(issuedBy)q=q.eq('issued_by',issuedBy);else q=q.is('issued_by',null);
  const {data:rows}=await q;
  const existing=Array.isArray(rows)?rows[0]:null;
  if(existing?.state&&existing?.code_verifier){
   const url=new URL(`https://${DOMAIN}/authorize`),codeChallenge=await challenge(String(existing.code_verifier));
   for(const[k,v]of Object.entries({client_id:oauth.clientId,response_type:'code',redirect_uri:oauth.redirectUri,scope:SCOPE,code_challenge:codeChallenge,code_challenge_method:'S256',state:String(existing.state),prompt:'login'}))url.searchParams.set(k,String(v));
   await markConnection(db,userId,'kleinanzeigen','pending');
   const legacy=oauth.redirectUri===LEGACY_REDIRECT_URI;
   return{status:'login',url:url.href,requiresCallback:legacy,automaticCallback:!legacy,bridgeRequired:legacy,transport:legacy?'legacy-mobile-callback':'direct-oauth',reused:true};
  }
 }
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','kleinanzeigen').is('consumed_at',null);
 const verifier=random(),state=random().slice(0,32),codeChallenge=await challenge(verifier),{error}=await db.from('platform_auth_flows').insert({user_id:userId,provider:'kleinanzeigen',state,code_verifier:verifier,origin,return_target:returnTarget,issued_by:issuedBy,context:meta?.context&&typeof meta.context==='object'?meta.context:{}});
 if(error)throw Error('auth_flow_create_failed');
 const url=new URL(`https://${DOMAIN}/authorize`);
 for(const[k,v]of Object.entries({client_id:oauth.clientId,response_type:'code',redirect_uri:oauth.redirectUri,scope:SCOPE,code_challenge:codeChallenge,code_challenge_method:'S256',state,prompt:'login'}))url.searchParams.set(k,String(v));
 await markConnection(db,userId,'kleinanzeigen','pending');
 const legacy=oauth.redirectUri===LEGACY_REDIRECT_URI;
 return{status:'login',url:url.href,requiresCallback:legacy,automaticCallback:!legacy,bridgeRequired:legacy,transport:legacy?'legacy-mobile-callback':'direct-oauth',reused:false}
}
async function finishKleinanzeigenLogin(db:any,flow:any,redirectUrl:string,config?:KleinanzeigenOAuthConfig|null){const oauth=oauthConfig(config);let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}validateCallbackTarget(url,oauth.redirectUri);const code=url.searchParams.get('code'),state=url.searchParams.get('state');if(!code||!state||state!==String(flow.state))throw Error('invalid_callback_url');await claimPlatformConnectFlow(db,flow);const{response,token}=await tokenRequest(db,oauth.clientId,{grant_type:'authorization_code',code,code_verifier:flow.code_verifier,redirect_uri:oauth.redirectUri});if(!response.ok||!token?.access_token||!token?.refresh_token)throw Error('token_exchange_failed');const expiresAt=new Date(Date.now()+Number(token.expires_in||600)*1000).toISOString();let accountHint:string|null=null;if(token.id_token){try{const p=token.id_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');accountHint=JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,'='))).email||null}catch{}}const encrypted=await encryptCredentials(db,flow.user_id,'kleinanzeigen',{access_token:token.access_token,refresh_token:token.refresh_token,expires_at:expiresAt,oauth_client_id:oauth.clientId,oauth_redirect_uri:oauth.redirectUri,x_ebayk_app:`${crypto.randomUUID()}${Date.now()}`});await completePlatformConnectFlow(db,flow,{...encrypted,account_hint:accountHint,expires_at:expiresAt});return{status:'connected',authenticated:true,accountHint,userId:String(flow.user_id)}}
export async function completeKleinanzeigenLogin(db:any,userId:string,redirectUrl:string,config?:KleinanzeigenOAuthConfig|null){let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}const state=url.searchParams.get('state');if(!state)throw Error('invalid_callback_url');const{data:flow,error}=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider','kleinanzeigen').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();if(error||!flow)throw Error('auth_flow_expired');return finishKleinanzeigenLogin(db,flow,url.href,config)}
export async function completeKleinanzeigenCallback(db:any,redirectUrl:string,config?:KleinanzeigenOAuthConfig|null){let url:URL;try{url=new URL(redirectUrl.trim())}catch{throw Error('invalid_callback_url')}const oauth=oauthConfig(config);validateCallbackTarget(url,oauth.redirectUri);const state=url.searchParams.get('state');if(!state)throw Error('invalid_callback_url');const{data:flow,error}=await db.from('platform_auth_flows').select('*').eq('provider','kleinanzeigen').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();if(error||!flow)throw Error('auth_flow_expired');if(url.searchParams.get('error')){await markConnection(db,String(flow.user_id),'kleinanzeigen','needs_login',String(url.searchParams.get('error')).slice(0,120)).catch(()=>{});throw Error('oauth_login_failed')}return finishKleinanzeigenLogin(db,flow,url.href,oauth)}
async function refresh(db:any,userId:string,connection:any,force=false){
 const credentials=connection.credentials||{};
 if(!force&&credentials.access_token&&Date.parse(credentials.expires_at||'')>Date.now()+60000)return credentials;
 if(!credentials.refresh_token)throw Error('needs_login');
 const clientId=String(credentials.oauth_client_id||LEGACY_CLIENT_ID);
 let response:Response,token:any=null;
 try{
  const result=await tokenRequest(db,clientId,{grant_type:'refresh_token',refresh_token:credentials.refresh_token});
  response=result.response;token=result.token;
 }catch(error:any){
  await recordRefreshResult(db,userId,'kleinanzeigen',false,'refresh_network_error').catch(()=>{});
  throw error;
 }
 if(!response.ok||!token?.access_token){
  await recordRefreshResult(db,userId,'kleinanzeigen',false,`refresh_http_${response.status}`).catch(()=>{});
  await markConnection(db,userId,'kleinanzeigen','needs_login','refresh_failed');
  throw Error('needs_login');
 }
 const updated={...credentials,access_token:token.access_token,refresh_token:token.refresh_token||credentials.refresh_token,expires_at:new Date(Date.now()+Number(token.expires_in||600)*1000).toISOString(),oauth_client_id:clientId,x_ebayk_app:credentials.x_ebayk_app||`${crypto.randomUUID()}${Date.now()}`};
 await saveConnection(db,userId,'kleinanzeigen',updated,{expires_at:updated.expires_at,account_hint:connection.row.account_hint});
 await recordRefreshResult(db,userId,'kleinanzeigen',true,null,updated.expires_at).catch(()=>{});
 return updated;
}
export async function disconnectKleinanzeigen(db:any,userId:string){await deleteConnection(db,userId,'kleinanzeigen');return{status:'disconnected'}}
export async function kleinanzeigenAccessToken(db:any,userId:string){const c=await getConnection(db,userId,'kleinanzeigen');if(!c)throw Error('needs_login');return(await refresh(db,userId,c)).access_token}
function appBaseHeaders(xapp:string,xIn?:string){const h:any={'X-EBAYK-APP':xapp,'X-ECG-USER-AGENT':`ebayk-android-app-${APP_VERSION}`,'X-ECG-USER-VERSION':APP_VERSION,'User-Agent':`Kleinanzeigen/${APP_VERSION} (Android 13; Pixel 7)`,'Accept':'application/json','Accept-Language':'de-DE'};if(xIn)h['X-ECG-IN']=xIn;return h}
function publicApiHeaders(xapp:string,xIn?:string){return{...appBaseHeaders(xapp,xIn),Authorization:APP_BASIC}}
function legacyMainApiHeaders(token:string,email:string,xapp:string,xIn?:string){return{...appBaseHeaders(xapp,xIn),Authorization:APP_BASIC,'X-EBAYK-USERID-TOKEN':token,'X-ECG-Authorization-User':`email=${email},access=${token}`}}
function gatewayHeaders(token:string,xapp:string,withBody=false){const h:any={...appBaseHeaders(xapp),Authorization:`Bearer ${token}`};if(withBody)h['Content-Type']='application/json';return h}
function scalar(v:any):any{while(v&&typeof v==='object'&&'value'in v)v=v.value;return v}
function unwrapPayload(body:any){if(!body||typeof body!=='object')return{};const k=Object.keys(body).find(x=>x.startsWith('{http'));let v=k?body?.[k]?.value:body;while(v&&typeof v==='object'&&Object.keys(v).length<=4&&'value'in v)v=v.value;return v&&typeof v==='object'?v:{}}
function adOwnerId(body:any){const a=unwrapPayload(body);return String(scalar(a?.['user-id']??a?.userId??a?.user?.id)||'')}
function categoryId(body:any){const a=unwrapPayload(body);return String(scalar(a?.category?.id??a?.categoryId??a?.['category-id'])||'')}
async function apiRequest(url:string,init:RequestInit={}){try{const response=await fetch(url,{...init,signal:AbortSignal.timeout(30000)}),text=await response.text();let json:any=null;try{json=JSON.parse(text)}catch{}return{response,json,text}}catch(error:any){if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('temporary_network_error');throw Error('temporary_network_error')}}
async function session(db:any,userId:string,force=false){
 const c=await getConnection(db,userId,'kleinanzeigen');
 if(!c)throw Error('needs_login');
 const credentials=await refresh(db,userId,c,force),email=String(c.row.account_hint||'').trim();
 if(!email)throw Error('needs_login');
 const xapp=String(credentials.x_ebayk_app||`${crypto.randomUUID()}${Date.now()}`);
 if(!credentials.x_ebayk_app){
  const updated={...credentials,x_ebayk_app:xapp};
  await saveConnection(db,userId,'kleinanzeigen',updated,{expires_at:updated.expires_at,account_hint:c.row.account_hint});
 }
 return{token:String(credentials.access_token),email,xapp};
}
async function account(db:any,userId:string,force=false){
 let s=await session(db,userId,force);
 let r=await apiRequest(`${API_HOST}/api/users/${encodeURIComponent(s.email)}/profile.json`,{method:'GET',headers:legacyMainApiHeaders(s.token,s.email,s.xapp)});
 if((r.response.status===401||r.response.status===403)&&!force){
  s=await session(db,userId,true);
  r=await apiRequest(`${API_HOST}/api/users/${encodeURIComponent(s.email)}/profile.json`,{method:'GET',headers:legacyMainApiHeaders(s.token,s.email,s.xapp)});
 }
 if(r.response.status===401||r.response.status===403){
  await markConnection(db,userId,'kleinanzeigen','needs_login','profile_auth_failed').catch(()=>{});
  throw Error('needs_login');
 }
 if(!r.response.ok){
  if(r.response.status===429||r.response.status>=500)throw Error('temporary_network_error');
  throw Error('provider_contract_unverified');
 }
 const p=unwrapPayload(r.json),id=scalar(p?.data?.id??p?.id??r.json?.data?.id??r.json?.id??r.json?.value?.id);
 if(!id)throw Error('provider_contract_unverified');
 return{...s,id:String(id),authMode:'legacy' as const};
}
export async function checkKleinanzeigenConnection(db:any,userId:string){const c=await getConnection(db,userId,'kleinanzeigen');if(!c)return{authenticated:false};try{const a=await account(db,userId);return{authenticated:true,authMode:a.authMode,clientVersion:APP_VERSION}}catch{return{authenticated:false}}}
function formControls(ui:any){const out:any[]=[];const walk=(v:any)=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v)walk(x);return}if(v.type==='Control'&&typeof v.scope==='string')out.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')walk(x)};walk(ui);return out}
function formLabel(ui:any,key:string){const suffix=`/properties/${key}`;return norm(formControls(ui).find((c:any)=>String(c.scope).endsWith(suffix))?.label||key)}
function ownValue(obj:any,key:string){return obj&&Object.prototype.hasOwnProperty.call(obj,key)?obj[key]:undefined}
function booleanValue(raw:any){if(typeof raw==='boolean')return raw;if(raw===1||raw==='1')return true;if(raw===0||raw==='0')return false;const v=norm(raw).toLowerCase();if(['true','yes','ja','on'].includes(v))return true;if(['false','no','nein','off'].includes(v))return false;return undefined}
function enumValue(prop:any,raw:any){const values=Array.isArray(prop?.enum)?prop.enum.map((x:any)=>String(x)):[];if(Array.isArray(raw)){for(const candidate of raw){const hit=enumValue(prop,candidate);if(hit!==undefined)return hit}return undefined}if(!values.length)return raw;const text=norm(raw);if(!text)return values.includes('NOT_SPECIFIED')?'NOT_SPECIFIED':undefined;const direct=values.find((x:string)=>x.toLowerCase()===text.toLowerCase());if(direct)return direct;for(const option of Array.isArray(prop?.oneOf)?prop.oneOf:[]){const c=String(option?.const??''),title=norm(option?.title);if(c&&values.includes(c)&&(c.toLowerCase()===text.toLowerCase()||title.toLowerCase()===text.toLowerCase()))return c}const aliases:Record<string,string[]>= {MALE:['herr','male','männlich','maennlich'],FEMALE:['frau','female','weiblich'],DIVERS:['divers','diverse'],NOT_SPECIFIED:['keine angabe','keine angaben','nicht angegeben','not specified']};for(const value of values){if((aliases[value]||[]).some(x=>x===text.toLowerCase()))return value}return undefined}
function profileHouseholdValue(profile:any,prop:any){const type=String(prop?.type||'');if(['integer','number'].includes(type)&&profile?.household_size!=null)return profile.household_size;return providerEnumCandidates('kleinanzeigen','household',profile)}
function profileIncomeValue(profile:any,prop:any){const type=String(prop?.type||'');if(['integer','number'].includes(type)&&profile?.monthly_net_income!=null)return profile.monthly_net_income;return providerEnumCandidates('kleinanzeigen','income',profile)}
function profileMoveInValue(profile:any,prop:any){const format=String(prop?.format||'').toLowerCase();if(format==='date'&&profile?.move_in_preference==='EXACT_DATE')return profile?.move_in_date??null;return providerEnumCandidates('kleinanzeigen','move_in',profile)}
function semanticValue(key:string,profile:any,message:string,prefill:any,prop:any={}){const k=key.toLowerCase();if(k==='message'||/nachricht/.test(k))return message;if(/currentschufainformation|schufa/.test(k))return profile?.schufa_status??ownValue(prefill,key)??'NOT_SPECIFIED';if(/phone.?call.?desired|callback|rückruf|ruckruf/.test(k))return profile?.phone_call_desired??ownValue(prefill,key)??false;if(/contact.?first.?name|first.?name|vorname/.test(k))return profile?.first_name??null;if(/contact.?last.?name|last.?name|nachname/.test(k))return profile?.last_name??null;if(/contact.?name|profile.?name|display.?name|nickname/.test(k))return ownValue(prefill,key)??prefill?.contactName??null;if(/salutation|anrede/.test(k))return providerEnumCandidates('kleinanzeigen','salutation',profile);if(/phone|telefon/.test(k))return profile?.phone??null;if(/email|mail/.test(k))return profile?.email??null;if(/household|haushalt/.test(k))return profileHouseholdValue(profile,prop);if(/income|einkommen/.test(k))return profileIncomeValue(profile,prop);if(/move.?in|einzug/.test(k))return profileMoveInValue(profile,prop);if(/employment|beruf|job/.test(k))return providerEnumCandidates('kleinanzeigen','employment',profile);if(/pet|haustier/.test(k))return profile?.pets??null;if(/\bwbs\b|wohnungsberechtigung/.test(k))return profile?.wbs_status??null;if(/house.?number|hausnummer/.test(k))return profile?.house_number??null;if(/street|strasse|straße/.test(k))return profile?.street??null;if(/postcode|postal|\bplz\b/.test(k))return profile?.postcode??null;if(/city|stadt/.test(k))return profile?.city??null;return ownValue(prefill,key)}
function normalizeSchemaValue(prop:any,raw:any){const type=String(prop?.type||'');if(type==='boolean')return booleanValue(raw);if(Array.isArray(prop?.enum)&&prop.enum.length)return enumValue(prop,raw);if(Array.isArray(raw))return raw[0];return raw}
function prepareRequiredForm(form:any,profile:any,message:string){const schema=form?.schema??{},required=Array.isArray(schema?.required)?schema.required.map((x:any)=>String(x)):[],prefill=form?.data&&typeof form.data==='object'?form.data:{},payload:any={},missing:any[]=[],unsupported:any[]=[],fields:any[]=[];for(const key of required){const prop=schema?.properties?.[key]??{},label=formLabel(form?.uiSchema,key),type=String(prop?.type||''),raw=semanticValue(key,profile,message,prefill,prop),value=normalizeSchemaValue(prop,raw);fields.push({id:key,label,type,required:true});if(value===undefined){unsupported.push({id:key,label,type});continue}if(value===null||(typeof value==='string'&&norm(value)==='')){missing.push({id:key,label,type});continue}payload[key]=value}return{payload,fields,missing,unsupported}}
async function adLookup(adId:string,xapp:string){return apiRequest(`${API_HOST}/api/ads/${encodeURIComponent(adId)}.json`,{method:'GET',headers:publicApiHeaders(xapp,AD_FIELDS)})}
async function contactForm(acct:any,adId:string){const url=`${GATEWAY_HOST}${XCF_PATH(adId)}`,r=await apiRequest(url,{method:'GET',headers:gatewayHeaders(acct.token,acct.xapp)});if(r.response.status===401||r.response.status===403)throw Error('needs_login');if(!r.response.ok){if(r.response.status===429||r.response.status>=500)throw Error('temporary_network_error');throw Error(`contact_form_${r.response.status}`)}if(!r.json?.schema||!r.json?.uiSchema)throw Error('provider_contract_unverified');return r.json}
async function contactFormWithRetry(acct:any,adId:string){try{return await contactForm(acct,adId)}catch(e:any){if(e?.message==='needs_login'||e?.message==='temporary_network_error')throw e;await wait(750);return contactForm(acct,adId)}}
function dmhSource(listing:any){try{const u=new URL(String(listing?.canonical_url||''));return norm(u.searchParams.get('dmh_source'))||null}catch{return null}}
function wenkseSessionId(){return crypto.randomUUID().replace(/-/g,'')}
function createdConversationId(body:any){for(const v of[body?.conversationId,body?.data?.conversationId,body?.id,body?.data?.id,body?.conversation?.id,body?.data?.conversation?.id]){const id=scalar(v);if(id)return String(id)}return null}
function messageRows(body:any){const rows=body?.messages??body?.data?.messages??[];return Array.isArray(rows)?rows:[]}
function messageText(m:any){return norm(m?.message??m?.text??m?.textShort??m?.body??m?.title??'')}
function isOutbound(m:any){const d=String(m?.boundness??m?.direction??'').toUpperCase();return d.includes('OUT')||d==='SENT'}
async function openConversation(acct:any,cid:string){const r=await apiRequest(`${GATEWAY_HOST}/messagebox/api/users/${encodeURIComponent(acct.id)}/conversations/${encodeURIComponent(cid)}?contentWarnings=true`,{method:'PUT',headers:gatewayHeaders(acct.token,acct.xapp)});return r.response.ok?r.json:null}
async function verifyConversation(acct:any,cid:string,message:string){const wanted=norm(message);for(const delay of[500,900,1600,2600,4200]){await wait(delay);const body=await openConversation(acct,cid);if(messageRows(body).some((m:any)=>isOutbound(m)&&messageText(m)===wanted))return true}return false}
export async function inspectKleinanzeigenInquiry(input:any){
 const{db,user,profile,listing,message}=input||{},userId=String(user?.id||''),adId=String(listing?.external_id||listing?.source_listing_key||'').match(/\d{6,20}/)?.[0]||'';
 if(!userId||!adId||!message)return{ok:false,error:'provider_contract_unverified'};
 let acct=await account(db,userId),ad=await adLookup(adId,acct.xapp);
 if(!ad.response.ok)return{ok:false,error:`ad_lookup_${ad.response.status}`};
 if(adOwnerId(ad.json)&&adOwnerId(ad.json)===acct.id)return{ok:false,error:'self_listing'};
 let form:any;
 try{form=await contactForm(acct,adId)}
 catch(e:any){
  if(e?.message!=='needs_login')throw e;
  acct=await account(db,userId,true);
  form=await contactForm(acct,adId);
 }
 const prepared=prepareRequiredForm(form,profile,message);
 return{ok:!prepared.missing.length&&!prepared.unsupported.length,clientVersion:APP_VERSION,authMode:acct.authMode,action:'XCF',categoryId:categoryId(ad.json),requiredFields:prepared.fields,missing:prepared.missing,unsupported:prepared.unsupported,dynamicConfigDetected:true};
}
export async function sendKleinanzeigenApplication(input:any){
 const{db,user,profile,listing,message,authorize}=input||{},userId=String(user?.id||''),adId=String(listing?.external_id||listing?.source_listing_key||'').match(/\d{6,20}/)?.[0]||'';
 if(!userId||!adId||!message)return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 let acct:any;
 try{acct=await account(db,userId)}catch(e:any){return{success:false,status:'manual_required',error:e?.message==='needs_login'?'needs_login':'provider_contract_unverified'}}
 const ad=await adLookup(adId,acct.xapp);
 if(ad.response.status===404)return{success:false,status:'failed',error:'listing_unavailable'};
 if(!ad.response.ok){if(ad.response.status===429||ad.response.status>=500)throw Error('temporary_network_error');return{success:false,status:'manual_required',error:'provider_contract_unverified'}}
 const owner=adOwnerId(ad.json);if(owner&&owner===acct.id)return{success:false,status:'failed',error:'self_listing'};
 let form:any;
 try{form=await contactFormWithRetry(acct,adId)}
 catch(e:any){
  if(e?.message==='temporary_network_error')throw e;
  if(e?.message==='needs_login'){
   try{acct=await account(db,userId,true);form=await contactFormWithRetry(acct,adId)}
   catch(refreshError:any){return{success:false,status:'manual_required',error:refreshError?.message==='needs_login'?'needs_login':'contact_form_unavailable'}}
  }else return{success:false,status:'manual_required',error:'contact_form_unavailable'};
 }
 const prepared=prepareRequiredForm(form,profile,message);
 if(prepared.unsupported.length)return{success:false,status:'manual_required',error:'required_field_contract_unverified'};
 if(prepared.missing.length)return{success:false,status:'manual_required',error:'required_profile_data_missing'};
 if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'failed',error:'send_not_authorized'};
 const url=new URL(`${GATEWAY_HOST}${XCF_PATH(adId)}`),source=dmhSource(listing);
 if(source)url.searchParams.set('dmh_source',source);
 const submitOnce=(current:any)=>apiRequest(url.href,{method:'POST',headers:{...gatewayHeaders(current.token,current.xapp,true),'X-EBAYK-WENKSE-SESSION-ID':wenkseSessionId()},body:JSON.stringify(prepared.payload)});
 let submit=await submitOnce(acct);
 if(submit.response.status===401||submit.response.status===403){
  try{acct=await account(db,userId,true);submit=await submitOnce(acct)}
  catch{
   await markConnection(db,userId,'kleinanzeigen','needs_login','xcf_refresh_failed').catch(()=>{});
   return{success:false,status:'manual_required',error:'needs_login'};
  }
 }
 if(submit.response.status===401||submit.response.status===403){
  await markConnection(db,userId,'kleinanzeigen','needs_login',`xcf_submit_${submit.response.status}`).catch(()=>{});
  return{success:false,status:'manual_required',error:'needs_login'};
 }
 if(!submit.response.ok)return{success:false,status:'manual_required',error:`xcf_submit_${submit.response.status}`};
 const cid=createdConversationId(submit.json);
 if(!cid)return{success:false,status:'manual_required',error:'xcf_conversation_id_missing'};
 if(await verifyConversation(acct,cid,message))return{success:true,status:'sent'};
 return{success:false,status:'manual_required',error:'xcf_submit_unconfirmed'};
}
