import {saveConnection,getConnection,markConnection,deleteConnection} from '../credentials.ts';

const PROVIDER='immoscout';
const CLIENT_ID='is24-android-de';
const TOKEN='https://login.immobilienscout24.de/oauth2/aus1227au6oBg6hGH417/v1/token';
const UA='ImmoScout24_1458_34_._';
const OAUTH_UA='okta-oauth2-kotlin/2.0.3 Android/34';
const enc=new TextEncoder();
const clean=(v:any,max=240)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));

export async function importImmoScoutSession(db:any,userId:string,session:any,accountHint:string|null=null){
 const cookieHeader=String(session?.cookie_header||'').trim();
 if(!cookieHeader||cookieHeader.length>16000)throw Error('invalid_session');
 await saveConnection(db,userId,PROVIDER,{cookie_header:cookieHeader},{account_hint:accountHint,last_error:'provider_contract_unverified'});
 return {status:'connected',authenticated:null};
}

async function refresh(db:any,userId:string,connection:any){
 const c=connection?.credentials||{};
 if(c.access_token&&Date.parse(c.expires_at||'')>Date.now()+60000)return c;
 if(!c.refresh_token)throw Error('needs_login');
 const response=await fetch(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json','user-agent':OAUTH_UA},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:String(c.refresh_token),client_id:CLIENT_ID}),signal:AbortSignal.timeout(25000)});
 const token=await response.json().catch(()=>null);
 if(!response.ok||!token?.access_token){await markConnection(db,userId,PROVIDER,'needs_login','refresh_failed').catch(()=>{});throw Error('needs_login');}
 const expiresAt=new Date(Date.now()+Math.max(60,Number(token.expires_in||3600))*1000).toISOString();
 const updated={...c,access_token:String(token.access_token),refresh_token:String(token.refresh_token||c.refresh_token),id_token:token.id_token?String(token.id_token):c.id_token,expires_at:expiresAt};
 await saveConnection(db,userId,PROVIDER,updated,{expires_at:expiresAt,account_hint:connection.row.account_hint,last_verified_at:new Date().toISOString()});
 return updated;
}

async function session(db:any,userId:string){
 const connection=await getConnection(db,userId,PROVIDER);
 if(!connection)throw Error('needs_login');
 if(connection.credentials?.refresh_token||connection.credentials?.access_token)return refresh(db,userId,connection);
 throw Error('provider_contract_unverified');
}

export async function checkImmoScoutConnection(db:any,userId:string){
 const connection=await getConnection(db,userId,PROVIDER);
 if(!connection)return {authenticated:false};
 try{
  if(connection.credentials?.refresh_token||connection.credentials?.access_token){await refresh(db,userId,connection);return {authenticated:true,status:'connected'};}
  if(connection.credentials?.cookie_header)return {authenticated:null,status:'connected_unverified'};
  return {authenticated:false};
 }catch{return {authenticated:false,status:'needs_login'};}
}

export async function disconnectImmoScout(db:any,userId:string){await deleteConnection(db,userId,PROVIDER);return {status:'disconnected'};}

function claims(jwt:any){try{const p=String(jwt||'').split('.')[1];return p?JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'='))):{};}catch{return {};}}
async function sha(value:any){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(typeof value==='string'?value:JSON.stringify(value??null))));return Array.from(d).map(x=>x.toString(16).padStart(2,'0')).join('');}
function exposeId(listing:any){for(const v of[listing?.external_id,listing?.source_listing_key]){const m=String(v||'').match(/\d{6,20}/);if(m)return m[0];}return String(listing?.canonical_url||'').match(/\/expose\/(\d{6,20})/)?.[1]||null;}
function salutation(v:any){const s=clean(v,40).toLowerCase();if(['herr','male','männlich','maennlich'].includes(s))return'MALE';if(['frau','female','weiblich'].includes(s))return'FEMALE';if(['divers','diverse'].includes(s))return'DIVERS';return'NO_SALUTATION';}
function petValue(v:any){const s=clean(v,120);if(!s)return null;const n=s.toLowerCase();if(['nein','no','keine','keine haustiere','keine haustiere.'].includes(n))return'NO';if(['ja','yes'].includes(n))return'YES';return s;}
function phoneValue(v:any){let s=clean(v,120).replace(/[^0-9+]/g,'');if(!s)return null;if(s.startsWith('00'))s=`+${s.slice(2)}`;else if(s.startsWith('0'))s=`+49${s.slice(1)}`;else if(/^49\d+$/.test(s))s=`+${s}`;const digits=s.replace(/\D/g,'');if(!s.startsWith('+')||digits.length<8||digits.length>15)return null;return `+${digits}`;}
function fieldState(v:any){if(v&&typeof v==='object'){if(v.required===true)return'MANDATORY';if(v.required===false)return'OPTIONAL';v=v.state??v.status??v.requirement??v.mode;}return clean(v,40).toUpperCase();}
function empty(v:any){if(v==null)return true;if(typeof v==='string')return !v.trim();if(typeof v==='object'&&!Array.isArray(v))return Object.keys(v).length===0||Object.values(v).some(empty);return false;}
function canonical(v:any){return String(v??'').replace(/ß/g,'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/Field$/i,'').replace(/[^a-z0-9]/gi,'').toLowerCase();}
function payloadName(configKey:string){return configKey.replace(/Field$/i,'').replace(/^[A-Z]/,x=>x.toLowerCase());}
function snake(v:string){return v.replace(/([a-z0-9])([A-Z])/g,'$1_$2').replace(/[^a-zA-Z0-9]+/g,'_').toLowerCase();}
function providerPrefill(raw:any){if(!raw||typeof raw!=='object')return undefined;for(const k of['prefillValue','defaultValue','initialValue'])if(raw[k]!==undefined&&raw[k]!==null&&raw[k]!=='')return raw[k];return undefined;}
function metadataKeys(configKey:string,rawConfig:any){
 const values:any[]=[configKey,payloadName(configKey)];
 if(rawConfig&&typeof rawConfig==='object')for(const k of['name','key','id','label','title','fieldName','payloadName','property','semanticName','apiName']){const v=rawConfig[k];if(typeof v==='string'&&v.trim())values.push(v);}
 return [...new Set(values.map(canonical).filter(Boolean))];
}

export function resolveImmoScoutField(configKey:string,rawConfig:any,profile:any,message:string){
 const payload=payloadName(configKey),address={city:clean(profile?.city,160),street:clean(profile?.street,160),postcode:clean(profile?.postcode,40),houseNumber:clean(profile?.house_number,40)};
 const known:Record<string,()=>any>={
  moveindate:()=>profile?.move_in_date?String(profile.move_in_date):null,desiredmoveindate:()=>profile?.move_in_date?String(profile.move_in_date):null,einzugsdatum:()=>profile?.move_in_date?String(profile.move_in_date):null,gewunschteeinzugsdatum:()=>profile?.move_in_date?String(profile.move_in_date):null,
  petsinhousehold:()=>petValue(profile?.pets),pets:()=>petValue(profile?.pets),pet:()=>petValue(profile?.pets),haustiere:()=>petValue(profile?.pets),haustier:()=>petValue(profile?.pets),
  numberofpersons:()=>profile?.household_size!=null?String(profile.household_size):null,numberofresidents:()=>profile?.household_size!=null?String(profile.household_size):null,householdsize:()=>profile?.household_size!=null?String(profile.household_size):null,residents:()=>profile?.household_size!=null?String(profile.household_size):null,personenanzahl:()=>profile?.household_size!=null?String(profile.household_size):null,anzahlpersonen:()=>profile?.household_size!=null?String(profile.household_size):null,personenimhaushalt:()=>profile?.household_size!=null?String(profile.household_size):null,haushaltsgrosse:()=>profile?.household_size!=null?String(profile.household_size):null,
  employmentrelationship:()=>clean(profile?.employment_status,160)||null,employmentstatus:()=>clean(profile?.employment_status,160)||null,occupation:()=>clean(profile?.employment_status,160)||null,profession:()=>clean(profile?.employment_status,160)||null,beschaftigungsstatus:()=>clean(profile?.employment_status,160)||null,arbeitsverhaltnis:()=>clean(profile?.employment_status,160)||null,berufstatigkeit:()=>clean(profile?.employment_status,160)||null,
  income:()=>profile?.monthly_net_income!=null?String(profile.monthly_net_income):null,incomeamount:()=>profile?.monthly_net_income!=null?String(profile.monthly_net_income):null,monthlyincome:()=>profile?.monthly_net_income!=null?String(profile.monthly_net_income):null,monthlynetincome:()=>profile?.monthly_net_income!=null?String(profile.monthly_net_income):null,netincome:()=>profile?.monthly_net_income!=null?String(profile.monthly_net_income):null,einkommen:()=>profile?.monthly_net_income!=null?String(profile.monthly_net_income):null,nettoeinkommen:()=>profile?.monthly_net_income!=null?String(profile.monthly_net_income):null,monatlichesnettoeinkommen:()=>profile?.monthly_net_income!=null?String(profile.monthly_net_income):null,
  firstname:()=>clean(profile?.first_name,160)||null,contactfirstname:()=>clean(profile?.first_name,160)||null,givenname:()=>clean(profile?.first_name,160)||null,vorname:()=>clean(profile?.first_name,160)||null,
  lastname:()=>clean(profile?.last_name,160)||null,contactlastname:()=>clean(profile?.last_name,160)||null,surname:()=>clean(profile?.last_name,160)||null,familyname:()=>clean(profile?.last_name,160)||null,nachname:()=>clean(profile?.last_name,160)||null,
  phonenumber:()=>phoneValue(profile?.phone),phone:()=>phoneValue(profile?.phone),mobilephone:()=>phoneValue(profile?.phone),mobilenumber:()=>phoneValue(profile?.phone),telephone:()=>phoneValue(profile?.phone),telefonnummer:()=>phoneValue(profile?.phone),telefon:()=>phoneValue(profile?.phone),mobilnummer:()=>phoneValue(profile?.phone),handynummer:()=>phoneValue(profile?.phone),
  emailaddress:()=>clean(profile?.email,320)||null,email:()=>clean(profile?.email,320)||null,emailadresse:()=>clean(profile?.email,320)||null,
  address:()=>address,anschrift:()=>address,adresse:()=>address,street:()=>clean(profile?.street,160)||null,strasse:()=>clean(profile?.street,160)||null,housenumber:()=>clean(profile?.house_number,40)||null,hausnummer:()=>clean(profile?.house_number,40)||null,postcode:()=>clean(profile?.postcode,40)||null,postalcode:()=>clean(profile?.postcode,40)||null,zipcode:()=>clean(profile?.postcode,40)||null,plz:()=>clean(profile?.postcode,40)||null,postleitzahl:()=>clean(profile?.postcode,40)||null,city:()=>clean(profile?.city,160)||null,stadt:()=>clean(profile?.city,160)||null,ort:()=>clean(profile?.city,160)||null,
  applicationpackagecompleted:()=>false,salutation:()=>salutation(profile?.salutation),anrede:()=>salutation(profile?.salutation),message:()=>String(message||'').trim()||null,contactmessage:()=>String(message||'').trim()||null,messagetext:()=>String(message||'').trim()||null,nachricht:()=>String(message||'').trim()||null,bewerbungstext:()=>String(message||'').trim()||null,kontaktnachricht:()=>String(message||'').trim()||null,
  currentschufainformation:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',schufainformation:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',schufastatus:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',schufa:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',schufaauskunft:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',
  phonecalldesired:()=>profile?.phone_call_desired===true,callbackdesired:()=>profile?.phone_call_desired===true,ruckruf:()=>profile?.phone_call_desired===true,ruckrufgewunscht:()=>profile?.phone_call_desired===true,
  wbs:()=>clean(profile?.wbs_status,120)||null,wbsstatus:()=>clean(profile?.wbs_status,120)||null,housingeligibility:()=>clean(profile?.wbs_status,120)||null,wohnberechtigungsschein:()=>clean(profile?.wbs_status,120)||null
 };
 const candidates=metadataKeys(configKey,rawConfig);
 for(const c of candidates)if(known[c])return{payload,value:known[c](),source:'semantic'};
 const directKeys=[payload,snake(payload),configKey,snake(configKey.replace(/Field$/i,''))];
 for(const k of directKeys)if(Object.prototype.hasOwnProperty.call(profile||{},k)&&profile[k]!==undefined)return{payload,value:profile[k],source:'profile'};
 const normalizedProfileKey=Object.keys(profile||{}).find(k=>candidates.includes(canonical(k)));
 if(normalizedProfileKey)return{payload,value:profile[normalizedProfileKey],source:'profile'};
 const prefill=providerPrefill(rawConfig);if(prefill!==undefined)return{payload,value:prefill,source:'provider_prefill'};
 return{payload,value:undefined,source:'unmapped'};
}

export function prepareImmoScoutForm(config:any,profile:any,message:string){
 const form:any={privacyPolicyAccepted:true,profileType:'BASIC',sendProfile:false},missing:string[]=[],mapped:any[]=[];
 const active=Object.entries(config||{}).filter(([,v])=>['MANDATORY','OPTIONAL'].includes(fieldState(v)));
 if(!active.length)return{form,missing:['formFieldConfig'],mapped,configAvailable:false};
 for(const[configKey,rawConfig]of active){const required=fieldState(rawConfig)==='MANDATORY',r=resolveImmoScoutField(configKey,rawConfig,profile,message);mapped.push({configKey,payload:r.payload,required,source:r.source});if(required&&empty(r.value)){missing.push(r.payload);continue;}if(!empty(r.value)||typeof r.value==='boolean')form[r.payload]=r.value;}
 return{form,missing,mapped,configAvailable:true};
}

function freemiumActive(v:any){return v?.freemiumPeriodActive===true||(Number.isFinite(Number(v?.duration))&&Number.isFinite(Date.parse(String(v?.dateStarted||'')))&&Date.parse(String(v.dateStarted))+Number(v.duration)*3600000>Date.now());}
function responseSignals(v:any){const out:any[]=[];const walk=(x:any,path:string,depth:number)=>{if(depth>5||x==null)return;if(Array.isArray(x)){for(let i=0;i<Math.min(x.length,8);i++)walk(x[i],`${path}[${i}]`,depth+1);return;}if(typeof x!=='object')return;for(const[k,y]of Object.entries(x)){const p=path?`${path}.${k}`:k;if(/conversation|message|request|success|status|result|id/i.test(k)&&(y==null||['string','number','boolean'].includes(typeof y)))out.push({path:p,value:y});walk(y,p,depth+1);}};walk(v,'',0);return out.slice(0,60);}
function signalText(signals:any[]){return signals.map(x=>`${x.path}:${String(x.value??'')}`).join(' ').toLowerCase();}
function successSignal(signals:any[]){return signals.some(x=>/success|result|status/i.test(String(x.path))&&(x.value===true||['success','sent','created','accepted','ok'].includes(String(x.value||'').toLowerCase())))||signals.some(x=>/conversation/i.test(String(x.path))&&String(x.value??'').length>0);}
function classify(status:number,signals:any[]){const text=signalText(signals);if(status===412&&(/plus subscription is required|plus_required|plus subscription/.test(text)))return{status:'failed',error:'plus_required'};if(/phone(number)?/.test(text)&&/not a valid phone|invalid phone|valid phone number/.test(text))return{status:'manual_required',error:'invalid_phone_number'};if(/resource_validation|validating input|validation/.test(text))return{status:'manual_required',error:'provider_validation_error'};if(status===401||status===403)return{status:'manual_required',error:'needs_login'};return{status:'manual_required',error:status>=500?'provider_http_5xx':`contact_http_${status||0}`};}

async function detail(token:string,id:string){
 const response=await fetch(`https://api.mobile.immobilienscout24.de/expose/${encodeURIComponent(id)}`,{headers:{accept:'application/json','user-agent':UA,authorization:`Bearer ${token}`},signal:AbortSignal.timeout(25000)});
 const text=await response.text();let body:any=null;try{body=JSON.parse(text);}catch{}
 if(response.status===404||response.status===410)throw Error('listing_unavailable');
 if(response.status===401||response.status===403)throw Error('needs_login');
 if(!response.ok||!body){if(response.status===429||response.status>=500)throw Error('temporary_network_error');throw Error('provider_contract_unverified');}
 const contact=body?.contact??null;
 return{mailButtonState:contact?.mailButtonState??null,formFieldConfig:contact?.contactData?.formFieldConfig??{},freemium:contact?.freemiumSettings??null,contactHash:await sha(contact)};
}

export async function sendImmoScoutApplication(input:any){
 const{db,user,profile,listing,message,authorize}=input||{},userId=String(user?.id||''),id=exposeId(listing);
 if(!userId||!id||!message)return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 let credentials:any,before:any;
 try{credentials=await session(db,userId);before=await detail(String(credentials.access_token),id);}catch(error:any){if(error?.message==='temporary_network_error')throw error;if(error?.message==='listing_unavailable')return{success:false,status:'failed',error:'listing_unavailable'};if(error?.message==='needs_login'){await markConnection(db,userId,PROVIDER,'needs_login','session_invalid').catch(()=>{});return{success:false,status:'manual_required',error:'needs_login'};}return{success:false,status:'manual_required',error:'provider_contract_unverified'};}
 if(before.mailButtonState!=='active')return{success:false,status:'manual_required',error:'contact_unavailable'};
 if(freemiumActive(before.freemium))return{success:false,status:'failed',error:'plus_required'};
 const prepared=prepareImmoScoutForm(before.formFieldConfig,profile,message),ssoId=clean(claims(credentials.id_token)?.ssoId,200);
 if(prepared.missing.length)return{success:false,status:'manual_required',error:`required_profile_data_missing:${prepared.missing.join(',')}`};
 if(!ssoId)return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'failed',error:'send_not_authorized'};
 const payload:any={'expose.contactForm':prepared.form,supportedScreens:['registration','valuation'],requestCount:1,doNotSend:false,entitlements:[],ssoId};
 let response:Response,text='',json:any=null;
 try{response=await fetch(`https://api.mobile.immobilienscout24.de/expose/${encodeURIComponent(id)}/contact?referrer=resultlist`,{method:'POST',headers:{'user-agent':UA,accept:'application/json',authorization:`Bearer ${credentials.access_token}`,'content-type':'application/json; charset=UTF-8'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});text=await response.text();try{json=JSON.parse(text);}catch{}}catch{return{success:false,status:'manual_required',error:'submission_unconfirmed'};}
 const signals=json?responseSignals(json):[];
 if(response.status===404||response.status===410)return{success:false,status:'failed',error:'listing_unavailable'};
 if(!response.ok){const c=classify(response.status,signals);if(c.error==='needs_login')await markConnection(db,userId,PROVIDER,'needs_login','contact_auth_failed').catch(()=>{});return{success:false,...c};}
 for(const ms of[700,1600,3200,5200]){await wait(ms);try{const after=await detail(String(credentials.access_token),id);if((after.contactHash&&after.contactHash!==before.contactHash)||(after.mailButtonState&&after.mailButtonState!=='active'))return{success:true,status:'sent'};}catch(error:any){if(error?.message==='listing_unavailable')return{success:true,status:'sent'};}}
 if(successSignal(signals))return{success:true,status:'sent'};
 return{success:false,status:'manual_required',error:'submission_unconfirmed'};
}