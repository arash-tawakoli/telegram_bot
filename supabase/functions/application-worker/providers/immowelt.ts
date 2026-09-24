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

function xml(value:any){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function validPhone(value:any){const s=String(value||'').trim(),digits=s.replace(/\D/g,'');return digits.length>=7&&!/^0+$/.test(digits)?s:''}
function householdLabel(value:any){return({SINGLE:'Einpersonenhaushalt',TWO_ADULTS:'Zweipersonenhaushalt',FAMILY:'Familienhaushalt',SHARED_FLAT:'Wohngemeinschaft'} as any)[String(value||'')]||String(value||'')}
function incomeLabel(value:any){return({UNDER_500:'unter 500 €','500_1000':'500–1.000 €','1000_1500':'1.000–1.500 €','1500_2000':'1.500–2.000 €','2000_3000':'2.000–3.000 €','3000_4000':'3.000–4.000 €','4000_5000':'4.000–5.000 €',OVER_5000:'über 5.000 €'} as any)[String(value||'')]||String(value||'')}
function moveInLabel(profile:any){const pref=String(profile?.move_in_preference||'');if(pref==='IMMEDIATE')return'ab sofort';if(pref==='FLEXIBLE')return'flexibel';if(pref==='EXACT_DATE'&&profile?.move_in_date)return String(profile.move_in_date);return String(profile?.move_in_date||pref||'')}
function requiredImmoweltProfile(profile:any){
 const missing:string[]=[];
 const fields=[['Anrede',profile?.salutation],['Vorname',profile?.first_name],['Nachname',profile?.last_name],['E-Mail-Adresse',profile?.email],['Haushaltstyp',profile?.household_type],['Beschäftigungsstatus',profile?.employment_status],['Haushalts-Nettoeinkommen',profile?.income_range],['Einzugsdatum',moveInLabel(profile)]];
 for(const[name,value]of fields)if(!String(value||'').trim())missing.push(name);
 if(profile?.move_in_preference==='EXACT_DATE'&&!profile?.move_in_date&&!missing.includes('Einzugsdatum'))missing.push('Einzugsdatum');
 return missing;
}
function enrichedMessage(profile:any,message:any){
 const details=[
  'Haushaltstyp: '+householdLabel(profile?.household_type),
  'Beschäftigungsstatus: '+String(profile?.employment_status||''),
  'Haushalts-Nettoeinkommen: '+incomeLabel(profile?.income_range),
  'Gewünschtes Einzugsdatum: '+moveInLabel(profile)
 ].filter(x=>!/:\s*$/.test(x));
 const base=String(message||'').trim();
 return [base,details.length?'Weitere Angaben:\n'+details.join('\n'):''].filter(Boolean).join('\n\n').slice(0,7000);
}

export async function sendImmoweltApplication(input:any){
 const{db,user,profile,listing,message,authorize}=input||{},userId=String(user?.id||''),url=String(listing?.canonical_url||'');
 if(!userId||!/^https:\/\/www\.immowelt\.de\/expose\//i.test(url))return{success:false,status:'manual_required',error:'provider_contract_unverified'};
 const missing=requiredImmoweltProfile(profile);if(missing.length)return{success:false,status:'manual_required',error:'required_profile_data_missing',diagnostic:{provider:'immowelt',missing}};
 let connection:any;try{connection=await getConnection(db,userId,PROVIDER)}catch{return{success:false,status:'manual_required',error:'connection_read_failed'}}
 if(!connection)return{success:false,status:'manual_required',error:'needs_login'};
 const cookies=Array.isArray(connection.credentials?.cookies)?connection.credentials.cookies:[];if(!cookies.length)return{success:false,status:'manual_required',error:'needs_login'};
 const email=String(profile?.email||'').trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return{success:false,status:'manual_required',error:'required_profile_data_missing',diagnostic:{provider:'immowelt',missing:['E-Mail-Adresse']}};
 const name=[String(profile?.first_name||'').trim(),String(profile?.last_name||'').trim()].filter(Boolean).join(' ');
 const phone=validPhone(profile?.phone),street=[String(profile?.street||'').trim(),String(profile?.house_number||'').trim()].filter(Boolean).join(' ');
 const fullMessage=enrichedMessage(profile,message);
 const soap=`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
 <soap:Body>
  <SendContactMail xmlns="http://immowelt.de/services">
   <request>
    <Domain>traumwohnunghamburg.de</Domain>
    <LinkToDetail>${xml(url)}</LinkToDetail>
    <ExposeKey>${xml(listing?.source_listing_key||listing?.external_id||'')}</ExposeKey>
    <OnlyUseLinkToDetail>true</OnlyUseLinkToDetail>
    <OnlyMailToCustomer>false</OnlyMailToCustomer>
    <EstateGuid></EstateGuid>
    <Enquirer>
     <Name>${xml(name)}</Name>
     <EMail>${xml(email)}</EMail>
     <Phone>${xml(phone)}</Phone>
     <Street>${xml(street)}</Street>
     <Zip>${xml(profile?.postcode||'')}</Zip>
     <City>${xml(profile?.city||'')}</City>
     <Mobile></Mobile><Fax></Fax>
    </Enquirer>
    <Message>${xml(fullMessage)}</Message>
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
 if(success)return{success:true,status:'sent',confirmation:'immowelt_communication_service',diagnostic:{provider:'immowelt',transport:'communication_service',httpStatus:response.status,profileFields:['salutation','first_name','last_name','email','street','house_number','postcode','city','household_type','employment_status','income_range','move_in_preference','move_in_date'],phoneIncluded:!!phone}};
 const explicitFalse=/<SendContactMailResult>\s*false\s*<\/SendContactMailResult>/i.test(text);
 return{success:false,status:'manual_required',error:explicitFalse?'provider_rejected':'submission_unconfirmed',diagnostic:{provider:'immowelt',transport:'communication_service',httpStatus:response.status,authorized:true}};
}
