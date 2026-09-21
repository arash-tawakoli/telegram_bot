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

async function runHtmlCategory(source:Source,stream:any){
  const r=await fetchText(String(stream.url)),parsed=parseHtml(r.text,r.url),rows:Candidate[]=[];
  for(const c of parsed){const text=`${c.title||''} ${c.raw?.text||''}`,kind=String(stream.category);if(kind==='house'&&(!/\b(Haus|Einfamilienhaus|Reihenhaus|Doppelhaus|Doppelhaushälfte|Villa|Bungalow|Stadthaus)\b/i.test(text)||/\b(Kauf|kaufen|Mietkauf|Grundstück|Erbpacht)\b/i.test(text)))continue;if(kind==='room'&&!/\b(WG(?:-Zimmer)?|Zimmer|Mitbewohner(?:in)?)\b/i.test(text))continue;const published=pageTimestamp(text);rows.push({...c,raw:{...c.raw,...(published?{_newness:{method:'source_timestamp',source_published_at:published}}:{})}})}
  const noOffers=/keine (?:passenden )?(?:angebote|immobilien)|0 (?:angebote|treffer)/i.test(strip(r.text));if(!parsed.length&&!noOffers)throw new Error(`${stream.adapter} category parser found no recognizable listing cards`);
  const saved=await persistCategoryListings(source,stream,rows,false);return{requests:1,candidates:saved.seen,fresh:saved.fresh,cursor:{url:r.url,parsed:parsed.length,accepted:saved.seen,last_checked_at:iso()}};
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
