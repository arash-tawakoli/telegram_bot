import {getConnection,deleteConnection} from '../credentials.ts';
import {providerStaticMissing,providerSalutation,providerHousehold,providerEmployment,providerIncome,providerMoveIn,providerPets} from '../../_shared/application-profile-adapters.ts';

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
  if(!resolved.guid)return{success:false,status:'manual_required',error:resolved.error||'provider_identifier_unresolved',diagnostic:{provider:'immowelt',transport:'estate_guid_lookup',onlineId:ids.onlineId||identifier}};
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
 return{success:false,status:'manual_required',error:explicitFalse?'provider_rejected':'submission_unconfirmed',diagnostic:{provider:'immowelt',transport:'communication_service',httpStatus:response.status,authorized:true,soapResult:explicitFalse?'false':'missing',estateGuidProvided:true,onlineId:ids.onlineId||identifier}};
}
