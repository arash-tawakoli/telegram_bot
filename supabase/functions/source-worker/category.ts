import {Candidate,Source,db,fetchText,iso,parseHtml,strip,upsertCandidates} from './shared.ts';
import {runScoutCategory} from './scout.ts';
import {runKleinCategory} from './klein.ts';
import {persistCategoryListings} from './category-persist.ts';
import {runImmoweltCategory} from './generic.ts';

function pageTimestamp(text:string){
  const label=text.match(/\b(Heute|Gestern|\d{1,2}\.\d{1,2}\.\d{4})\b[^\d]{0,12}(\d{1,2}):(\d{2})/i);
  if(!label)return null;
  const nowParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  let y=Number(nowParts.year),m=Number(nowParts.month),d=Number(nowParts.day);
  if(/^Gestern$/i.test(label[1])){const x=new Date(Date.UTC(y,m-1,d)-86400000);y=x.getUTCFullYear();m=x.getUTCMonth()+1;d=x.getUTCDate()}
  else if(!/^Heute$/i.test(label[1])){const x=label[1].match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)!;d=Number(x[1]);m=Number(x[2]);y=Number(x[3])}
  const guess=new Date(Date.UTC(y,m-1,d,Number(label[2]),Number(label[3])));
  const zone=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',timeZoneName:'shortOffset'}).formatToParts(guess).find(x=>x.type==='timeZoneName')?.value||'GMT+1';
  const om=zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/),offset=om?(om[1]==='-'?-1:1)*(Number(om[2])*60+Number(om[3]||0)):60;
  return new Date(guess.getTime()-offset*60000).toISOString();
}

function regionalHtmlTitle(candidate:Candidate,category:string){
  const current=String(candidate.title||'').trim();
  const generic=/^(?:Zimmer|Wohnung|Haus|Immobilie|Wohnungsangebot|Angebot|Mehr erfahren|Details?)$/i;
  if(current&&!generic.test(current))return current;
  const raw=String(candidate.raw?.text||'').replace(/\s+/g,' ').trim();
  const postalCode=String(candidate.zip||'');
  const postalIndex=postalCode?raw.indexOf(postalCode):-1;
  const locationIndex=postalIndex>=0?postalIndex:raw.search(/\b\d{5}\b/);
  const fallback=category==='house'?'Haus in Schleswig-Holstein':category==='room'?'WG-Zimmer in Schleswig-Holstein':category==='swap'?'Tauschwohnung in Schleswig-Holstein':'Wohnung in Schleswig-Holstein';
  if(locationIndex<0)return current||fallback;
  const before=raw.slice(0,locationIndex).trim();
  const prices=[...before.matchAll(/(?:Monatsrate\s+ca\.\s*)?[\d.]+(?:,[\d]{1,2})?\s*€/gi)];
  const last=prices.at(-1);
  if(!last)return current||fallback;
  const title=before.slice((last.index||0)+last[0].length).trim().replace(/\s+/g,' ');
  if(title.length<8||/^(?:Sortierung|Preis|Neueste|Älteste|Monatsrate|Angebote|Treffer)\b/i.test(title))return current||fallback;
  if(/\b(?:Wohnung|Apartment|Appartement|Haus|Einfamilienhaus|Reihenhaus|Doppelhaus|Doppelhaushälfte|Bungalow|Townhouse|Zimmer|WG|Maisonette|Villa|Loft)\b/i.test(title))return title.slice(0,240);
  const label=category==='house'?'Haus':category==='room'?'WG-Zimmer':category==='swap'?'Tauschwohnung':'Wohnung';
  return (label+' in '+title).slice(0,240);
}

