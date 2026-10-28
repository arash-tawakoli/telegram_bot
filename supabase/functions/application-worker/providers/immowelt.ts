import {getConnection,saveConnection,markConnection,deleteConnection,recordRefreshResult} from '../credentials.ts';
import {providerStaticMissing,providerSalutation,providerHousehold,providerEmployment,providerIncome,providerMoveIn,providerPets,providerEnumCandidates} from '../../_shared/application-profile-adapters.ts';

const PROVIDER='immowelt';

export async function checkImmoweltConnection(db:any,userId:string){
 const connection=await getConnection(db,userId,PROVIDER);
 if(!connection)return{authenticated:false,status:'disconnected'};
 const cookies=Array.isArray(connection.credentials?.cookies)?connection.credentials.cookies:[];
 if(!cookies.length)return{authenticated:false,status:'needs_login'};
 const session=await immoweltFallbackSession(db,userId,connection).catch(()=>null);
 if(!session?.ok)return{authenticated:false,status:'needs_login',accountHint:connection.row?.account_hint||null,sessionStoredEncrypted:true};
 return{authenticated:true,status:'connected',accountHint:connection.row?.account_hint||null,sessionStoredEncrypted:true,sessionRefreshed:!!session.refreshed};
}

export async function disconnectImmowelt(db:any,userId:string){
 await deleteConnection(db,userId,PROVIDER);
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER);
 return{status:'disconnected'};
}

