import {getConnection,markConnection,saveConnection} from '../credentials.ts';

const DOMAIN='login.kleinanzeigen.de';
const WEB_ORIGIN='https://www.kleinanzeigen.de';
const LEGACY_CLIENT_ID='uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const WEB_UA='Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const MAX_HTML=2_000_000;

const norm=(v:any)=>String(v??'').replace(/\s+/g,' ').trim();
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const decodeHtml=(v:string)=>String(v||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const stripTags=(v:string)=>decodeHtml(String(v||'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const esc=(v:string)=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

async function optionalSecret(db:any,name:string){try{const{data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)return null;return String(data)}catch{return null}}

async function tokenRequest(db:any,clientId:string,payload:Record<string,unknown>){
 const configuredClientId=await optionalSecret(db,'kleinanzeigen_oauth_client_id');
 const clientSecret=configuredClientId===clientId?await optionalSecret(db,'kleinanzeigen_oauth_client_secret'):null;
 const body:any={...payload,client_id:clientId};if(clientSecret)body.client_secret=clientSecret;
 const response=await fetch(`https://${DOMAIN}/oauth/token`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const token=await response.json().catch(()=>null);return{response,token};
}

async function webSession(db:any,userId:string){
 const connection=await getConnection(db,userId,'kleinanzeigen');if(!connection)throw Error('needs_login');
 let credentials=connection.credentials||{};
 if(!credentials.access_token||Date.parse(credentials.expires_at||'')<=Date.now()+60_000){
  if(!credentials.refresh_token)throw Error('needs_login');
  const clientId=String(credentials.oauth_client_id||LEGACY_CLIENT_ID),{response,token}=await tokenRequest(db,clientId,{grant_type:'refresh_token',refresh_token:credentials.refresh_token});
  if(!response.ok||!token?.access_token){await markConnection(db,userId,'kleinanzeigen','needs_login','refresh_failed').catch(()=>{});throw Error('needs_login')}
  credentials={...credentials,access_token:token.access_token,refresh_token:token.refresh_token||credentials.refresh_token,expires_at:new Date(Date.now()+Number(token.expires_in||600)*1000).toISOString(),oauth_client_id:clientId};
  await saveConnection(db,userId,'kleinanzeigen',credentials,{expires_at:credentials.expires_at,account_hint:connection.row.account_hint});
 }
 if(!credentials.access_token||!credentials.refresh_token)throw Error('needs_login');
 return{accessToken:String(credentials.access_token),refreshToken:String(credentials.refresh_token),email:String(connection.row.account_hint||'').trim()};
}

type CookieJar=Map<string,string>;
function initialCookies(session:any):CookieJar{return new Map([['access_token',session.accessToken],['refresh_token',session.refreshToken]])}
function cookieHeader(jar:CookieJar){return[...jar.entries()].map(([k,v])=>`${k}=${v}`).join('; ')}
function collectCookies(response:Response,jar:CookieJar){
 const h:any=response.headers;let values:string[]=[];
 try{if(typeof h.getSetCookie==='function')values=h.getSetCookie()}catch{}
 if(!values.length){const raw=response.headers.get('set-cookie');if(raw)values=[raw]}
 for(const raw of values){for(const chunk of String(raw).split(/,(?=\s*[^;,=\s]+=[^;,]+)/)){const m=chunk.trim().match(/^([^=;\s]+)=([^;]*)/);if(m)jar.set(m[1],m[2])}}
}

async function webRequest(rawUrl:string,jar:CookieJar,init:RequestInit={}){
 const url=new URL(rawUrl,WEB_ORIGIN);if(url.protocol!=='https:'||url.hostname!=='www.kleinanzeigen.de'||url.username||url.password||url.port)throw Error('provider_contract_unverified');
 const headers:any={'User-Agent':WEB_UA,'Accept-Language':'de-DE,de;q=0.9','Cache-Control':'no-cache','Cookie':cookieHeader(jar),...(init.headers||{})};
 let response:Response;
 try{response=await fetch(url.href,{...init,headers,redirect:init.redirect||'manual',signal:AbortSignal.timeout(30000)})}catch(e:any){if(e?.name==='TimeoutError'||e?.name==='AbortError')throw Error('temporary_network_error');throw Error('temporary_network_error')}
 collectCookies(response,jar);const text=(await response.text()).slice(0,MAX_HTML);return{response,text,url};
}

function attr(tag:string,name:string){const m=tag.match(new RegExp(`\\b${esc(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i'));return decodeHtml(m?.[1]??m?.[2]??m?.[3]??'')}
function hasAttr(tag:string,name:string){return new RegExp(`(?:\\s|^)${esc(name)}(?:\\s|=|/?>)`,'i').test(tag)}
function meta(html:string,name:string){for(const m of html.matchAll(/<meta\b[^>]*>/gi)){if(attr(m[0],'name').toLowerCase()===name.toLowerCase())return attr(m[0],'content')}return''}
function sameSiteUrl(value:string,base:string){try{const u=new URL(decodeHtml(value),base);if(u.protocol==='https:'&&u.hostname==='www.kleinanzeigen.de'&&!u.username&&!u.password&&!u.port)return u.href}catch{}return''}
function contactHref(html:string,base:string){for(const m of html.matchAll(/<[^>]+\bdata-href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi)){const value=m[1]||m[2]||'';if(/\/nachrichten\/s-anbieter-kontaktieren\//i.test(value)){const url=sameSiteUrl(value,base);if(url)return url}}return''}
function extractForm(html:string){for(const m of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)){const whole=m[0],open=whole.match(/^<form\b[^>]*>/i)?.[0]||'',id=attr(open,'id');if(id==='viewad-contact-form'||id==='viewad-contact-modal-form')return{whole,open,action:attr(open,'action')}}return null}
function labelFor(form:string,id:string){if(!id)return'';const m=form.match(new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*(?:"${esc(id)}"|'${esc(id)}')[^>]*>([\\s\\S]*?)<\\/label>`,'i'));return m?stripTags(m[1]):''}
function fieldRequired(tag:string,name:string){return name==='message'||hasAttr(tag,'required')||attr(tag,'aria-required').toLowerCase()==='true'||attr(tag,'data-input-required').toLowerCase()==='true'}

type Option={value:string,label:string,selected:boolean};
type Field={name:string,id:string,label:string,type:string,required:boolean,hidden:boolean,value:string,options:Option[],checked:boolean};
function parseFields(form:string){
 const out:Field[]=[];
 for(const m of form.matchAll(/<input\b[^>]*>/gi)){const tag=m[0],name=attr(tag,'name');if(!name||hasAttr(tag,'disabled'))continue;const type=(attr(tag,'type')||'text').toLowerCase(),id=attr(tag,'id'),value=attr(tag,'value');out.push({name,id,label:labelFor(form,id),type,required:fieldRequired(tag,name),hidden:type==='hidden',value,options:[],checked:hasAttr(tag,'checked')})}
 for(const m of form.matchAll(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi)){const whole=m[0],tag=whole.match(/^<textarea\b[^>]*>/i)?.[0]||'',name=attr(tag,'name');if(!name||hasAttr(tag,'disabled'))continue;const id=attr(tag,'id'),inner=whole.replace(/^<textarea\b[^>]*>/i,'').replace(/<\/textarea>$/i,'');out.push({name,id,label:labelFor(form,id),type:'textarea',required:fieldRequired(tag,name),hidden:false,value:decodeHtml(inner),options:[],checked:false})}
 for(const m of form.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)){const whole=m[0],tag=whole.match(/^<select\b[^>]*>/i)?.[0]||'',name=attr(tag,'name');if(!name||hasAttr(tag,'disabled'))continue;const id=attr(tag,'id'),options:Option[]=[];for(const o of whole.matchAll(/<option\b[^>]*>[\s\S]*?<\/option>/gi)){const ot=o[0].match(/^<option\b[^>]*>/i)?.[0]||'',inner=o[0].replace(/^<option\b[^>]*>/i,'').replace(/<\/option>$/i,'');options.push({value:attr(ot,'value'),label:stripTags(inner),selected:hasAttr(ot,'selected')})}const selected=options.find(o=>o.selected)||options[0];out.push({name,id,label:labelFor(form,id),type:'select',required:fieldRequired(tag,name),hidden:false,value:selected?.value||'',options,checked:false})}
 return out;
}

function chooseOption(field:Field,raw:any){const text=norm(raw);if(!text)return null;const lower=text.toLowerCase();let o=field.options.find(x=>x.value.toLowerCase()===lower||x.label.toLowerCase()===lower);if(o)return o.value;const key=`${field.name} ${field.label}`.toLowerCase();if(/salutation|anrede/.test(key)){const map:any={herr:['male','herr'],frau:['female','frau'],divers:['diverse','divers'],'keine angabe':['not_specified','keine angabe']};for(const needle of map[lower]||[]){o=field.options.find(x=>x.value.toLowerCase()===needle||x.label.toLowerCase()===needle);if(o)return o.value}}if(/household|haushalt/.test(key)){const n=Number(raw);if(Number.isFinite(n)){o=field.options.find(x=>x.value===String(n)||new RegExp(`^${n}(?:\\s|$)`).test(x.label)||n===1&&/single|allein/i.test(x.label));if(o)return o.value}}if(/pet|haustier|wbs|wohnungsberechtigung/.test(key)){const yes=/^(ja|yes|true|1)$/i.test(text),no=/^(nein|no|false|0)$/i.test(text);if(yes||no){o=field.options.find(x=>yes?/^(ja|yes|true|1)$/i.test(x.value)||/^ja\b/i.test(x.label):/^(nein|no|false|0)$/i.test(x.value)||/^nein\b/i.test(x.label));if(o)return o.value}}return null}

function mappedValue(field:Field,profile:any,session:any,message:string){
 const key=`${field.name} ${field.id} ${field.label}`.toLowerCase();let raw:any=undefined;
 if(field.name==='message'||/\bnachricht\b/.test(key))raw=message;
 else if(/profile.?name|contact.?name/.test(key))raw=field.value||undefined;
 else if(/contact.?first.?name|first.?name|vorname/.test(key))raw=profile?.first_name;
 else if(/contact.?last.?name|last.?name|nachname/.test(key))raw=profile?.last_name;
 else if(/salutation|anrede/.test(key))raw=profile?.salutation;
 else if(/phone|telefon/.test(key))raw=profile?.phone;
 else if(/email|e-mail|mail/.test(key))raw=profile?.email||session.email;
 else if(/household|haushalt/.test(key))raw=profile?.household_size;
 else if(/income|einkommen/.test(key))raw=profile?.monthly_net_income;
 else if(/move.?in|einzug/.test(key))raw=profile?.move_in_date;
 else if(/employment|beruf|job/.test(key))raw=profile?.employment_status;
 else if(/pet|haustier/.test(key))raw=profile?.pets;
 else if(/\bwbs\b|wohnungsberechtigung/.test(key))raw=profile?.wbs_status;
 else if(/house.?number|hausnummer/.test(key))raw=profile?.house_number;
 else if(/street|strasse|straße/.test(key))raw=[profile?.street,profile?.house_number].filter(Boolean).join(' ');
 else if(/zip.?code|postcode|postal|\bplz\b/.test(key))raw=profile?.postcode;
 else if(/city|stadt/.test(key))raw=profile?.city;
 else if(/address|adresse/.test(key))raw=[profile?.street,profile?.house_number,profile?.postcode,profile?.city].filter(Boolean).join(' ');
 if(raw===undefined||raw===null||norm(raw)==='')return null;
 if(field.type==='select')return chooseOption(field,raw);
 return String(raw);
}

type Prepared={postUrl:string,referer:string,csrfHeader:string,csrfToken:string,params:URLSearchParams,requiredFields:any[],optionalFields:any[],jar:CookieJar};
async function prepareFirstContact(listing:any,profile:any,session:any):Promise<Prepared|{error:string}> {
 const raw=String(listing?.canonical_url||'').trim();let listingUrl:URL;try{listingUrl=new URL(raw)}catch{return{error:'listing_unavailable'}}
 if(listingUrl.protocol!=='https:'||listingUrl.hostname!=='www.kleinanzeigen.de'||listingUrl.username||listingUrl.password||listingUrl.port||!listingUrl.pathname.startsWith('/s-anzeige/'))return{error:'listing_unavailable'};
 const jar=initialCookies(session);let page=await webRequest(listingUrl.href,jar,{method:'GET',headers:{Accept:'text/html,application/xhtml+xml,*/*'}});
 if(page.response.status===403&&/IP-Bereich|vorübergehend gesperrt/i.test(page.text))return{error:'provider_temporarily_blocked'};
 if([301,302,303,307,308].includes(page.response.status)){const loc=sameSiteUrl(page.response.headers.get('location')||'',listingUrl.href);if(!loc)return{error:'provider_contract_unverified'};if(/\/einloggen|\/m-einloggen|\/login/i.test(new URL(loc).pathname))return{error:'needs_login'};page=await webRequest(loc,jar,{method:'GET',headers:{Accept:'text/html,application/xhtml+xml,*/*'}})}
 if(!page.response.ok)return{error:page.response.status>=500?'temporary_network_error':`contact_page_${page.response.status}`};
 let html=page.text,referer=page.url.href,form=extractForm(html);
 if(!form){const href=contactHref(html,page.url.href);if(!href)return{error:'contact_form_unavailable'};let contact=await webRequest(href,jar,{method:'GET',headers:{Accept:'text/html,application/xhtml+xml,*/*',Referer:page.url.href}});if(contact.response.status===403&&/IP-Bereich|vorübergehend gesperrt/i.test(contact.text))return{error:'provider_temporarily_blocked'};if([301,302,303,307,308].includes(contact.response.status)){const loc=sameSiteUrl(contact.response.headers.get('location')||'',href);if(!loc)return{error:'provider_contract_unverified'};if(/\/einloggen|\/m-einloggen|\/login/i.test(new URL(loc).pathname))return{error:'needs_login'};contact=await webRequest(loc,jar,{method:'GET',headers:{Accept:'text/html,application/xhtml+xml,*/*',Referer:page.url.href}})}if(!contact.response.ok)return{error:contact.response.status>=500?'temporary_network_error':`contact_page_${contact.response.status}`};html=contact.text;referer=contact.url.href;form=extractForm(html);if(!form)return{error:'contact_form_unavailable'}}
 const action=sameSiteUrl(form.action||'/s-anbieter-kontaktieren.json',referer);if(!action||new URL(action).pathname!='/s-anbieter-kontaktieren.json')return{error:'contact_action_unsupported'};
 const csrfToken=meta(html,'_csrf')||meta(page.text,'_csrf'),csrfHeader=meta(html,'_csrf_header')||meta(page.text,'_csrf_header')||'X-CSRF-TOKEN';if(!csrfToken||!/^[A-Za-z0-9-]{8,200}$/.test(csrfToken)||!/^[A-Za-z0-9-]{1,80}$/.test(csrfHeader))return{error:'csrf_unavailable'};
 const fields=parseFields(form.whole),params=new URLSearchParams(),requiredFields:any[]=[],optionalFields:any[]=[],unsupported:any[]=[],missing:any[]=[];
 for(const field of fields){
  const summary={name:field.name,label:field.label,type:field.type,required:field.required};(field.required?requiredFields:optionalFields).push(summary);
  if(field.type==='checkbox'||field.type==='radio'){if(field.checked)params.append(field.name,field.value||'on');else if(field.required)missing.push(summary);continue}
  let value=field.name==='message'?'':field.value;
  if(!value&&field.required){const mapped=mappedValue(field,profile,session,'__MESSAGE__');if(mapped===null){if(field.hidden)unsupported.push(summary);else missing.push(summary)}else value=mapped}
  if(field.hidden||value)params.append(field.name,value||'');
 }
 const messageField=fields.find(f=>f.name==='message');if(!messageField)return{error:'required_field_contract_unverified'};
 if(unsupported.length)return{error:'required_field_contract_unverified'};if(missing.length)return{error:'required_profile_data_missing'};
 return{postUrl:action,referer,csrfHeader,csrfToken,params,requiredFields,optionalFields,jar};
}

function explicitFailure(text:string,json:any){const body=norm(text).toLowerCase();if(json&&typeof json==='object'){if(json.success===false||json.ok===false||json.error||json.errors)return true}return /outcomebox-error|ajaxform-fielderror|validation.?error|fehler/.test(body)&&!/ajaxform-success|outcomebox-success/.test(body)}
function explicitSuccess(text:string,json:any){const body=norm(text).toLowerCase();if(json&&typeof json==='object'){if(json.success===true||json.ok===true||String(json.status||'').toLowerCase()==='success')return true}return /ajaxform-success|outcomebox-success|nachricht (?:wurde )?(?:gesendet|verschickt)|erfolgreich/.test(body)}

export async function sendKleinanzeigenFirstContact(input:any){
 const{db,user,profile,listing,message,authorize}=input||{},userId=String(user?.id||'');if(!userId||!message)return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 const session=await webSession(db,userId),prepared=await prepareFirstContact(listing,profile,session);if('error'in prepared){if(prepared.error==='temporary_network_error'||prepared.error==='provider_temporarily_blocked')throw Error(prepared.error);return{success:false,status:'manual_required',error:prepared.error}}
 prepared.params.set('message',message);
 if(typeof authorize!=='function'||await authorize()!==true)return{success:false,status:'failed',error:'send_not_authorized'};
 const headers:any={Accept:'application/json, text/javascript, */*; q=0.01','Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest',Origin:WEB_ORIGIN,Referer:prepared.referer,[prepared.csrfHeader]:prepared.csrfToken};
 const result=await webRequest(prepared.postUrl,prepared.jar,{method:'POST',headers,body:prepared.params.toString()});let json:any=null;try{json=JSON.parse(result.text)}catch{}
 if(result.response.status===401||result.response.status===403){await markConnection(db,userId,'kleinanzeigen','needs_login',`first_contact_${result.response.status}`).catch(()=>{});return{success:false,status:'manual_required',error:'needs_login'}}
 if(!result.response.ok)return{success:false,status:'manual_required',error:`first_contact_${result.response.status}`};
 if(explicitFailure(result.text,json))return{success:false,status:'manual_required',error:'first_contact_rejected'};
 if(explicitSuccess(result.text,json))return{success:true,status:'sent'};
 await wait(1200);
 return{success:false,status:'manual_required',error:'first_contact_accepted_unconfirmed'};
}
