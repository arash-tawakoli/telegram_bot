import { HH_ZIPS } from "../_shared/hamburg.ts";
// The same handler serves direct worker calls and the compatibility endpoint.
export async function handle(request: Request): Promise<Response> {
  // Cancel every provider request when the caller's deadline expires.
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}) => globalThis.fetch(input, {
    ...init, signal: AbortSignal.any([request.signal, ...(init.signal ? [init.signal] : [])]),
  });
const API='https://apigateway.roomlessrent.com/listing-svc/listing/feature-search';
const PATH='/germany/hamburg';

const UA='Mozilla/5.0 (compatible; TraumwohnungHamburgBot/13.0; +https://traumwohnunghamburg.de)';
function n(v:any){const x=Number(v);return Number.isFinite(x)?x:null}
function first(...xs:any[]){return xs.find(x=>x!==null&&x!==undefined&&x!=='')??null}
function image(x:any){const a=x?.accomodationDetails?.gallery||x?.structure?.structureDetails?.gallery||[];return a?.[0]?.thumbnailUrl||a?.[0]?.url||x?.image||null}
function normalize(x:any){const id=String(x?.id||'');if(!id)return null;const a=x?.address||{},zip=String(a.addressZipCode||'');if(!HH_ZIPS.has(zip)||!/hamburg/i.test(String(a.addressCity||a.cityGoogleLabel||'')))return null;const street=String(a.addressRoute||'').trim(),house=String(a.addressNumber||'').trim();const area=n(first(x?.accomodationDetails?.mq,x?.structure?.structureDetails?.mq));const rawRooms=n(first(x?.accomodationDetails?.numBedrooms,x?.structure?.structureDetails?.numBedrooms));const rooms=Number(x?.type)===1?1:(rawRooms!=null&&rawRooms>=0.5&&rawRooms<=20?rawRooms:null);const warm=n(first(x?.discountedMonthlyPrice,x?.monthlyPrice,x?.price));if(warm==null||area==null)return null;return{id,url:`https://spacest.com/rent-listing/${id}`,title:String(x?.autoName||`Spacest Hamburg ${id}`),streetAddress:street||null,houseNumber:house||null,postalCode:zip,addressLocality:'Hamburg',warmRent:warm,rooms,area,furnished:true,imageUrl:image(x),availableFrom:x?.whenFree||x?.bookableFrom||null,provider:'spacest',created_at:x?.createdAt||null,updated_at:x?.updatedAt||null,status:x?.status??null,listing_type:x?.type??null}}
async function page(pageNumber:number){const filters={listingTypes:[],services:[],fromPrice:0,toPrice:5000,sortField:'PUBLISHED_DATE',sortOrder:'DESC',lang:'en',pageNumber,pageSize:60,radius:20};const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','cache-control':'no-cache','user-agent':UA},body:JSON.stringify({path:PATH,lang:'en',filters}),signal:AbortSignal.timeout(15000)});if(!r.ok&&r.status!==201)throw new Error(`Spacest API HTTP ${r.status}`);const j=await r.json();if(!j?.success||!Array.isArray(j?.data?.listings?.data))throw new Error('Spacest API incomplete response');return j.data.listings}

return await (async req=>{try{if(req.method!=='GET')return new Response('method not allowed',{status:405});const firstPage=await page(0),totalPages=Math.max(1,Math.min(20,Number(firstPage.totalNumberPages||1)));const pages:any[]=[firstPage];for(let p=1;p<totalPages;p+=3){const rs=await Promise.all(Array.from({length:Math.min(3,totalPages-p)},(_,i)=>page(p+i)));pages.push(...rs)}const byId=new Map<string,any>();for(const pg of pages)for(const raw of pg.data||[]){const x=normalize(raw);if(x)byId.set(x.id,x)}const entries=[...byId.values()].sort((a,b)=>Date.parse(b.created_at||'')-Date.parse(a.created_at||''));return Response.json({source_id:13,provider:'spacest',strategy:'public_feature_search',sort:'PUBLISHED_DATE_DESC',pages:totalPages,entries,count:entries.length,complete:true})}catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:500})}})(request);
}
