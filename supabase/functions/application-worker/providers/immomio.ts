const IMMOMIO_HOST='tenant.immomio.com';
const APPLY_PATH=/^\/apply\/[0-9a-f-]{36}\/?$/i;

export function immomioApplicationUrl(listing:any){
 const candidates=[listing?.raw?.applicationLink,listing?.raw?.application_link,listing?.raw?.entry?.applicationLink,listing?.raw?.entry?.application_link];
 for(const candidate of candidates){
  if(!candidate)continue;
  try{const url=new URL(String(candidate));if(url.protocol==='https:'&&url.hostname===IMMOMIO_HOST&&APPLY_PATH.test(url.pathname)&&!url.username&&!url.password&&!url.port){url.search='';url.hash='';return url.href;}}catch{}
 }
 return null;
}

export async function probeImmomioApplication(listing:any){
 const url=immomioApplicationUrl(listing);if(!url)return {ready:false,error:'application_link_missing'};
 try{
  const response=await fetch(url,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(15000),headers:{'user-agent':'TraumwohnungHamburg/1.0'}});
  return {ready:response.ok,url,status:response.status,error:response.ok?null:'application_form_unavailable'};
 }catch{return {ready:false,url,error:'application_form_unavailable'};}
}

export async function sendImmomioApplication(_db:any,input:any){
 const url=immomioApplicationUrl(input.listing);
 if(!url)return {success:false,status:'failed',error:'application_link_missing'};
 // Public guest applications are supported, but the private form submission
 // contract must be captured from a controlled test before any source is marked
 // verified. Do not guess CSRF/session fields or risk submitting a real listing.
 return {success:false,status:'manual_required',error:'provider_contract_unverified'};
}