async function runHtmlCategory(source:Source,stream:any){
  const r=await fetchText(String(stream.url)),regionStateCode=source.search_capabilities?.region_state_code==='SH'?'SH':'HH',parsed=parseHtml(r.text,r.url,regionStateCode),rows:Candidate[]=[];
  const categoryOnly=source.coverage_strategy==='category_streams_only';
  for(const c of parsed){
    const text=`${c.title||''} ${c.raw?.text||''}`,kind=String(stream.category);
    // Regional streams use a provider URL already scoped to the requested category.
    // Do not reject valid house cards merely because "Haus" is absent from the title.
    if(kind==='house'&&!categoryOnly&&(!/\b(Haus|Einfamilienhaus|Reihenhaus|Doppelhaus|Doppelhaushälfte|Villa|Bungalow|Stadthaus)\b/i.test(text)||/\b(Kauf|kaufen|Mietkauf|Grundstück|Erbpacht)\b/i.test(text)))continue;
    if(kind==='room'&&!/\b(WG(?:-Zimmer)?|Zimmer|Mitbewohner(?:in)?)\b/i.test(text))continue;
    const published=pageTimestamp(text);
    const title=categoryOnly?regionalHtmlTitle(c,kind):c.title;
    rows.push({...c,title,raw:{...c.raw,...(published?{_newness:{method:'source_timestamp',source_published_at:published}}:{})}});
  }
  const noOffers=/keine (?:passenden )?(?:angebote|immobilien)|0 (?:angebote|treffer)/i.test(strip(r.text));
  if(!parsed.length&&!noOffers)throw new Error(`${stream.adapter} category parser found no recognizable listing cards`);
  const verifiedEmpty=parsed.length===0&&noOffers;
  const saved=await persistCategoryListings(source,stream,rows,false);
  return{requests:1,candidates:saved.seen,fresh:saved.fresh,cursor:{url:r.url,parsed:parsed.length,accepted:saved.seen,complete:true,verified_empty:verifiedEmpty,last_checked_at:iso()}};
}

async function finish(stream:any,success:boolean,result:any,error:string|null){
  const {data, error:rpcError}=await db.rpc('finish_source_category_stream',{
    p_source_id:stream.source_id,p_category:stream.category,p_token:stream.lease_token,p_success:success,
    p_cursor:result?.cursor||stream.cursor||{},p_requests:Number(result?.requests||0),p_candidates:Number(result?.candidates||0),p_error:error
  });
  if(rpcError||data!==true)throw new Error(`finish_source_category_stream failed: ${rpcError?.message||'lease lost'}`);
}

export async function runCategoryStreams(source:Source){
  const {data:streams,error}=await db.rpc('claim_source_category_streams',{p_source_id:source.id});
  if(error)throw error;
  const out:any[]=[];
  for(const stream of streams||[]){
    try{
      let result:any;
      if(stream.adapter==='scout')result=await runScoutCategory(source,stream);
      else if(stream.adapter==='kleinanzeigen')result=await runKleinCategory(source,stream);
      else if(['wg-gesucht','ohne-makler'].includes(stream.adapter))result=await runHtmlCategory(source,stream);
      else if(stream.adapter==='immowelt')result=await runImmoweltCategory(source,stream);
      else throw new Error(`unsupported category adapter ${stream.adapter}`);
      const parsedCount=Number(result?.cursor?.parsed??result?.cursor?.opens??0);
      if(source.coverage_strategy==='category_streams_only'&&Number(result?.candidates||0)===0&&parsedCount>0&&result?.cursor?.verified_empty!==true){
        throw new Error(`${stream.adapter} ${stream.category} parser saw ${parsedCount} cards but accepted zero; refusing baseline approval`);
      }
      await finish(stream,true,result,null);
      out.push({category:stream.category,adapter:stream.adapter,ok:true,...result});
    }catch(e){
      const message=e instanceof Error?e.message:String(e);
      try{await finish(stream,false,null,message)}catch(finishError){console.error('category_finish',String(finishError))}
      out.push({category:stream.category,adapter:stream.adapter,ok:false,error:message});
    }
  }
  return out;
}
