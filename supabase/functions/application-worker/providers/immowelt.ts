import {getConnection,deleteConnection} from '../credentials.ts';

const PROVIDER='immowelt';

export async function checkImmoweltConnection(db:any,userId:string){
 const connection=await getConnection(db,userId,PROVIDER);
 if(!connection)return{authenticated:false,status:'disconnected'};
 const cookies=Array.isArray(connection.credentials?.cookies)?connection.credentials.cookies:[];
 if(!cookies.length)return{authenticated:false,status:'needs_login'};
 return{authenticated:true,status:'connected',accountHint:connection.row?.account_hint||null,sessionStoredEncrypted:true};
}

export async function disconnectImmowelt(db:any,userId:string){
 await deleteConnection(db,userId,PROVIDER);
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER);
 return{status:'disconnected'};
}

export async function sendImmoweltApplication(input:any){
 const{db,user,profile,listing}=input||{},userId=String(user?.id||''),url=String(listing?.canonical_url||'');
 if(!userId||!/^https:\/\/www\.immowelt\.de\/expose\//i.test(url))return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 let connection:any;try{connection=await getConnection(db,userId,PROVIDER)}catch{return{success:false,status:'manual_required',error:'connection_read_failed'}}
 if(!connection)return{success:false,status:'manual_required',error:'needs_login'};
 const{data:secretValue,error:secretError}=await db.rpc('get_bot_secret',{secret_name:'internal_worker_secret'});
 if(secretError||!secretValue)return{success:false,status:'manual_required',error:'configuration_unavailable'};
 let response:Response,data:any=null;
 try{
  response=await fetch('https://login.traumwohnunghamburg.de/internal/immowelt/application-probe',{
   method:'POST',
   headers:{'content-type':'application/json','x-immowelt-transport-secret':String(secretValue)},
   body:JSON.stringify({listingUrl:url,session:connection.credentials,profile}),
   signal:AbortSignal.timeout(55000)
  });
  data=await response.json().catch(()=>null);
 }catch{throw Error('temporary_network_error')}
 if(response.status===401)return{success:false,status:'manual_required',error:'needs_login',diagnostic:{provider:'immowelt',probe:data||null}};
 if(!response.ok)return{success:false,status:'manual_required',error:data?.error||'provider_contract_unverified',diagnostic:{provider:'immowelt',probe:data||null}};
 return{
  success:false,
  status:'manual_required',
  error:'provider_transport_unverified',
  diagnostic:{provider:'immowelt',reason:'contact_contract_probed',probe:data}
 };
}


const UA='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

function cookieHeader(credentials:any,urlValue:string){
 const url=new URL(urlValue),host=url.hostname.toLowerCase(),path=url.pathname||'/';
 const cookies=Array.isArray(credentials?.cookies)?credentials.cookies:[];
 return cookies.filter((row:any)=>{
  const domain=String(row?.domain||'').replace(/^\./,'').toLowerCase();
  const cookiePath=String(row?.path||'/')||'/';
  const domainOk=host===domain||host.endsWith('.'+domain);
  const expires=Number(row?.expires??-1);
  return domainOk&&path.startsWith(cookiePath)&&(expires<0||expires>Date.now()/1000);
 }).map((row:any)=>String(row.name)+'='+String(row.value)).join('; ');
}

function decodeHtml(v:string){return String(v||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function attr(tag:string,name:string){const m=tag.match(new RegExp('\\b'+name+'\\s*=\\s*["\\\']([^"\\\']*)["\\\']','i'));return m?decodeHtml(m[1]):null}
function compactText(v:string,max=240){return String(v||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}

async function listingHtml(connection:any,url:string){
 const headers:any={
  accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language':'de-DE,de;q=0.9,en;q=0.8',
  'user-agent':String(connection?.credentials?.userAgent||UA).slice(0,500)
 };
 const cookie=cookieHeader(connection?.credentials,url);if(cookie)headers.cookie=cookie;
 let response:Response;
 try{response=await fetch(url,{method:'GET',headers,redirect:'follow',signal:AbortSignal.timeout(30000)})}
 catch{throw Error('temporary_network_error')}
 const html=await response.text().catch(()=>'');
 return{response,html,url:response.url||url};
}

function describeContactContract(html:string){
 const lower=html.toLowerCase();
 const labels=[
  ['salutation',/anrede\s*\*/i],
  ['first_name',/vorname\s*\*/i],
  ['last_name',/nachname\s*\*/i],
  ['email',/e-?mail\s*\*/i],
  ['phone',/telefon/i],
  ['street_house_number',/straße\s*\/\s*hausnummer\s*\*/i],
  ['postcode',/plz\s*\*/i],
  ['city',/ort\s*\*/i],
  ['household_type',/haushaltstyp\s*\*/i],
  ['employment_status',/beschäftigungsstatus\s*\*/i],
  ['income_range',/haushalts-nettoeinkommen\s*\*/i],
  ['move_in',/gewünschtes\s+einzugsdatum\s*\*/i],
  ['message',/nachricht/i]
 ];
 const detected=labels.filter(([,re])=>re.test(html)).map(([name])=>name);
 const tags=[...html.matchAll(/<(input|select|textarea|form|button)\b[^>]*>/gi)].slice(0,300).map(m=>{
  const tag=m[0],kind=m[1].toLowerCase();
  return{kind,name:attr(tag,'name'),id:attr(tag,'id'),type:attr(tag,'type'),required:/\srequired(?:\s|>|=)/i.test(tag),action:kind==='form'?attr(tag,'action'):null};
 });
 const forms=[...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].slice(0,20).map(m=>{
  const open=(m[0].match(/^<form\b[^>]*>/i)||[''])[0];
  return{action:attr(open,'action'),method:attr(open,'method'),text:compactText(m[0],500),fieldNames:[...m[0].matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)].map(x=>attr(x[0],'name')).filter(Boolean).slice(0,80)};
 });
 const urls=[...html.matchAll(/https?:\/\/[^"'<>\s]+/gi)].map(m=>m[0]).filter(u=>/lead|contact|inquir|message|aviv|api/i.test(u)).slice(0,60);
 return{
  htmlLength:html.length,
  detectedFields:detected,
  hasContactCopy:/anbieter kontaktieren|kontaktieren|nachricht senden|eine frage zur immobilie/i.test(lower),
  hasHumanCheck:/captcha|verify you are human|ich bin kein roboter|sicherheitsüberprüfung/i.test(lower),
  forms,
  tags:tags.filter(x=>x.name||x.action).slice(0,160),
  candidateUrls:[...new Set(urls)]
 };
}

export async function inspectImmoweltInquiry(input:any){
 const{db,user,listing}=input||{},userId=String(user?.id||''),url=String(listing?.canonical_url||'');
 if(!userId||!/^https:\/\/www\.immowelt\.de\/expose\//i.test(url))return{ok:false,error:'provider_contract_unverified'};
 const connection=await getConnection(db,userId,PROVIDER);
 if(!connection)return{ok:false,error:'needs_login'};
 const page=await listingHtml(connection,url);
 if(page.response.status===401||page.response.status===403)return{ok:false,error:'needs_login',httpStatus:page.response.status};
 if(!page.response.ok)return{ok:false,error:page.response.status===404?'listing_unavailable':'provider_contract_unverified',httpStatus:page.response.status};
 return{ok:true,httpStatus:page.response.status,finalUrl:page.url,...describeContactContract(page.html)};
}
