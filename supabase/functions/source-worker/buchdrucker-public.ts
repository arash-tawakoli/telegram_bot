import {
  Candidate,
  absolute,
  decode,
  fetchText,
  hhZip,
  parseFields,
  strip,
} from './shared.ts';
import {
  extractBuchdruckerApplicationRefs,
  normalizeBuchdruckerApply,
} from './buchdrucker-refs.mjs';

function xmlValue(block:string,tag:string){
  const safe=tag.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
  const raw=block.match(new RegExp('<'+safe+'\\b[^>]*>([\\s\\S]*?)<\\/'+safe+'>','i'))?.[1]||'';
  return decode(raw.replace(/^\s*<!\[CDATA\[/,'').replace(/\]\]>\s*$/,'').trim());
}
function detailKey(url:string,guid:string){
  if(guid.trim())return guid.trim().slice(0,500);
  try{return (new URL(url).pathname.split('/').filter(Boolean).at(-1)||url).slice(0,500)}catch{return url.slice(0,500)}
}
function addressFrom(text:string){
  const m=text.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'’ -]{2,100}\s+\d+[a-zA-Z]?)\s*,?\s*(2\d{4})\s+Hamburg\b/i);
  return m?{address:m[1].trim()+', '+m[2]+' Hamburg',zip:m[2]}:{address:null,zip:text.match(/\b(2\d{4})\b/)?.[1]||null};
}
export function parseBuchdruckerFeed(text:string,base='https://buchdrucker.immomio.de/immobilien/feed/'){
  if(!/<rss\b/i.test(text)||!/<channel\b/i.test(text))throw new Error('Buchdrucker RSS schema missing');
  const blocks=[...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m=>m[1]);
  const seeds:Candidate[]=[];
  for(const block of blocks){
    const title=strip(xmlValue(block,'title'))||'Buchdrucker Wohnungsangebot';
    const link=absolute(base,xmlValue(block,'link'));
    if(!link)continue;
    const guid=xmlValue(block,'guid');
    const html=xmlValue(block,'content:encoded')||xmlValue(block,'description');
    const plain=strip(title+' '+html).slice(0,20000);
    const fields=parseFields(plain),addr=addressFrom(plain);
    if(addr.zip&&!hhZip(addr.zip))continue;
    seeds.push({
      key:detailKey(link,guid),
      url:link,
      title:title.slice(0,240),
      address:addr.address,
      zip:addr.zip,
      warm:fields.warm,
      cold:fields.cold,
      additional:fields.additional,
      operating:fields.operating,
      heating:fields.heating,
      deposit:fields.deposit,
      rooms:fields.rooms,
      area:fields.area,
      wbs:fields.wbs,
      raw:{provider:'buchdrucker_public',feed_text:plain,feed_html:html.slice(0,30000),source_url:link},
    });
  }
  return {seeds,enumerated:blocks.length};
}
async function resolveRedirect(url:string){
  const response=await fetch(url,{
    method:'GET',
    redirect:'follow',
    headers:{'user-agent':'TraumwohnungHamburgBot/13.0','accept':'text/html,*/*'},
    signal:AbortSignal.timeout(6000),
  });
  return normalizeBuchdruckerApply(response.url||'');
}
async function targetFromText(text:string,finalUrl:string|null=null){
  const refs=extractBuchdruckerApplicationRefs(text),hits=new Set<string>();
  const final=normalizeBuchdruckerApply(finalUrl);if(final)hits.add(final);
  for(const url of refs.applies)hits.add(url);
  for(const redirect of refs.redirects.slice(0,4)){
    try{const hit=await resolveRedirect(redirect);if(hit)hits.add(hit)}catch{}
  }
  if(hits.size>1)throw new Error('Buchdrucker conflicting Immomio application targets');
  return [...hits][0]||null;
}
async function enrich(seed:Candidate){
  const embedded=await targetFromText(String(seed.raw?.feed_text||'')+' '+String(seed.raw?.feed_html||''));
  let target=embedded,detailText='',finalUrl=String(seed.url);
  if(!target){
    const detail=await fetchText(String(seed.url),undefined,8000);
    detailText=detail.text;finalUrl=detail.url;
    target=await targetFromText(detail.text,detail.url);
  }
  if(!target)return null;
  const plain=strip(detailText).slice(0,30000),fields=plain?parseFields(plain):null,addr=plain?addressFrom(plain):{address:null,zip:null};
  if(addr.zip&&!hhZip(addr.zip))return null;
  return {
    ...seed,
    url:target,
    address:seed.address||addr.address,
    zip:seed.zip||addr.zip,
    warm:seed.warm??fields?.warm??null,
    cold:seed.cold??fields?.cold??null,
    additional:seed.additional??fields?.additional??null,
    operating:seed.operating??fields?.operating??null,
    heating:seed.heating??fields?.heating??null,
    deposit:seed.deposit??fields?.deposit??null,
    rooms:seed.rooms??fields?.rooms??null,
    area:seed.area??fields?.area??null,
    wbs:seed.wbs??fields?.wbs??false,
    raw:{
      ...seed.raw,
      source_url:seed.url,
      final_detail_url:finalUrl,
      applicationLink:target,
      application_target_verified:true,
    },
  } satisfies Candidate;
}
export async function parseBuchdruckerInventory(text:string,base:string){
  const parsed=parseBuchdruckerFeed(text,base);
  if(!parsed.enumerated)return {candidates:[] as Candidate[],enumerated:0,complete:true,unresolved:0};
  const candidates:Candidate[]=[];let unresolved=0;
  for(let i=0;i<parsed.seeds.length;i+=4){
    const batch=await Promise.allSettled(parsed.seeds.slice(i,i+4).map(enrich));
    for(const result of batch){
      if(result.status==='fulfilled'&&result.value)candidates.push(result.value);
      else unresolved++;
    }
  }
  unresolved+=Math.max(0,parsed.enumerated-parsed.seeds.length);
  return {candidates,enumerated:parsed.enumerated,complete:unresolved===0,unresolved};
}
