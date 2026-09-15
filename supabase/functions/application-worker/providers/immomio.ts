const APPLY=/^https:\/\/tenant\.immomio\.com\/apply\/[0-9a-f-]{36}\/?(?:[?#].*)?$/i;
export function immomioApplicationLink(listing:any){
 const candidates=[listing?.raw?.applicationLink,listing?.raw?.application_link,listing?.raw?.applicationUrl,listing?.raw?.application_url];
 for(const value of candidates){const url=String(value||'').trim();if(APPLY.test(url))return url;}
 return null;
}
export async function probeImmomioApplication(listing:any){
 const url=immomioApplicationLink(listing);if(!url)return {available:false,error:'application_link_missing'};
 try{
  const response=await fetch(url,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(20000),headers:{'user-agent':'TraumWohnungHamburg/1.0'}});
  const text=await response.text();
  const available=response.ok&&!/nicht (mehr )?verfügbar|not available|abgelaufen/i.test(text);
  return {available,status:response.status,url:response.url||url};
 }catch{return {available:false,error:'application_probe_failed'};}
}

// Immomio supports public guest applications and production listings already
// contain direct tenant.immomio.com/apply/{uuid} links. The exact POST/CSRF
// contract is intentionally fail-closed until a controlled guest-submit trace
// has been captured; if it cannot be reproduced as HTTP, server-side headless
// Chromium is the fallback without any user interaction.
export async function sendImmomioApplication(){return {success:false,status:'manual_required',error:'provider_contract_unverified'};}
