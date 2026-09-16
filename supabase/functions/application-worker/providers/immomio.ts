const APPLY=/^https:\/\/tenant\.immomio\.com\/apply\/[0-9a-f-]{36}\/?(?:[?#].*)?$/i;
const GQL='https://gql-ps.immomio.com/tenant/graphql';
const HEADERS={'content-type':'application/json','accept':'application/json','origin':'https://tenant.immomio.com','referer':'https://tenant.immomio.com/','user-agent':'TraumWohnungHamburg/1.0'};
const PROPERTY_QUERY=`query property($id: ID!) { property(id: $id) { id rented allowContinueAsGuest smsVerificationRequired wbs captchaSettings { siteKey whitelabelRegistrationProcessActive applicationSubmissionActive appointmentBookingActive } customer { id name customQuestionAllowed } } }`;
const QUESTIONS_QUERY=`query applicationQuestions($id: ID!) { customQuestionsByProperty(id: $id) { customQuestions { key type subType title options commentHint } questions { __typename } } }`;
const ELIGIBILITY_QUERY=`query checkGuestApplication($email: String!, $propertyId: ID!) { checkGuestApplication(email: $email, propertyId: $propertyId) { applicationPossible alreadyRegistered alreadyGuest token } }`;

const clean=(v:any,max=240)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);

export function immomioApplicationLink(listing:any){
 const candidates=[listing?.raw?.applicationLink,listing?.raw?.application_link,listing?.raw?.applicationUrl,listing?.raw?.application_url];
 for(const value of candidates){const url=String(value||'').trim();if(APPLY.test(url))return url;}
 return null;
}
function propertyIdFromListing(listing:any){
 const url=immomioApplicationLink(listing);if(!url)return null;
 try{return new URL(url).pathname.split('/').filter(Boolean).pop()||null}catch{return null}
}
async function gql(query:string,variables:any){
 try{
  const response=await fetch(GQL,{method:'POST',headers:HEADERS,body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(20000)});
  const body=await response.json().catch(()=>null);
  return{response,body};
 }catch(error:any){
  if(error?.name==='TimeoutError'||error?.name==='AbortError')throw Error('temporary_network_error');
  throw Error('temporary_network_error');
 }
}
function profileEmail(profile:any){return clean(profile?.email,320).toLowerCase()}
function profileName(profile:any,key:'first_name'|'last_name'){return clean(profile?.[key],160)}

export async function inspectImmomioApplication(listing:any,profile:any){
 const url=immomioApplicationLink(listing),propertyId=propertyIdFromListing(listing);
 if(!url||!propertyId)return{available:false,ready:false,error:'application_link_missing'};

 const propertyResult=await gql(PROPERTY_QUERY,{id:propertyId});
 if(propertyResult.response.status===429||propertyResult.response.status>=500)throw Error('temporary_network_error');
 if(!propertyResult.response.ok||propertyResult.body?.errors?.length)return{available:false,ready:false,error:'provider_contract_unverified'};
 const property=propertyResult.body?.data?.property;
 if(!property)return{available:false,ready:false,error:'listing_unavailable'};
 if(property.rented===true)return{available:false,ready:false,error:'listing_unavailable'};
 if(property.allowContinueAsGuest!==true)return{available:true,ready:false,error:'guest_application_not_allowed'};
 if(property?.captchaSettings?.applicationSubmissionActive===true)return{available:true,ready:false,error:'captcha_required'};
 if(property.smsVerificationRequired===true)return{available:true,ready:false,error:'sms_verification_required'};

 const email=profileEmail(profile),firstName=profileName(profile,'first_name'),lastName=profileName(profile,'last_name');
 const missing:string[]=[];
 if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))missing.push('email');
 if(!firstName)missing.push('first_name');
 if(!lastName)missing.push('last_name');
 if(missing.length)return{available:true,ready:false,error:'required_profile_data_missing',missing};

 const questionsResult=await gql(QUESTIONS_QUERY,{id:propertyId});
 if(questionsResult.response.status===429||questionsResult.response.status>=500)throw Error('temporary_network_error');
 if(!questionsResult.response.ok||questionsResult.body?.errors?.length)return{available:true,ready:false,error:'question_contract_unverified'};
 const questionData=questionsResult.body?.data?.customQuestionsByProperty||{};
 const customCount=Array.isArray(questionData.customQuestions)?questionData.customQuestions.length:0;
 const hierarchicalCount=Array.isArray(questionData.questions)?questionData.questions.length:0;
 if(customCount||hierarchicalCount)return{available:true,ready:false,error:'dynamic_questions_required',customQuestionCount:customCount,hierarchicalQuestionCount:hierarchicalCount};

 const eligibilityResult=await gql(ELIGIBILITY_QUERY,{email,propertyId});
 if(eligibilityResult.response.status===429||eligibilityResult.response.status>=500)throw Error('temporary_network_error');
 if(!eligibilityResult.response.ok||eligibilityResult.body?.errors?.length)return{available:true,ready:false,error:'eligibility_check_failed'};
 const eligibility=eligibilityResult.body?.data?.checkGuestApplication;
 if(!eligibility)return{available:true,ready:false,error:'eligibility_check_failed'};
 // The returned token is intentionally kept in memory only and never returned or logged.
 if(eligibility.alreadyGuest===true)return{available:true,ready:false,alreadyApplied:true,error:'already_applied'};
 if(eligibility.alreadyRegistered===true)return{available:true,ready:false,error:'registered_account_required'};
 if(eligibility.applicationPossible!==true||!clean(eligibility.token,4096))return{available:true,ready:false,error:'application_not_possible'};

 return{
  available:true,
  ready:true,
  mode:'guest',
  propertyId,
  captchaRequired:false,
  smsVerificationRequired:false,
  dynamicQuestions:false,
  requiredProfileFields:['email','first_name','last_name']
 };
}

export async function probeImmomioApplication(listing:any,profile?:any){
 if(profile)return inspectImmomioApplication(listing,profile);
 const url=immomioApplicationLink(listing);if(!url)return{available:false,error:'application_link_missing'};
 try{
  const response=await fetch(url,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(20000),headers:{'user-agent':'TraumWohnungHamburg/1.0'}});
  const text=await response.text();
  const available=response.ok&&!/nicht (mehr )?verfügbar|not available|abgelaufen/i.test(text);
  return{available,status:response.status,url:response.url||url};
 }catch{return{available:false,error:'application_probe_failed'};}
}

// Submission remains fail-closed until the guest payload and authoritative
// post-submit readback have both been verified on a controlled application.
export async function sendImmomioApplication(){return{success:false,status:'manual_required',error:'provider_contract_unverified'};}
