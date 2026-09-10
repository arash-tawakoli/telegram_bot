import {applicationTarget} from '../telegram-ui/application-message.js';

const manual=error=>({success:false,status:'manual_required',error});
export function submissionPlan(source,profile,fields,documents){
 // Do not infer a surname from a display name. Explicit platform values may already exist.
 const values={message:null,emailAddress:profile.email,phoneNumber:profile.phone,street:profile.street,
  houseNumber:profile.house_number,postcode:profile.postcode,city:profile.city};
 const required=source===1?['firstName','lastName','emailAddress','street','houseNumber','postcode','city']:[];
 if(fields.some(f=>(f.required||required.includes(f.name))&&!f.value&&!values[f.name]))return {error:'required_fields_missing'};
 if(fields.some(f=>f.type==='checkbox'&&f.required&&!f.checked))return {error:'platform_consent_required'};
 if(documents.length)return {error:'attachments_unverified'};
 return {values};
}

async function visibleText(page){return page.evaluate(()=>document.body.innerText);}
async function clickText(page,text){
 const handle=await page.evaluateHandle(label=>Array.from(document.querySelectorAll('button')).find(e=>e.innerText.trim()===label&&!e.disabled&&e.getBoundingClientRect().width>0),text);
 const element=handle.asElement();if(!element){await handle.dispose();return false;}
 try{await element.click();return true;}finally{await handle.dispose();}
}
async function submit(source,{page,user,listing,message,documents,authorize}){
 const target=applicationTarget(listing);
 if(!target||Number(listing.source_id)!==source)return manual('invalid_listing_url');
 await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:25000});
 const body=await visibleText(page);
 if(/Angebot wurde deaktiviert|Angebot ist nicht mehr verfügbar|Anzeige ist nicht mehr verfügbar/i.test(body))return {success:false,status:'failed',error:'listing_removed'};
 if(/captcha|Sicherheitsüberprüfung|verify you are human/i.test(body))return manual('platform_verification');
 const loggedOut=await page.evaluate(()=>Array.from(document.querySelectorAll('a')).some(a=>a.getBoundingClientRect().width>0&&/^(Einloggen|Anmelden)$/.test(a.innerText.trim())));
 if(loggedOut)return manual('session_expired');
 if(!await clickText(page,source===1?'Nachricht':'Nachricht schreiben'))return manual('contact_form_unavailable');
 const selector=source===1?'textarea#message':'textarea#viewad-contact-message';
 try{await page.waitForSelector(selector,{visible:true,timeout:10000});}catch{return manual('contact_form_unavailable');}
 if(new URL(page.url()).hostname!==new URL(target.url).hostname)return manual('external_contact_flow');
 const fields=await page.$eval(selector,textarea=>Array.from(textarea.closest('form')?.querySelectorAll('input,select')||[])
  .filter(e=>e.type!=='hidden'&&e.getBoundingClientRect().width>0)
  .map(e=>({name:e.name,type:e.type,value:e.value,required:e.required,checked:e.checked})));
 const plan=submissionPlan(source,user.applicant_profile||{},fields,documents);
 if(plan.error)return manual(plan.error);
 // This is the first operation that may disclose applicant data to the platform.
 // A crash after this checkpoint must never cause an automatic repeat.
 if(!await authorize())return {success:false,status:'failed',error:'not_eligible'};
 for(const [name,value] of Object.entries(plan.values)){
  if(!value||!fields.some(f=>f.name===name))continue;
  const handle=await page.$(`[name="${name}"]`);
  try{await handle.click({clickCount:3});await handle.type(String(value));}finally{await handle.dispose();}
 }
 const textarea=await page.$(selector);try{await textarea.click({clickCount:3});await textarea.type(message);}finally{await textarea.dispose();}
 const valid=await page.$eval(selector,e=>e.closest('form')?.checkValidity()===true);
 if(!valid)return manual('required_fields_missing');
 if(!await clickText(page,source===1?'Abschicken':'Nachricht senden'))return manual('submission_unconfirmed');
 try{
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).some(e=>
   e instanceof HTMLElement&&e.getBoundingClientRect().width>0&&/^(Deine|Ihre) (Nachricht|Anfrage) wurde (erfolgreich )?(versendet|gesendet)\.?$/.test(e.innerText.trim())),{timeout:10000});
  return {success:true,status:'sent'};
 }catch{return manual('submission_unconfirmed');}
}
export const ImmoScoutAdapter={applyToListing:input=>submit(1,input)};
export const KleinanzeigenAdapter={applyToListing:input=>submit(2,input)};
export const adapters={1:ImmoScoutAdapter,2:KleinanzeigenAdapter};