function xml(value:any){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function validPhone(value:any){const s=String(value||'').trim(),digits=s.replace(/\D/g,'');return digits.length>=7&&!/^0+$/.test(digits)?s:''}
function requiredImmoweltProfile(profile:any,message?:string){return providerStaticMissing('immowelt',profile,message)}
function enrichedMessage(profile:any,message:any){
 const details=[
  'Anrede: '+String(providerSalutation('immowelt',profile?.salutation)||''),
  'Haushaltstyp: '+String(providerHousehold('immowelt',profile?.household_type)||''),
  'Beschäftigungsstatus: '+String(providerEmployment('immowelt',profile?.employment_status)||''),
  'Haushalts-Nettoeinkommen: '+String(providerIncome('immowelt',profile?.income_range)||''),
  'Haustiere: '+String(providerPets('immowelt',profile?.pets)||''),
  'Gewünschtes Einzugsdatum: '+String(providerMoveIn('immowelt',profile)||'')
 ].filter(x=>!/:\s*$/.test(x));
 const base=String(message||'').trim();
 return [base,details.length?'Weitere Angaben:\n'+details.join('\n'):''].filter(Boolean).join('\n\n').slice(0,7000);
}


async function optionalSecret(db:any,name:string){
 try{const{data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)return null;return String(data)}catch{return null}
}
function decodeXmlEntities(value:string){return String(value||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')}
async function immoweltEstateGuid(db:any,onlineId:any){
 const existing=String(onlineId||'').trim();if(!existing)return{guid:null,error:'provider_identifier_missing'};
 const apiKey=await optionalSecret(db,'immowelt_api_key');if(!apiKey)return{guid:null,error:'provider_credentials_missing'};
 const soap=`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
 <soap:Header>
  <ExposeAuthenticationHeader xmlns="http://immowelt.de/services"><ApiKey>${xml(apiKey)}</ApiKey></ExposeAuthenticationHeader>
 </soap:Header>
 <soap:Body>
  <GetEstateExposeByOnlineID xmlns="http://immowelt.de/services"><OnlineID>${xml(existing)}</OnlineID></GetEstateExposeByOnlineID>
 </soap:Body>
</soap:Envelope>`;
 let response:Response,text='';
 try{
  response=await fetch('https://api.immowelt.de/WebServices/EstateExpose.asmx',{method:'POST',headers:{'content-type':'text/xml; charset=utf-8','soapaction':'"http://immowelt.de/services/GetEstateExposeByOnlineID"','accept':'text/xml,application/xml'},body:soap,signal:AbortSignal.timeout(30000)});
  text=await response.text().catch(()=>'');
 }catch{return{guid:null,error:'temporary_network_error'}}
 if(!response.ok)return{guid:null,error:response.status===401||response.status===403?'provider_credentials_invalid':'provider_contract_unverified'};
 if(/UnauthorizedAccessException|authentication|Authentifizierung|keine Zugriffsrechte/i.test(text))return{guid:null,error:'provider_credentials_invalid'};
 const status=(text.match(/<Status>\s*([^<]+)\s*<\/Status>/i)||[])[1]||'';
 if(status&&status.toUpperCase()!=='OK')return{guid:null,error:'listing_unavailable'};
 const escaped=(text.match(/<XmlExpose>([\s\S]*?)<\/XmlExpose>/i)||[])[1]||'';
 const exposed=decodeXmlEntities(escaped);
 const guid=(exposed.match(/<estate\b[^>]*\bguid=["']([0-9A-Fa-f-]{32,36})["']/i)||[])[1]||'';
 if(!guid)return{guid:null,error:'provider_identifier_unresolved'};
 return{guid,error:null};
}
function immoweltExposeIdentifiers(url:string,fallback:string){
 try{
  const raw=new URL(url).pathname.match(/\/expose\/([^/?#]+)/i)?.[1]||String(fallback||'').trim();
  const value=decodeURIComponent(raw),compact=value.replace(/[{}-]/g,'').toUpperCase();
  return{estateGuid:/^[0-9A-F]{32}$/.test(compact)?compact:null,onlineId:value||String(fallback||'').trim()};
 }catch{return{estateGuid:null,onlineId:String(fallback||'').trim()}}
}

function activeImmoweltCookies(cookies:any[]){
 const now=Date.now()/1000;
 return (Array.isArray(cookies)?cookies:[]).filter((c:any)=>c&&c.name&&c.value&&(Number(c.expires||-1)<0||Number(c.expires||-1)>now));
}
function immoweltCookieMatches(c:any,urlValue:string){
 let url:URL;try{url=new URL(urlValue)}catch{return false}
 const host=url.hostname.toLowerCase(),rawDomain=String(c?.domain||'').trim().toLowerCase(),domain=rawDomain.replace(/^\./,'');
 if(!domain)return false;
 const hostOnly=c?.hostOnly===true||(c?.hostOnly==null&&!rawDomain.startsWith('.'));
 const domainOk=hostOnly?host===domain:(host===domain||host.endsWith('.'+domain));
 if(!domainOk)return false;
 if(c?.secure===true&&url.protocol!=='https:')return false;
 const path=String(c?.path||'/');
 return url.pathname.startsWith(path);
}
function immoweltCookiesForUrl(cookies:any[],urlValue:string){
 return activeImmoweltCookies(cookies).filter((c:any)=>immoweltCookieMatches(c,urlValue)).sort((a:any,b:any)=>String(b?.path||'/').length-String(a?.path||'/').length);
}
function immoweltCookieValue(cookies:any[],name:string,urlValue='https://www.immowelt.de/'){
 const rows=immoweltCookiesForUrl(cookies,urlValue).filter((c:any)=>String(c.name)===name);
 return rows.length?String(rows[0].value||''):'';
}
function immoweltCookieHeader(cookies:any[],urlValue:string){
 return immoweltCookiesForUrl(cookies,urlValue).map((c:any)=>String(c.name)+'='+String(c.value)).join('; ');
}
function immoweltTokenExpiry(cookies:any[]){
 const raw=Number(immoweltCookieValue(cookies,'oauth.access.expiration','https://www.immowelt.de/'));
 return Number.isFinite(raw)&&raw>0?new Date(raw*1000).toISOString():null;
}
function mergeImmoweltSetCookies(cookies:any[],headers:Headers,requestUrl:string){
 const out=(Array.isArray(cookies)?cookies:[]).map((c:any)=>({...c}));
 let request:URL;try{request=new URL(requestUrl)}catch{return out}
 let lines:string[]=[];
 try{lines=(headers as any).getSetCookie?.()||[]}catch{}
 if(!lines.length){const single=headers.get('set-cookie');if(single)lines=[single]}
 for(const line of lines){
  const parts=String(line||'').split(';').map(x=>x.trim()).filter(Boolean),first=parts.shift()||'',eq=first.indexOf('=');
  if(eq<=0)continue;
  const name=first.slice(0,eq).trim(),value=first.slice(eq+1);
  let domain=request.hostname.toLowerCase(),path=(()=>{const p=request.pathname||'/';const i=p.lastIndexOf('/');return i<=0?'/':p.slice(0,i+1)})(),expires=-1,maxAge:null|number=null,secure=false,httpOnly=false,sameSite:any=undefined,hostOnly=true;
  for(const p of parts){
   const j=p.indexOf('='),key=(j<0?p:p.slice(0,j)).trim().toLowerCase(),v=j<0?'':p.slice(j+1).trim();
   if(key==='domain'&&v){domain=v.replace(/^\./,'').toLowerCase();hostOnly=false}
   else if(key==='path'&&v)path=v;
   else if(key==='max-age')maxAge=Number(v);
   else if(key==='expires'){const ms=Date.parse(v);if(Number.isFinite(ms))expires=Math.floor(ms/1000)}
   else if(key==='secure')secure=true;
   else if(key==='httponly')httpOnly=true;
   else if(key==='samesite'&&v)sameSite=v;
  }
  if(maxAge!==null&&Number.isFinite(maxAge))expires=maxAge<=0?0:Math.floor(Date.now()/1000+maxAge);
  const same=(row:any)=>String(row?.name||'')===name&&String(row?.domain||'').replace(/^\./,'').toLowerCase()===domain&&String(row?.path||'/')===path;
  for(let i=out.length-1;i>=0;i--)if(same(out[i]))out.splice(i,1);
  if(value&&expires!==0)out.push({name,value,domain:hostOnly?domain:'.'+domain,path,expires,httpOnly,secure,sameSite,hostOnly});
 }
 return out;
}
function immoweltResponseDiagnostic(status:number,text:string){
 let body:any=null;try{body=JSON.parse(String(text||''))}catch{}
 const rawCode=body?.code??body?.error?.code??body?.errorCode??body?.statusCode??null;
 const rawMessage=body?.message??body?.error?.message??body?.error_description??body?.title??'';
 const sanitize=(value:any,max:number)=>String(value??'').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').replace(/\+?\d[\d\s().\/-]{6,}\d/g,'[phone]').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
 const code=sanitize(rawCode,120),message=sanitize(rawMessage,300),summary=(code+' '+message).toLowerCase();
 const classification=/csrf|xsrf/.test(summary)?'csrf_required':/token|auth|unauthor|login|session/.test(summary)?'auth_rejected':/classified|listing|expose|advert|object/.test(summary)?'listing_rejected':status===403?'forbidden':status===401?'auth_rejected':`http_${status}`;
 return{httpStatus:status,classification,code:code||null,message:message||null,responsePresent:!!String(text||'')};
}

function immoweltOptionNorm(value:any){
 return String(value??'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss')
  .replace(/&euro;|€/g,' euro ').replace(/&nbsp;|&#160;/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function decodeImmoweltEmbeddedText(value:any){
 return String(value??'')
  .replace(/&quot;|&#34;|&#x22;/gi,'"').replace(/&#39;|&#x27;|&apos;/gi,"'")
  .replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
  .replace(/\\u0022/gi,'"').replace(/\\u0027/gi,"'").replace(/\\u003c/gi,'<').replace(/\\u003e/gi,'>').replace(/\\u0026/gi,'&');
}
function immoweltOptionPairs(value:any){
 const text=decodeImmoweltEmbeddedText(value),pairs:any[]=[];
 const add=(label:any,optionValue:any,source:string)=>{
  const l=String(label??'').trim(),v=String(optionValue??'').trim();
  if(!l||!v||l.length>180||v.length>120)return;
  const key=immoweltOptionNorm(l);if(!key)return;
  pairs.push({label:l,value:v,key,source});
 };
 const forward=/"(?:label|name|text|title|displayName|displayValue)"\s*:\s*"([^"]{1,180})"[^{}]{0,260}"(?:value|id|key|code)"\s*:\s*(?:"([^"]{1,120})"|([0-9]{1,12}))/gi;
 const reverse=/"(?:value|id|key|code)"\s*:\s*(?:"([^"]{1,120})"|([0-9]{1,12}))[^{}]{0,260}"(?:label|name|text|title|displayName|displayValue)"\s*:\s*"([^"]{1,180})"/gi;
 const option=/<option[^>]*\bvalue=["']([^"']{1,120})["'][^>]*>([^<]{1,180})<\/option>/gi;
 const compact=/"([0-9]{1,3})"\s*:\s*"([^"]{2,180})"/g;
 let m:RegExpExecArray|null;
 while((m=forward.exec(text)))add(m[1],m[2]??m[3],'json-forward');
 while((m=reverse.exec(text)))add(m[3],m[1]??m[2],'json-reverse');
 while((m=option.exec(text)))add(m[2],m[1],'html-option');
 while((m=compact.exec(text)))add(m[2],m[1],'numeric-map');
 const seen=new Set<string>();
 return pairs.filter((row:any)=>{const k=row.key+'\u0000'+row.value;if(seen.has(k))return false;seen.add(k);return true;});
}
function immoweltDynamicOption(pairs:any[],candidates:string[]){
 const wanted=[...new Set((Array.isArray(candidates)?candidates:[]).map(immoweltOptionNorm).filter(Boolean))];
 if(!wanted.length)return null;
 let row=pairs.find((p:any)=>wanted.includes(p.key));
 if(!row)row=pairs.find((p:any)=>wanted.some((w:string)=>w.length>=6&&p.key.length>=6&&(p.key.includes(w)||w.includes(p.key))));
 return row?{value:String(row.value),label:String(row.label),source:String(row.source)}:null;
}
function immoweltLegacyKnownCodes(profile:any){
 const salutation=providerSalutation('immowelt',profile?.salutation);
 const household=providerHousehold('immowelt',profile?.household_type);
 const employment=providerEmployment('immowelt',profile?.employment_status);
 const income=providerIncome('immowelt',profile?.income_range);
 const moveIn=providerMoveIn('immowelt',profile);
 const salutationCode:Record<string,string>={Herr:'mr',Frau:'ms'};
 const householdCode:Record<string,string>={Einpersonenhaushalt:'1','Zwei Erwachsene':'2'};
 const employmentCode:Record<string,string>={'Angestellte(r)':'1','Studierende(r)':'6'};
 const incomeCode:Record<string,string>={
  '< €1.000':'1','1.000 € - 2.000 €':'2','2.000 € - 3.000 €':'3','3.000 € - 4.000 €':'4',
  '4.000 € - 5.000 €':'5','5.000 € - 6.000 €':'6','6.000 € - 7.000 €':'7','> 7.000 €':'8'
 };
 const moveInCode:Record<string,string>={'So bald wie möglich':'1','<1 Monat':'2','<3 Monate':'3','>3 Monate':'4'};
 return{
  salutation:salutationCode[String(salutation||'')]||null,
  householdType:householdCode[String(household||'')]||null,
  workStatus:employmentCode[String(employment||'')]||null,
  netMonthlyIncome:incomeCode[String(income||'')]||null,
  preferredMoveInDate:moveInCode[String(moveIn||'')]||null
 };
}
function immoweltClassifiedIdFromText(value:any,fallback:string){
 const text=decodeImmoweltEmbeddedText(value),counts=new Map<string,number>();
 const patterns=[
  /["'](?:classifiedId|classifiedID|classified_id|classified-id)["']\s*[:=]\s*["']([A-Za-z0-9_-]{4,120})["']/gi,
  /\bclassifiedId=([A-Za-z0-9_-]{4,120})\b/gi
 ];
 for(const re of patterns){let m:RegExpExecArray|null;while((m=re.exec(text))){const id=String(m[1]||'').trim();if(id)counts.set(id,(counts.get(id)||0)+1);}}
 if(fallback&&counts.has(fallback))return{id:fallback,source:'page-matched-listing'};
 const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]);
 if(ranked.length===1)return{id:ranked[0][0],source:'page-unique'};
 if(ranked.length>1&&ranked[0][1]>ranked[1][1])return{id:ranked[0][0],source:'page-dominant'};
 return{id:fallback||null,source:fallback?'listing-fallback':'unresolved'};
}
export function resolveImmoweltDynamicContactContext(html:any,profile:any,fallbackClassifiedId=''){
 const pairs=immoweltOptionPairs(html),legacy=immoweltLegacyKnownCodes(profile);
 const fields=[
  {payload:'salutation',semantic:'salutation'},
  {payload:'householdType',semantic:'household'},
  {payload:'workStatus',semantic:'employment'},
  {payload:'netMonthlyIncome',semantic:'income'},
  {payload:'preferredMoveInDate',semantic:'moveIn'}
 ];
 const values:any={},dynamicOptionsDetected:string[]=[],legacyFallbackFields:string[]=[],unmappedOptionalFields:string[]=[];
 for(const field of fields){
  const candidates=providerEnumCandidates('immowelt',field.semantic,profile);
  const dynamic=immoweltDynamicOption(pairs,candidates);
  if(dynamic){values[field.payload]=dynamic.value;dynamicOptionsDetected.push(field.payload);continue}
  const fallback=(legacy as any)[field.payload];
  if(fallback){values[field.payload]=fallback;legacyFallbackFields.push(field.payload);continue}
  if(candidates.length)unmappedOptionalFields.push(field.payload);
 }
 const classified=immoweltClassifiedIdFromText(html,String(fallbackClassifiedId||''));
 return{
  values,
  classifiedId:classified.id,
  classifiedIdSource:classified.source,
  dynamicOptionsDetected,
  legacyFallbackFields,
  unmappedOptionalFields,
  optionPairCount:pairs.length
 };
}
async function immoweltContactContext(session:any,listing:any,profile:any){
 const fallbackId=String(listing?.source_listing_key||listing?.external_id||'').trim(),url=String(listing?.canonical_url||'');
 if(!/^https:\/\/www\.immowelt\.de\/expose\//i.test(url))return{...resolveImmoweltDynamicContactContext('',profile,fallbackId),httpStatus:null,pageFetched:false};
 let response:Response,text='';
 try{
  response=await fetch(url,{
   method:'GET',
   headers:{
    accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'accept-language':'de-DE,de;q=0.9,en;q=0.8',
    authorization:'Bearer '+String(session?.token||''),
    'user-agent':String(session?.userAgent||'Mozilla/5.0'),
    cookie:immoweltCookieHeader(session?.cookies||[],url)
   },
   redirect:'follow',
   signal:AbortSignal.timeout(20000)
  });
  text=await response.text().catch(()=>'');
 }catch{
  return{...resolveImmoweltDynamicContactContext('',profile,fallbackId),httpStatus:null,pageFetched:false};
 }
 const resolved=resolveImmoweltDynamicContactContext(response.ok?text:'',profile,fallbackId);
 return{...resolved,httpStatus:response.status,pageFetched:response.ok,finalHost:(()=>{try{return new URL(response.url).hostname}catch{return null}})()};
}

async function immoweltFallbackSession(db:any,userId:string,connection:any,force=false){
 let cookies=Array.isArray(connection?.credentials?.cookies)?connection.credentials.cookies:[];
 const userAgent=String(connection?.credentials?.userAgent||'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36');
 let token=immoweltCookieValue(cookies,'oauth.access.token','https://www.immowelt.de/');
 const expiration=Number(immoweltCookieValue(cookies,'oauth.access.expiration','https://www.immowelt.de/'));
 const fresh=!!token&&(!Number.isFinite(expiration)||expiration>Date.now()/1000+60);
 if(fresh&&!force)return{ok:true,token,cookies,userAgent,refreshed:false,httpStatus:null};
 let response:Response|null=null,url='https://signin.immowelt.de/refresh';
 try{
  for(let hop=0;hop<8;hop++){
   response=await fetch(url,{
    method:'GET',
    headers:{
     accept:'*/*',origin:'https://www.immowelt.de',referer:'https://www.immowelt.de/',
     'user-agent':userAgent,'cookie':immoweltCookieHeader(cookies,url)
    },
    redirect:'manual',
    signal:AbortSignal.timeout(20000)
   });
   cookies=mergeImmoweltSetCookies(cookies,response.headers,url);
   if(response.status<300||response.status>=400)break;
   const location=response.headers.get('location');
   if(!location){
    await recordRefreshResult(db,userId,PROVIDER,false,`refresh_redirect_${response.status}`).catch(()=>{});
    return{ok:false,error:'session_refresh_failed',cookies,userAgent,refreshed:false,httpStatus:response.status};
   }
   url=new URL(location,url).href;
  }
 }catch{
  await recordRefreshResult(db,userId,PROVIDER,false,'refresh_network_error').catch(()=>{});
  return{ok:false,error:'session_refresh_failed',cookies,userAgent,refreshed:false,httpStatus:null};
 }
 if(!response||!response.ok){
  await recordRefreshResult(db,userId,PROVIDER,false,`refresh_http_${response?.status||0}`).catch(()=>{});
  return{ok:false,error:'session_refresh_failed',cookies,userAgent,refreshed:false,httpStatus:response?.status||null};
 }
 token=immoweltCookieValue(cookies,'oauth.access.token','https://www.immowelt.de/');
 const expiresAt=immoweltTokenExpiry(cookies);
 if(token){
  try{await saveConnection(db,userId,PROVIDER,{cookies,userAgent},{account_hint:connection?.row?.account_hint||null,...(expiresAt?{expires_at:expiresAt}:{})})}catch{}
  await recordRefreshResult(db,userId,PROVIDER,true,null,expiresAt).catch(()=>{});
 }else{
  await recordRefreshResult(db,userId,PROVIDER,false,'session_token_missing').catch(()=>{});
 }
 return token?{ok:true,token,cookies,userAgent,refreshed:true,httpStatus:response.status}:{ok:false,error:'session_token_missing',cookies,userAgent,refreshed:true,httpStatus:response.status};
}
async function sendImmoweltSessionFallback(input:any){
 const{db,userId,connection,profile,listing,fullMessage,authorize,authorized=false}=input||{};
 let session=await immoweltFallbackSession(db,String(userId||''),connection);
 if(!session.ok)return{success:false,error:session.error||'session_fallback_unavailable',diagnostic:{transport:'contact_request_service_session_fallback',sessionRefreshed:!!session.refreshed,refreshHttpStatus:session.httpStatus||null}};
 const context=await immoweltContactContext(session,listing,profile);
 const classifiedId=String(context.classifiedId||listing?.source_listing_key||listing?.external_id||'').trim();
 if(!classifiedId)return{success:false,error:'provider_identifier_missing',diagnostic:{transport:'contact_request_service_session_fallback',contactContextFetched:!!context.pageFetched}};
 const payload:any={
  firstName:String(profile?.first_name||'').trim(),
  lastName:String(profile?.last_name||'').trim(),
  email:String(profile?.email||'').trim(),
  phoneNumber:validPhone(profile?.phone),
  message:String(fullMessage||'').trim(),
  isOwner:false,
  newsletterOptout:false,
  newsletterOptInPreference:'email-sms',
  fullName:'',
  language:'de',
  classifiedId,
  brand:'immowelt',
  platform:'Website'
 };
 const values=context.values||{};
 if(values.salutation)payload.salutation=values.salutation;
 if(values.householdType){payload.householdType=values.householdType;payload.houseHoldType=values.householdType;}
 if(values.workStatus)payload.workStatus=values.workStatus;
 if(values.netMonthlyIncome){payload.netMonthlyIncome=values.netMonthlyIncome;payload.totalNetIncomeBeforeTaxRange=values.netMonthlyIncome;}
 if(values.preferredMoveInDate)payload.preferredMoveInDate=values.preferredMoveInDate;
 const endpoint='https://www.immowelt.de/contact-request-service/contacting';
 const submit=async(current:any)=>{
  let response:Response,text='';
  try{
   response=await fetch(endpoint,{
    method:'POST',
    headers:{
     accept:'application/json',
     'content-type':'text/plain;charset=UTF-8',
     origin:'https://www.immowelt.de',
     referer:String(listing?.canonical_url||'https://www.immowelt.de/'),
     authorization:'Bearer '+String(current.token),
     'user-agent':String(current.userAgent),
     cookie:immoweltCookieHeader(current.cookies,endpoint)
    },
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(30000)
   });
   text=await response.text().catch(()=>'');
  }catch{return{response:null as any,text:'',networkError:true,diagnostic:null}}
  return{response,text,networkError:false,diagnostic:immoweltResponseDiagnostic(response.status,text)};
 };
 if(!authorized){
  if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'pending',error:'send_not_authorized',diagnostic:{provider:'immowelt',transport:'contact_request_service_session_fallback',authorized:false,...mappingDiagnostic}};
 }
 let attempt=await submit(session),authRetryAttempted=false;
 if(attempt.networkError)return{success:false,error:'session_fallback_network_error',diagnostic:{
  transport:'contact_request_service_session_fallback',sessionRefreshed:!!session.refreshed,
  profileMappingMode:'dynamic-first',dynamicOptionsDetected:context.dynamicOptionsDetected,
  legacyFallbackFields:context.legacyFallbackFields,unmappedOptionalFields:context.unmappedOptionalFields,
  classifiedIdSource:context.classifiedIdSource,contactContextFetched:!!context.pageFetched,contactContextHttpStatus:context.httpStatus
 }};
 if((attempt.response.status===401||attempt.response.status===403)&&!session.refreshed){
  const forcedConnection={...connection,credentials:{...(connection?.credentials||{}),cookies:session.cookies,userAgent:session.userAgent}};
  const refreshed=await immoweltFallbackSession(db,String(userId||''),forcedConnection,true);
  authRetryAttempted=true;
  if(refreshed.ok){
   session=refreshed;
   attempt=await submit(session);
   if(attempt.networkError)return{success:false,error:'session_fallback_network_error',diagnostic:{
    transport:'contact_request_service_session_fallback',sessionRefreshed:true,authRetryAttempted:true,
    profileMappingMode:'dynamic-first',dynamicOptionsDetected:context.dynamicOptionsDetected,
    legacyFallbackFields:context.legacyFallbackFields,unmappedOptionalFields:context.unmappedOptionalFields,
    classifiedIdSource:context.classifiedIdSource,contactContextFetched:!!context.pageFetched,contactContextHttpStatus:context.httpStatus
   }};
  }
 }
 const mappingDiagnostic={
  profileMapped:true,
  profileMappingMode:'dynamic-first',
  dynamicOptionsDetected:context.dynamicOptionsDetected,
  legacyFallbackFields:context.legacyFallbackFields,
  unmappedOptionalFields:context.unmappedOptionalFields,
  optionPairCount:Number(context.optionPairCount||0),
  classifiedIdSource:context.classifiedIdSource,
  contactContextFetched:!!context.pageFetched,
  contactContextHttpStatus:context.httpStatus
 };
 if(attempt.response.status===200||attempt.response.status===201)return{
  success:true,status:'sent',confirmation:'immowelt_contact_request_service',
  diagnostic:{provider:'immowelt',transport:'contact_request_service_session_fallback',httpStatus:attempt.response.status,classifiedId,sessionRefreshed:!!session.refreshed,authRetryAttempted,...mappingDiagnostic}
 };
 if(attempt.response.status===401)await markConnection(db,String(userId||''),PROVIDER,'needs_login','contact_session_unauthorized').catch(()=>{});
 return{
  success:false,
  error:attempt.response.status===401?'session_fallback_auth_rejected':attempt.response.status===403?'session_fallback_forbidden':'session_fallback_rejected',
  diagnostic:{provider:'immowelt',transport:'contact_request_service_session_fallback',classifiedId,sessionRefreshed:!!session.refreshed,authRetryAttempted,...mappingDiagnostic,...(attempt.diagnostic||{httpStatus:attempt.response.status,responsePresent:!!attempt.text})}
 };
}

export async function sendImmoweltApplication(input:any){
 const{db,user,profile,listing,message,authorize}=input||{},userId=String(user?.id||''),url=String(listing?.canonical_url||'');
 if(!userId||!/^https:\/\/www\.immowelt\.de\/expose\//i.test(url))return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 const missing=requiredImmoweltProfile(profile,message);if(missing.length)return{success:false,status:'manual_required',error:'required_profile_data_missing',diagnostic:{provider:'immowelt',missing}};
 let connection:any;try{connection=await getConnection(db,userId,PROVIDER)}catch{return{success:false,status:'manual_required',error:'connection_read_failed'}}
 if(!connection)return{success:false,status:'manual_required',error:'needs_login'};
 const cookies=Array.isArray(connection.credentials?.cookies)?connection.credentials.cookies:[];if(!cookies.length)return{success:false,status:'manual_required',error:'needs_login'};
 const email=String(profile?.email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return{success:false,status:'manual_required',error:'required_profile_data_missing',diagnostic:{provider:'immowelt',missing:['E-Mail-Adresse']}};
 const name=[String(profile?.first_name||'').trim(),String(profile?.last_name||'').trim()].filter(Boolean).join(' ');
 const phone=validPhone(profile?.phone),street=[String(profile?.street||'').trim(),String(profile?.house_number||'').trim()].filter(Boolean).join(' ');
 const fullMessage=enrichedMessage(profile,message);
 const identifier=String(listing?.source_listing_key||listing?.external_id||'').trim(),ids=immoweltExposeIdentifiers(url,identifier);
 let estateGuid=ids.estateGuid;
 if(!estateGuid){
  const resolved=await immoweltEstateGuid(db,ids.onlineId||identifier);
  if(!resolved.guid){
   const resolveError=String(resolved.error||'provider_identifier_unresolved');
   if(['provider_credentials_missing','provider_credentials_invalid','provider_identifier_unresolved'].includes(resolveError)){
    const fallback=await sendImmoweltSessionFallback({db,userId,connection,profile,listing,fullMessage,authorize});
    if(fallback?.success)return fallback;
    if(fallback?.error==='send_not_authorized')return{success:false,status:'pending',error:'send_not_authorized',diagnostic:fallback.diagnostic||{provider:'immowelt',transport:'contact_request_service_session_fallback'}};
    return{success:false,status:'manual_required',error:fallback?.error||resolveError,diagnostic:{provider:'immowelt',transport:'estate_guid_lookup_fallback',onlineId:ids.onlineId||identifier,originalError:resolveError,sessionFallback:fallback?.diagnostic||null}};
   }
   return{success:false,status:'manual_required',error:resolveError,diagnostic:{provider:'immowelt',transport:'estate_guid_lookup',onlineId:ids.onlineId||identifier}};
  }
  estateGuid=String(resolved.guid).replace(/[{}-]/g,'').toUpperCase();
  if(!/^[0-9A-F]{32}$/.test(estateGuid))return{success:false,status:'manual_required',error:'provider_identifier_unresolved',diagnostic:{provider:'immowelt',transport:'estate_guid_lookup',onlineId:ids.onlineId||identifier}};
 }
 const soap=`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
 <soap:Body>
  <SendContactMail xmlns="http://immowelt.de/services">
   <request>
    <LinkToDetail>${xml(url)}</LinkToDetail>
    <EstateGuid>${xml(estateGuid)}</EstateGuid>
    <Enquirer>
     <Name>${xml(name)}</Name>
     <EMail>${xml(email)}</EMail>
     <Phone>${xml(phone)}</Phone>
     <Street>${xml(street)}</Street>
     <Zip>${xml(profile?.postcode||'')}</Zip>
     <City>${xml(profile?.city||'')}</City>
     <Mobile></Mobile>
     <Fax></Fax>
    </Enquirer>
    <Message>${xml(fullMessage)}</Message>
    <Domain>immowelt.de</Domain>
    <SubjectType>Anfrage zur Immobilie</SubjectType>
   </request>
  </SendContactMail>
 </soap:Body>
</soap:Envelope>`;
 const authorized=await authorize();if(!authorized)return{success:false,status:'pending',error:'send_not_authorized'};
 let response:Response,text='';
 try{
  response=await fetch('https://api.immowelt.de/WebServices/CommunicationService.asmx',{method:'POST',headers:{'content-type':'text/xml; charset=utf-8','soapaction':'"http://immowelt.de/services/SendContactMail"','accept':'text/xml,application/xml'},body:soap,signal:AbortSignal.timeout(30000)});
  text=await response.text().catch(()=>'');
 }catch{
  return{success:false,status:'manual_required',error:'submission_unconfirmed',diagnostic:{provider:'immowelt',transport:'communication_service',authorized:true}};
 }
 const success=response.ok&&/<SendContactMailResult>\s*true\s*<\/SendContactMailResult>/i.test(text);
 if(success)return{success:true,status:'sent',confirmation:'immowelt_communication_service',diagnostic:{provider:'immowelt',transport:'communication_service_link_to_detail',httpStatus:response.status,onlineId:identifier,profileFields:['salutation','first_name','last_name','email','street','house_number','postcode','city','household_type','employment_status','income_range','move_in_preference','move_in_date'],phoneIncluded:!!phone,estateGuidProvided:true}};
 const explicitFalse=/<SendContactMailResult>\s*false\s*<\/SendContactMailResult>/i.test(text);
 if(explicitFalse){
  const fallback=await sendImmoweltSessionFallback({db,userId,connection,profile,listing,fullMessage,authorized:true});
  if(fallback?.success)return fallback;
  return{success:false,status:'manual_required',error:'provider_rejected',diagnostic:{provider:'immowelt',transport:'communication_service',httpStatus:response.status,authorized:true,soapResult:'false',estateGuidProvided:true,onlineId:ids.onlineId||identifier,sessionFallback:fallback?.diagnostic||{error:fallback?.error||'session_fallback_unavailable'}}};
 }
 return{success:false,status:'manual_required',error:'submission_unconfirmed',diagnostic:{provider:'immowelt',transport:'communication_service',httpStatus:response.status,authorized:true,soapResult:'missing',estateGuidProvided:true,onlineId:ids.onlineId||identifier}};
}
