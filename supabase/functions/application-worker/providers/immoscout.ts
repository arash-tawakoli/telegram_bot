import {saveConnection,getConnection,markConnection,deleteConnection,recordRefreshResult,getCentralImmoScoutConnection,saveCentralImmoScoutCredentials,markCentralImmoScoutConnection} from '../credentials.ts';
import {providerSalutation,providerHousehold,providerEmployment,providerIncome,providerMoveIn,providerPets,canonicalSalutation,canonicalHousehold,canonicalEmployment,canonicalIncome,canonicalMoveIn} from '../../_shared/application-profile-adapters.ts';

const PROVIDER='immoscout';
const OPTIONAL_PROFILE_FIELDS=new Set(['firstname','contactfirstname','givenname','vorname','lastname','contactlastname','surname','familyname','nachname','phonenumber','phone','mobilephone','mobilenumber','telephone','telefonnummer','telefon','mobilnummer','handynummer','emailaddress','email','emailadresse','address','anschrift','adresse','street','strasse','housenumber','hausnummer','postcode','postalcode','zipcode','plz','postleitzahl','city','stadt','ort','moveindate','desiredmoveindate','einzugsdatum','gewunschteeinzugsdatum','petsinhousehold','pets','pet','haustiere','haustier','numberofpersons','numberofresidents','householdsize','residents','personenanzahl','anzahlpersonen','personenimhaushalt','haushaltsgrosse','numberofadults','numberofchildren','employmentrelationship','employmentstatus','occupation','profession','beschaftigungsstatus','arbeitsverhaltnis','berufstatigkeit','income','incomeamount','monthlyincome','monthlynetincome','netincome','einkommen','nettoeinkommen','monatlichesnettoeinkommen','salutation','anrede','message','contactmessage','messagetext','nachricht','bewerbungstext','kontaktnachricht']);
const CLIENT_ID='is24-android-de';
const TOKEN='https://login.immobilienscout24.de/oauth2/aus1227au6oBg6hGH417/v1/token';
const USERINFO='https://login.immobilienscout24.de/oauth2/aus1227au6oBg6hGH417/v1/userinfo';
const CENTRAL_ACCOUNT_EMAIL='arash@nexalabs.de';
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
async function refresh(db:any,userId:string,connection:any,force=false){
 const c=connection?.credentials||{};
 if(!force&&c.access_token&&Date.parse(c.expires_at||'')>Date.now()+60000)return c;
 if(!c.refresh_token)throw Error('needs_login');
 let response:Response,token:any=null;
 try{
  response=await fetch(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json','user-agent':OAUTH_UA},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:String(c.refresh_token),client_id:CLIENT_ID}),signal:AbortSignal.timeout(25000)});
  token=await response.json().catch(()=>null);
 }catch(error:any){
  await recordRefreshResult(db,userId,PROVIDER,false,'refresh_network_error').catch(()=>{});
  throw Error('temporary_network_error');
 }
 if(!response.ok||!token?.access_token){
  await recordRefreshResult(db,userId,PROVIDER,false,`refresh_http_${response.status}`).catch(()=>{});
  await markConnection(db,userId,PROVIDER,'needs_login','refresh_failed').catch(()=>{});
  throw Error('needs_login');
 }
 const expiresAt=new Date(Date.now()+Math.max(60,Number(token.expires_in||3600))*1000).toISOString();
 const updated={...c,access_token:String(token.access_token),refresh_token:String(token.refresh_token||c.refresh_token),id_token:token.id_token?String(token.id_token):c.id_token,expires_at:expiresAt};
 await saveConnection(db,userId,PROVIDER,updated,{expires_at:expiresAt,account_hint:connection.row.account_hint,last_verified_at:new Date().toISOString()});
 await recordRefreshResult(db,userId,PROVIDER,true,null,expiresAt).catch(()=>{});
 return updated;
}
async function refreshCentral(db:any,connection:any,force=false){
 const c=connection?.credentials||{};
 if(!force&&c.access_token&&Date.parse(c.expires_at||'')>Date.now()+60000)return{...c,__centralAccount:true};
 if(!c.refresh_token){await markCentralImmoScoutConnection(db,'needs_login','refresh_token_missing').catch(()=>{});throw Error('needs_login')}
 let response:Response,token:any=null;
 try{
  response=await fetch(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json','user-agent':OAUTH_UA},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:String(c.refresh_token),client_id:CLIENT_ID}),signal:AbortSignal.timeout(25000)});
  token=await response.json().catch(()=>null);
 }catch{throw Error('temporary_network_error')}
 if(!response.ok||!token?.access_token){
  await markCentralImmoScoutConnection(db,'needs_login','refresh_failed').catch(()=>{});
  throw Error('needs_login');
 }
 let info: any=null;
 try{
  const verified=await fetch(USERINFO,{headers:{accept:'application/json',authorization:`Bearer ${token.access_token}`,'user-agent':OAUTH_UA},signal:AbortSignal.timeout(20000)});
  info=await verified.json().catch(()=>null);
  if(!verified.ok||String(info?.email||'').trim().toLowerCase()!==CENTRAL_ACCOUNT_EMAIL){
   await markCentralImmoScoutConnection(db,'needs_login','central_account_mismatch').catch(()=>{});
   throw Error('needs_login');
  }
 }catch(error:any){if(error?.message==='needs_login')throw error;throw Error('temporary_network_error')}
 const expiresAt=new Date(Date.now()+Math.max(60,Number(token.expires_in||3600))*1000).toISOString();
 const updated={...c,access_token:String(token.access_token),refresh_token:String(token.refresh_token||c.refresh_token),id_token:token.id_token?String(token.id_token):c.id_token,expires_at:expiresAt,token_type:String(token.token_type||c.token_type||'Bearer'),scope:String(token.scope||c.scope||'openid profile offline_access'),account_hint:CENTRAL_ACCOUNT_EMAIL};
 await saveCentralImmoScoutCredentials(db,updated);
 return{...updated,__centralAccount:true};
}
async function session(db:any,userId:string,force=false){
 const {data:mode,error:modeError}=await db.from('bot_users')
  .select('test_auto_apply_allowed,test_auto_apply_enabled,auto_apply_enabled')
  .eq('id',userId).maybeSingle();
 if(modeError)throw Error('test_mode_read_failed');
 const personalTestMode=mode?.test_auto_apply_allowed===true
  &&mode?.test_auto_apply_enabled===true
  &&mode?.auto_apply_enabled!==true;
 if(personalTestMode){
  const central=await getCentralImmoScoutConnection(db);
  if(central?.row?.status!=='connected'||central.row.enabled!==false||!central.credentials?.refresh_token)throw Error('needs_login');
  return refreshCentral(db,central,force);
 }
 try{
  const central=await getCentralImmoScoutConnection(db);
  if(central?.row?.status==='connected'&&central.row.enabled===true&&central.credentials?.access_token){
   try{return await refreshCentral(db,central,force)}
   catch(error:any){if(error?.message==='temporary_network_error')throw error;if(error?.message!=='needs_login')throw error;}
  }
 }catch(error:any){if(error?.message==='temporary_network_error')throw error;}
 const connection=await getConnection(db,userId,PROVIDER);
 if(!connection)throw Error('needs_login');
 if(connection.credentials?.refresh_token||connection.credentials?.access_token)return refresh(db,userId,connection,force);
 throw Error('provider_contract_unverified');
}
export async function checkImmoScoutConnection(db:any,userId:string){
 const connection=await getConnection(db,userId,PROVIDER);
 if(!connection)return {authenticated:false};
 try{
  if(connection.credentials?.refresh_token||connection.credentials?.access_token){
   await refresh(db,userId,connection);
   return {authenticated:true,status:'connected'};
  }
  if(connection.credentials?.cookie_header)return {authenticated:null,status:'connected_unverified'};
  return {authenticated:false};
 }catch{return {authenticated:false,status:'needs_login'};}
}
export async function disconnectImmoScout(db:any,userId:string){await deleteConnection(db,userId,PROVIDER);return {status:'disconnected'};}
function claims(jwt:any){try{const p=String(jwt||'').split('.')[1];return p?JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'='))):{};}catch{return {};}}
async function sha(value:any){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(typeof value==='string'?value:JSON.stringify(value??null))));return Array.from(d).map(x=>x.toString(16).padStart(2,'0')).join('');}
function exposeId(listing:any){for(const v of[listing?.external_id,listing?.source_listing_key]){const m=String(v||'').match(/\d{6,20}/);if(m)return m[0];}return String(listing?.canonical_url||'').match(/\/expose\/(\d{6,20})/)?.[1]||null;}
function salutation(v:any){return providerSalutation('immoscout',v);}
function petValue(v:any){return providerPets('immoscout',v);}
function moveInValue(profile:any){return providerMoveIn('immoscout',profile);}
function explicitProfileCount(profile:any,keys:string[]){
 for(const key of keys){const value=profile?.[key];if(value!==undefined&&value!==null&&String(value).trim()!==''&&Number.isFinite(Number(value)))return Number(value);}
 return null;
}
function householdCounts(profile:any){
 const explicitAdults=explicitProfileCount(profile,['adults_count','adult_count','number_of_adults','numberOfAdults']);
 const explicitKids=explicitProfileCount(profile,['children_count','child_count','number_of_children','numberOfChildren','kids_count','number_of_kids','numberOfKids']);
 const size=explicitProfileCount(profile,['household_size','household_count','number_of_persons','number_of_residents']);
 const kind=canonicalHousehold(profile?.household_type);
 let adults=explicitAdults,kids=explicitKids;
 if(adults==null){
  if(kind==='SINGLE')adults=1;
  else if(kind==='TWO_ADULTS')adults=2;
  else if(kind==='SHARED_FLAT'&&size!=null)adults=size;
  else if(kind==='FAMILY'&&size!=null&&kids!=null)adults=Math.max(1,size-kids);
 }
 if(kids==null){
  if(kind==='SINGLE'||kind==='TWO_ADULTS'||kind==='SHARED_FLAT')kids=0;
  else if(kind==='FAMILY'&&size!=null&&adults!=null)kids=Math.max(0,size-adults);
 }
 return{adults,kids};
}
function householdValue(profile:any,fieldKey=''){
 const key=canonical(fieldKey),counts=householdCounts(profile);
 if(/numberofadults|adultcount|adults|numberofpersons|numberofresidents|householdsize|residents|personenanzahl|anzahlpersonen|personenimhaushalt|haushaltsgrosse/.test(key))return counts.adults;
 if(/numberofchildren|numberofkids|kidcount|childcount|children|kids/.test(key))return counts.kids;
 return providerHousehold('immoscout',profile?.household_type);
}
function incomeValue(profile:any){const amount=profile?.monthly_net_income;if(amount!==undefined&&amount!==null&&String(amount).trim()!==''&&Number.isFinite(Number(amount)))return Math.round(Number(amount));return null;}
function phoneValue(v:any){let s=clean(v,120).replace(/[^0-9+]/g,'');if(!s)return null;if(s.startsWith('00'))s=`+${s.slice(2)}`;else if(s.startsWith('0'))s=`+49${s.slice(1)}`;else if(/^49\d+$/.test(s))s=`+${s}`;const digits=s.replace(/\D/g,'');if(!s.startsWith('+')||digits.length<8||digits.length>15)return null;return `+${digits}`;}
function fieldState(v:any){if(v&&typeof v==='object'){if(v.required===true)return'MANDATORY';if(v.required===false)return'OPTIONAL';v=v.state??v.status??v.requirement??v.mode;}return clean(v,40).toUpperCase();}
function empty(v:any){if(v==null)return true;if(typeof v==='string')return !v.trim();if(typeof v==='object'&&!Array.isArray(v))return Object.keys(v).length===0||Object.values(v).some(empty);return false;}
function canonical(v:any){return String(v??'').replace(/ß/g,'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/Field$/i,'').replace(/[^a-z0-9]/gi,'').toLowerCase();}
function payloadName(configKey:string){return configKey.replace(/Field$/i,'').replace(/^[A-Z]/,x=>x.toLowerCase());}
function snake(v:string){return v.replace(/([a-z0-9])([A-Z])/g,'$1_$2').replace(/[^a-zA-Z0-9]+/g,'_').toLowerCase();}
function providerPrefill(raw:any){if(!raw||typeof raw!=='object')return undefined;for(const k of['prefillValue','defaultValue','initialValue'])if(raw[k]!==undefined&&raw[k]!==null&&raw[k]!=='')return raw[k];return undefined;}
function immoScoutExplicitOmit(configKey:string,rawConfig:any,profile:any){
 const keys=metadataKeys(configKey,rawConfig);
 if(keys.some((key:string)=>/salutation|anrede/.test(key)))return['DIVERSE','NEUTRAL','NOT_SPECIFIED'].includes(canonicalSalutation(profile?.salutation));
 if(keys.some((key:string)=>/household|haushalt|numberofpersons|personen/.test(key)))return canonicalHousehold(profile?.household_type)==='NOT_SPECIFIED';
 if(keys.some((key:string)=>/employment|beruf|job|occupation/.test(key)))return canonicalEmployment(profile?.employment_status)==='NOT_SPECIFIED';
 if(keys.some((key:string)=>/income|einkommen/.test(key)))return canonicalIncome(profile?.income_range)==='NOT_SPECIFIED';
 if(keys.some((key:string)=>/move.?in|einzug/.test(key)))return canonicalMoveIn(profile?.move_in_preference)==='NOT_SPECIFIED';
 return false;
}
function metadataKeys(configKey:string,rawConfig:any){const values:any[]=[configKey,payloadName(configKey)];if(rawConfig&&typeof rawConfig==='object')for(const k of['name','key','id','label','title','fieldName','payloadName','property','semanticName','apiName']){const v=rawConfig[k];if(typeof v==='string'&&v.trim())values.push(v);}return [...new Set(values.map(canonical).filter(Boolean))];}
export function resolveImmoScoutField(configKey:string,rawConfig:any,profile:any,message:string){
 const semantic=canonical(configKey),payload=/message|nachricht|bewerbungstext/i.test(semantic)?'message':/numberofpersons|numberofresidents|householdsize|residents|personenanzahl|anzahlpersonen|personenimhaushalt|haushaltsgrosse|numberofadults|adultcount|adults/.test(semantic)?'numberOfAdults':/numberofchildren|numberofkids|kidcount|childcount|children|kids/.test(semantic)?'numberOfKids':payloadName(configKey),address={'@xsi.type':'common:Address',street:clean(profile?.street,160),houseNumber:clean(profile?.house_number,40),postcode:clean(profile?.postcode,40),city:clean(profile?.city,160)};
 const known:Record<string,()=>any>={
  moveindate:()=>moveInValue(profile),desiredmoveindate:()=>moveInValue(profile),einzugsdatum:()=>moveInValue(profile),gewunschteeinzugsdatum:()=>moveInValue(profile),
  petsinhousehold:()=>petValue(profile?.pets),pets:()=>petValue(profile?.pets),pet:()=>petValue(profile?.pets),haustiere:()=>petValue(profile?.pets),haustier:()=>petValue(profile?.pets),
  numberofpersons:()=>householdValue(profile,configKey),numberofresidents:()=>householdValue(profile,configKey),householdsize:()=>householdValue(profile,configKey),residents:()=>householdValue(profile,configKey),personenanzahl:()=>householdValue(profile,configKey),anzahlpersonen:()=>householdValue(profile,configKey),personenimhaushalt:()=>householdValue(profile,configKey),haushaltsgrosse:()=>householdValue(profile,configKey),numberofadults:()=>householdValue(profile,configKey),numberofchildren:()=>householdValue(profile,configKey),
  employmentrelationship:()=>providerEmployment('immoscout',profile?.employment_status),employmentstatus:()=>providerEmployment('immoscout',profile?.employment_status),occupation:()=>providerEmployment('immoscout',profile?.employment_status),profession:()=>providerEmployment('immoscout',profile?.employment_status),beschaftigungsstatus:()=>providerEmployment('immoscout',profile?.employment_status),arbeitsverhaltnis:()=>providerEmployment('immoscout',profile?.employment_status),berufstatigkeit:()=>providerEmployment('immoscout',profile?.employment_status),
  income:()=>incomeValue(profile),incomeamount:()=>incomeValue(profile),monthlyincome:()=>incomeValue(profile),monthlynetincome:()=>incomeValue(profile),netincome:()=>incomeValue(profile),einkommen:()=>incomeValue(profile),nettoeinkommen:()=>incomeValue(profile),monatlichesnettoeinkommen:()=>incomeValue(profile),
  firstname:()=>clean(profile?.first_name,160)||null,contactfirstname:()=>clean(profile?.first_name,160)||null,givenname:()=>clean(profile?.first_name,160)||null,vorname:()=>clean(profile?.first_name,160)||null,
  lastname:()=>clean(profile?.last_name,160)||null,contactlastname:()=>clean(profile?.last_name,160)||null,surname:()=>clean(profile?.last_name,160)||null,familyname:()=>clean(profile?.last_name,160)||null,nachname:()=>clean(profile?.last_name,160)||null,
  phonenumber:()=>phoneValue(profile?.phone),phone:()=>phoneValue(profile?.phone),mobilephone:()=>phoneValue(profile?.phone),mobilenumber:()=>phoneValue(profile?.phone),telephone:()=>phoneValue(profile?.phone),telefonnummer:()=>phoneValue(profile?.phone),telefon:()=>phoneValue(profile?.phone),mobilnummer:()=>phoneValue(profile?.phone),handynummer:()=>phoneValue(profile?.phone),
  emailaddress:()=>clean(profile?.email,320)||null,email:()=>clean(profile?.email,320)||null,emailadresse:()=>clean(profile?.email,320)||null,
  address:()=>address,anschrift:()=>address,adresse:()=>address,street:()=>clean(profile?.street,160)||null,strasse:()=>clean(profile?.street,160)||null,housenumber:()=>clean(profile?.house_number,40)||null,hausnummer:()=>clean(profile?.house_number,40)||null,postcode:()=>clean(profile?.postcode,40)||null,postalcode:()=>clean(profile?.postcode,40)||null,zipcode:()=>clean(profile?.postcode,40)||null,plz:()=>clean(profile?.postcode,40)||null,postleitzahl:()=>clean(profile?.postcode,40)||null,city:()=>clean(profile?.city,160)||null,stadt:()=>clean(profile?.city,160)||null,ort:()=>clean(profile?.city,160)||null,
  applicationpackagecompleted:()=>false,sendprofile:()=>false,privacypolicyaccepted:()=>true,salutation:()=>salutation(profile?.salutation),anrede:()=>salutation(profile?.salutation),message:()=>String(message||'').trim()||null,contactmessage:()=>String(message||'').trim()||null,messagetext:()=>String(message||'').trim()||null,nachricht:()=>String(message||'').trim()||null,bewerbungstext:()=>String(message||'').trim()||null,kontaktnachricht:()=>String(message||'').trim()||null,
  currentschufainformation:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',schufainformation:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',schufastatus:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',schufa:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',schufaauskunft:()=>clean(profile?.schufa_status,80)||'NOT_SPECIFIED',
  phonecalldesired:()=>profile?.phone_call_desired===true,callbackdesired:()=>profile?.phone_call_desired===true,ruckruf:()=>profile?.phone_call_desired===true,ruckrufgewunscht:()=>profile?.phone_call_desired===true,
  wbs:()=>clean(profile?.wbs_status,120)||null,wbsstatus:()=>clean(profile?.wbs_status,120)||null,housingeligibility:()=>clean(profile?.wbs_status,120)||null,wohnberechtigungsschein:()=>clean(profile?.wbs_status,120)||null
 };
 const candidates=metadataKeys(configKey,rawConfig);for(const c of candidates)if(known[c])return{payload,value:known[c](),source:'semantic',omit:immoScoutExplicitOmit(configKey,rawConfig,profile)};
 const directKeys=[payload,snake(payload),configKey,snake(configKey.replace(/Field$/i,''))];for(const k of directKeys)if(Object.prototype.hasOwnProperty.call(profile||{},k)&&profile[k]!==undefined)return{payload,value:profile[k],source:'profile'};
 const normalizedProfileKey=Object.keys(profile||{}).find(k=>candidates.includes(canonical(k)));if(normalizedProfileKey)return{payload,value:profile[normalizedProfileKey],source:'profile'};
 const prefill=providerPrefill(rawConfig);if(prefill!==undefined)return{payload,value:prefill,source:'provider_prefill'};return{payload,value:undefined,source:'unmapped'};
}
export function prepareImmoScoutForm(config:any,profile:any,message:string){
 const form:any={'@xmlns':{common:'http://rest.immobilienscout24.de/schema/common/1.0'}},missing:string[]=[],mapped:any[]=[],values=new Map<string,any>();
 const active=Object.entries(config||{}).filter(([k,v])=>String(k).endsWith('Field')&&['MANDATORY','OPTIONAL'].includes(fieldState(v)));
 if(!active.length)return{form,missing:['contactFormConfiguration'],mapped,configAvailable:false};
 for(const[configKey,rawConfig]of active){
  const required=fieldState(rawConfig)==='MANDATORY',name=String(configKey).replace(/Field$/,'');
  if(!required&&name!=='message'&&!OPTIONAL_PROFILE_FIELDS.has(canonical(name)))continue;
  const r=resolveImmoScoutField(configKey,rawConfig,profile,message);
  mapped.push({configKey,payload:r.payload,required,source:r.source,...(r.omit||(!required&&empty(r.value)&&typeof r.value!=='boolean')?{omitted:true}:{})});
  if(r.omit){if(required&&['numberofpersons','numberofresidents'].includes(canonical(name)))missing.push(r.payload);continue;}
  if(required&&empty(r.value)){missing.push(r.payload);continue}
  if(!empty(r.value)||typeof r.value==='boolean')values.set(r.payload,r.value);
 }
 const messageText=String(message||'').trim();if(messageText&&!values.has('message')){values.set('message',messageText);mapped.push({configKey:'messageField',payload:'message',required:false,source:'application-template'});}
 const schemaOrder=[
  'firstname','lastname','phoneNumber','emailAddress','appointmentRequested','message','address','contactMailCustomStyle',
  'moveInDate','petsInHousehold','employmentRelationship','income','salutation',
  'schufaInformationProvided','schufaVerificationCode','sendProfile','profileImageUrl','profileType','privacyPolicyAccepted',
  'company','buyReason','ownCapital','hasPreapproval','lotAvailable','numberOfRequiredWorkingPlaces',
  'plannedInvestment','commercialUsage','applicationPackageCompleted','homeOwner','forCommercialPurposes','commercialPurposes',
  'hasPets','incomeAmount','employmentStatus','rentArrears','insolvencyProcess','smoker','numberOfAdults','numberOfKids',
  'letterOfComfort','entOfApartment','liabilityInsurance','isTenantNetworkListing','onDemandDocuments','requestedDocuments',
  'depositGuaranteeAccepted'
 ];
 for(const key of schemaOrder)if(values.has(key))form[key]=values.get(key);
 for(const [key,value] of values)if(!schemaOrder.includes(key))form[key]=value;
 return{form,missing,mapped,configAvailable:true};
}
async function detail(token:string,id:string){
 const response=await fetch(`https://rest.immobilienscout24.de/restapi/api/search/v1.0/expose/${encodeURIComponent(id)}`,{
  headers:{accept:'application/json',authorization:`Bearer ${token}`,'user-agent':'TraumWohnungHamburg/1.0'},
  signal:AbortSignal.timeout(25000)
 });
 const text=await response.text();let body:any=null;try{body=JSON.parse(text)}catch{}
 if(response.status===404||response.status===410)throw Error('listing_unavailable');
 if(response.status===401||response.status===403)throw Error('needs_login');
 if(!response.ok||!body){if(response.status===429||response.status>=500)throw Error('temporary_network_error');throw Error('provider_contract_unverified')}
 const expose=body?.['expose.expose']??body?.expose??body,
  config=expose?.contactFormConfiguration??{};
 const freemium=config?.freemiumSettings||{},freemiumDuration=Number(freemium?.duration||0),dateStarted=Date.parse(String(freemium?.dateStarted||'')),freemiumActive=freemium?.freemiumPeriodActive===true||String(freemium?.freemiumPeriodActive||'').toLowerCase()==='true'||(freemiumDuration>0&&Number.isFinite(dateStarted)&&dateStarted+freemiumDuration*3600000>Date.now());
 return{
  contactFormType:expose?.['@contactFormType']??null,
  formFieldConfig:config,
  premiumRequired:String(config?.premiumProfileRequired||'false').toLowerCase()==='true',
  freemiumDuration,freemiumActive
 };
}
async function detailWithRefresh(db:any,userId:string,id:string){
 let credentials=await session(db,userId);
 try{return{credentials,before:await detail(String(credentials.access_token),id),refreshed:false}}
 catch(error:any){
  if(error?.message!=='needs_login')throw error;
  credentials=await session(db,userId,true);
  try{return{credentials,before:await detail(String(credentials.access_token),id),refreshed:true}}
  catch(retryError:any){
   if(retryError?.message==='needs_login'){
    if(credentials?.__centralAccount)await markCentralImmoScoutConnection(db,'needs_login','session_invalid').catch(()=>{});
    else await markConnection(db,userId,PROVIDER,'needs_login','session_invalid').catch(()=>{});
   }
   throw retryError;
  }
 }
}
function diagnosticText(v:any,max=800){return clean(v,max).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').replace(/\+?\d[\d\s().\/-]{6,}\d/g,'[phone]');}
function providerDiagnostic(status:number,body:any,text:string){
 const messages=body?.['common.messages'];
 const rawMessage=messages?.[0]?.message?.message??messages?.message?.message??messages?.message??body?.message?.message??body?.message??text;
 const rawCode=messages?.[0]?.message?.messageCode??messages?.[0]?.message?.code??messages?.message?.messageCode??messages?.message?.code??body?.messageCode??body?.code??null;
 const message=diagnosticText(rawMessage,800),code=diagnosticText(rawCode,120);
 return{httpStatus:Number(status||0),code:code||null,message:message||null};
}
function officialError(status:number,body:any,text:string){
 const diagnostic=providerDiagnostic(status,body,text),summary=String(diagnostic.message||'');
 if(/plus subscription|plus erforderlich|plus_required/i.test(summary))return{status:'failed',error:'plus_required',diagnostic};
 if(status===401||status===403)return{status:'manual_required',error:'needs_login',diagnostic};
 if(/schema valid|cvc-complex-type|schema validation|validation/i.test(summary))return{status:'manual_required',error:'provider_validation_error',diagnostic};
 if(status===404||status===410)return{status:'failed',error:'listing_unavailable',diagnostic};
 return{status:'manual_required',error:status>=500?'provider_http_5xx':`contact_http_${status||0}`,diagnostic};
}
export async function inspectImmoScoutInquiry(input:any){
 const{db,user,profile,listing,message}=input||{},userId=String(user?.id||''),id=exposeId(listing);
 if(!db||!userId||!id||!profile)return{ok:false,ready:false,error:'provider_contract_unverified'};
 try{
  const resolved=await detailWithRefresh(db,userId,id),before=resolved.before,
   prepared=prepareImmoScoutForm(before.formFieldConfig,profile,String(message||'')),
   blocked=before.premiumRequired||before.freemiumActive;
  return{
   ok:prepared.missing.length===0,
   ready:prepared.missing.length===0&&!blocked,
   exposeId:id,
   contactFormType:before.contactFormType,
   premiumRequired:before.premiumRequired,
   freemiumDuration:before.freemiumDuration,
   freemiumActive:before.freemiumActive,
   missing:prepared.missing,
   mappedFields:prepared.mapped,
   formKeys:Object.keys(prepared.form),
   transport:'official_rest_contact',
   sessionRefreshed:resolved.refreshed
  };
 }catch(error:any){
  const code=String(error?.message||'provider_contract_unverified');
  return{ok:false,ready:false,error:['needs_login','listing_unavailable','temporary_network_error'].includes(code)?code:'provider_contract_unverified'};
 }
}
export async function sendImmoScoutApplication(input:any){
 const{db,user,profile,listing,message,authorize}=input||{},userId=String(user?.id||''),id=exposeId(listing);
 if(!userId||!id||!message)return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 let credentials:any,before:any,detailRefreshed=false;
 try{
  const resolved=await detailWithRefresh(db,userId,id);
  credentials=resolved.credentials;before=resolved.before;detailRefreshed=resolved.refreshed;
 }catch(error:any){
  if(error?.message==='temporary_network_error')throw error;
  if(error?.message==='listing_unavailable')return{success:false,status:'failed',error:'listing_unavailable'};
  if(error?.message==='needs_login'){
   await markConnection(db,userId,PROVIDER,'needs_login','session_invalid').catch(()=>{});
   return{success:false,status:'manual_required',error:'needs_login'};
  }
  return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 }
 if(before.premiumRequired||before.freemiumActive)return{success:false,status:'failed',error:'plus_required'};
 const prepared=prepareImmoScoutForm(before.formFieldConfig,profile,message);
 if(prepared.missing.length)return{success:false,status:'manual_required',error:`required_profile_data_missing:${prepared.missing.join(',')}`};
 if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'failed',error:'send_not_authorized'};

 const submit=async(token:string)=>{
  let response:Response,text='',body:any=null;
  try{
   response=await fetch(`https://rest.immobilienscout24.de/restapi/api/search/v1.0/expose/${encodeURIComponent(id)}/contact`,{
    method:'POST',
    headers:{accept:'application/json','content-type':'application/json',authorization:`Bearer ${token}`,'user-agent':'TraumWohnungHamburg/1.0'},
    body:JSON.stringify({'expose.contactForm':prepared.form}),
    signal:AbortSignal.timeout(30000)
   });
   text=await response.text();try{body=JSON.parse(text)}catch{}
  }catch{return{response:null as any,text:'',body:null,networkError:true}}
  return{response,text,body,networkError:false};
 };

 let attempt=await submit(String(credentials.access_token)),contactRefreshed=false;
 if(attempt.networkError)return{success:false,status:'manual_required',error:'submission_unconfirmed'};
 let classified=officialError(attempt.response.status,attempt.body,attempt.text);
 if(classified.error==='needs_login'){
  try{
   credentials=await session(db,userId,true);
   contactRefreshed=true;
   attempt=await submit(String(credentials.access_token));
   if(attempt.networkError)return{success:false,status:'manual_required',error:'submission_unconfirmed'};
   classified=officialError(attempt.response.status,attempt.body,attempt.text);
  }catch(error:any){
   if(error?.message==='temporary_network_error')throw error;
   await markConnection(db,userId,PROVIDER,'needs_login','contact_refresh_failed').catch(()=>{});
   return{success:false,status:'manual_required',error:'needs_login'};
  }
 }
 if(attempt.response.ok)return{success:true,status:'sent',error:null,confirmation:'official_rest_2xx',diagnostic:{sessionRefreshed:detailRefreshed||contactRefreshed}};
 if(classified.error==='needs_login')await markConnection(db,userId,PROVIDER,'needs_login','contact_auth_failed').catch(()=>{});
 return{success:false,...classified,diagnostic:{...(classified.diagnostic||{}),sessionRefreshed:detailRefreshed||contactRefreshed}};
}
