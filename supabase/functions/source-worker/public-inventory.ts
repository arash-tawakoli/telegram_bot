import {Candidate, Connector, Source, db, decode, deNum, fetchText, iso, markFailure, markSuccess, strip, upsertCandidates} from './shared.ts';
import {parseKaifuInventory,parseFinkenInventory} from './cooperative-inventory.ts';

const number = (v: unknown) => v == null || String(v).trim() === '' ? null : deNum(String(v));
function attr(tag: string, name: string) {
  return decode(tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] || '');
}
export function parseTagInventory(text: string) {
  const r=JSON.parse(text)?.response;
  if (!r || !Array.isArray(r.results) || !Number.isInteger(r.meta?.hits) || r.meta.hits < 0)
    throw new Error('TAG inventory schema missing');
  if (r.meta.hits !== r.results.length) throw new Error('TAG inventory exceeds verified single-page coverage');
  const candidates: Candidate[]=[];
  for(const x of r.results) {
    const address=String(x.address||'');
    if(!/\bHamburg\b/i.test(address) || !/\b2\d{4}\s+Hamburg\b/i.test(address)) continue;
    if(/Garage|Stellplatz|Gewerbe|Büro|Lager/i.test(String(x.title||'')))continue;
    if(!x.id || !(number(x.number_of_rooms)! > 0))throw new Error('TAG residential listing identity or room count missing');
    candidates.push({key:String(x.id),url:`https://tag-wohnen.de/immosuche/expose?object_id=${encodeURIComponent(String(x.id))}`,title:x.title,address,zip:address.match(/\b(2\d{4})\s+Hamburg\b/i)?.[1],cold:number(x.netto_cold),warm:number(x.overall_warm),rooms:number(x.number_of_rooms),area:number(x.living_space),image:x.image_url,raw:{provider:'tag_public_api'}});
  }
  return {candidates,enumerated:r.results.length,complete:true};
}
export function parseUrbanInventory(html: string) {
  const seen=new Map<string,string>(),candidates:Candidate[]=[];
  for(const match of html.matchAll(/<a\b[^>]*\bclass=["'][^"']*\bapartment\b[^"']*["'][^>]*>/gi)) {
    const tag=match[0],title=attr(tag,'title'),id=title.match(/\bNr\.\s*(\d+\.\d+)/)?.[1];
    if(!id)throw new Error('Urban apartment identity missing');
    const content=decode(attr(tag,'data-text')).replace(/&lt;/gi,'<').replace(/&gt;/gi,'>'),plain=strip(content),status=plain.match(/Status:\s*(vermietet|reserviert|frei)\b/i)?.[1]?.toLowerCase();
    if(!status)throw new Error('Urban apartment availability unknown');
    if(seen.has(id)){if(seen.get(id)!==status)throw new Error('Urban conflicting apartment status');continue;}
    seen.set(id,status);
    if(status!=='frei')continue;
    const cold=number(plain.match(/Kaltmiete:\s*([\d.,]+)/i)?.[1]);
    const area=number(plain.match(/Größe:\s*([\d.,]+)/i)?.[1]);
    if(cold==null||area==null)throw new Error('Urban available apartment lacks rent or size');
    candidates.push({key:id,url:`https://www.urban-living-hamburg.de/mieten#${attr(tag,'id')}`,title,address:'Behringstraße 150, 22763 Hamburg',zip:'22763',cold,additional:number(plain.match(/Nebenkosten:\s*([\d.,]+)/i)?.[1]),area,furnished:true,image:new URL(attr(tag,'data-img'),'https://www.urban-living-hamburg.de').href,raw:{provider:'urban_living',availability:status}});
  }
  if(!seen.size)throw new Error('Urban apartment map missing');
  return {candidates,enumerated:seen.size,complete:true};
}
export function parseHeimInventory(html: string) {
  const plain=strip(html);
  if(!/Hamburg/.test(plain))throw new Error('Heimstaden Hamburg filter missing');
  const empty=/Leider konnten keine Angebote mit den gewünschten Kriterien gefunden werden/i.test(plain);
  const blocks=html.split(/<li\b[^>]*class=["']result__list--element["'][^>]*>/i).slice(1);
  if(!blocks.length&&!empty)throw new Error('Heimstaden inventory schema missing');
  if(blocks.length&&empty)throw new Error('Heimstaden contradictory inventory');
  const candidates:Candidate[]=[];
  for(const b of blocks){
    const location=strip(b.match(/infos--location[^>]*>([\s\S]*?)<\/div>/i)?.[1]||'');
    if(!/\bHamburg\b/.test(location)||!/Wohnung zur Miete/.test(strip(b)))continue;
    const id=b.match(/\/expose\/75089905\/(\d+)/)?.[1];
    const title=strip(b.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1]||'');
    const field=(name:string)=>number(strip(b.match(new RegExp(`${name}</h4>\\s*<span[^>]*>([\\s\\S]*?)</span>`,'i'))?.[1]||'').replace(/€/g,''));
    if(!id||!title)throw new Error('Heimstaden listing identity missing');
    candidates.push({key:id,url:`https://www.immobilienscout24.de/expose/${id}`,title,address:location,cold:field('Kaltmiete'),rooms:field('Zimmer'),area:field('Wohnfl(?:&auml;|ä)che'),raw:{provider:'heimstaden_portal',native_new:/alt=["']Neu["']/i.test(b)}});
  }
  // Nonempty portal pages may be capped; never claim a complete snapshot.
  return {candidates,enumerated:blocks.length,complete:empty};
}
export async function runPublicInventory(source:Source,connector:Connector) {
  const started=iso();
  try {
    const adapter=String(connector.config?.adapter||'');
    const response=await fetchText(String(connector.config?.url||''));
    const parser=({'source-worker/tag-public':parseTagInventory,'source-worker/urban-public':parseUrbanInventory,'source-worker/heim-public':parseHeimInventory,'source-worker/kaifu-public':parseKaifuInventory,'source-worker/finken-public':parseFinkenInventory} as Record<string,(text:string)=>{candidates:Candidate[];enumerated:number;complete:boolean}>)[adapter];
    if(!parser)throw new Error('Unsupported public inventory adapter');
    const parsed=parser(response.text);
    const {data:state}=await db.from('source_coverage_state').select('cursor').eq('source_id',source.id).maybeSingle().throwOnError();
    const warmed=!!source.baseline_completed_at&&state?.cursor?.adapter===adapter&&state?.cursor?.url===connector.config.url;
    const fresh=parsed.candidates.filter(c=>warmed&&(source.id!==11||c.raw?.native_new===true));
    const blocked=parsed.candidates.filter(c=>!fresh.includes(c));
    const a=await upsertCandidates(source,fresh,true),b=await upsertCandidates(source,blocked,false);
    if(parsed.complete) {
      const provider=({'source-worker/tag-public':'tag_public_api','source-worker/urban-public':'urban_living','source-worker/heim-public':'heimstaden_portal','source-worker/kaifu-public':'kaifu_public_api','source-worker/finken-public':'finkenwaerder_public_api'} as Record<string,string>)[adapter];
      const {data:active}=await db.from('listings').select('id,source_listing_key').eq('source_id',source.id).eq('is_active',true).eq('raw->>provider',provider).throwOnError();
      const keys=new Set(parsed.candidates.map(c=>String(c.key)));
      const stale=(active||[]).filter((r:any)=>!keys.has(String(r.source_listing_key))).map((r:any)=>r.id);
      if(stale.length)await db.from('listings').update({is_active:false}).in('id',stale).throwOnError();
    }
    await db.from('source_coverage_state').upsert({source_id:source.id,cycle_id:crypto.randomUUID(),strategy:'verified_public_inventory',status:parsed.complete?'complete':'running',cursor:{adapter,url:connector.config.url},seen_count:parsed.enumerated,request_count:1,cycle_started_at:started,cycle_finished_at:parsed.complete?iso():null,last_complete_at:parsed.complete?iso():null,updated_at:iso(),last_error:null}).throwOnError();
    await markSuccess(source,started,connector,parsed.candidates.length,a.fresh+b.fresh,{adapter,complete:parsed.complete,enumerated:parsed.enumerated,verified_empty:parsed.enumerated===0||parsed.candidates.length===0,fallback_warmed:warmed});
    return {ok:true,source_id:source.id,fetched:parsed.candidates.length,new:a.fresh,complete:parsed.complete};
  }catch(error){return markFailure(source,started,error);}
}
