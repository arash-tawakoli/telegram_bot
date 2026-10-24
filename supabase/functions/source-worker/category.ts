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

type WgGesuchtSHCity = { slug: string; id: string };
const WG_SH_DIRECTORY_URL = "https://www.wg-gesucht.de/staedte-in-schleswig-holstein.13.html";
const WG_SH_BATCH_SIZE = 5;
let wgSHCityCache: { at: number; cities: WgGesuchtSHCity[] } | null = null;

export function parseWgGesuchtSHCities(html: string, base = WG_SH_DIRECTORY_URL): WgGesuchtSHCity[] {
  const cities = new Map<string, WgGesuchtSHCity>();
  for (const match of html.matchAll(/href=["']([^"'<>]*anzeigen-in-[^"'<>]+\.html(?:\?[^"'<>]*)?)["']/gi)) {
    let url: URL;
    try { url = new URL(match[1].replace(/&amp;/g, "&"), base); } catch { continue; }
    if (url.hostname !== "www.wg-gesucht.de") continue;
    const path = url.pathname.split("/").pop() || "";
    const city = path.match(/^anzeigen-in-(.+)\.(\d+)\.html$/i);
    if (!city || !city[1] || !city[2]) continue;
    cities.set(city[2], { slug: city[1], id: city[2] });
  }
  return [...cities.values()];
}

export function wgGesuchtSHCategoryUrl(city: WgGesuchtSHCity, category: string): string {
  const config: Record<string, { prefix: string; suffix: string }> = {
    room: { prefix: "wg-zimmer-in-", suffix: ".0.1.0.html" },
    one_room: { prefix: "1-zimmer-wohnungen-in-", suffix: ".1.1.0.html" },
    apartment: { prefix: "wohnungen-in-", suffix: ".2.1.0.html" },
    house: { prefix: "haeuser-in-", suffix: ".3.1.0.html" },
  };
  const selected = config[category];
  if (!selected) throw new Error(`Unsupported WG-Gesucht Schleswig-Holstein category: ${category}`);
  return `https://www.wg-gesucht.de/${selected.prefix}${city.slug}.${city.id}${selected.suffix}`;
}

async function loadWgGesuchtSHCities(): Promise<WgGesuchtSHCity[]> {
  if (wgSHCityCache && Date.now() - wgSHCityCache.at < 60 * 60 * 1000) return wgSHCityCache.cities;
  const response = await fetchText(WG_SH_DIRECTORY_URL);
  const cities = parseWgGesuchtSHCities(response.text, response.url);
  if (cities.length < 500) throw new Error(`WG-Gesucht Schleswig-Holstein directory returned only ${cities.length} city links; refusing partial baseline`);
  wgSHCityCache = { at: Date.now(), cities };
  return cities;
}

function wgGesuchtPaginationUrls(html: string, currentUrl: string, queued: Set<string>): string[] {
  const current = new URL(currentUrl);
  const currentPage = Math.max(1, Number(current.searchParams.get("page") || 1));
  const pages: string[] = [];
  for (const match of html.matchAll(/href=["']([^"'<>]+)["']/gi)) {
    let candidate: URL;
    try { candidate = new URL(match[1].replace(/&amp;/g, "&"), currentUrl); } catch { continue; }
    if (candidate.hostname !== "www.wg-gesucht.de" || candidate.pathname !== current.pathname) continue;
    const page = Number(candidate.searchParams.get("page") || 1);
    if (!Number.isFinite(page) || page <= currentPage) continue;
    candidate.hash = "";
    if (!queued.has(candidate.href)) {
      queued.add(candidate.href);
      pages.push(candidate.href);
    }
  }
  return pages;
}

async function runWgGesuchtSHCategory(source: Source, stream: any) {
  const category = String(stream.category || "");
  const prior = stream.cursor && typeof stream.cursor === "object" ? stream.cursor : {};
  let queue: string[] = Array.isArray(prior.queue) ? prior.queue.map(String) : [];
  let initialized = prior.initialized === true;
  let cityCount = Number(prior.city_count || 0);
  let processedPages = Number(prior.processed_pages || 0);
  let parsedTotal = Number(prior.parsed_total || 0);
  let acceptedTotal = Number(prior.accepted_total || 0);
  let allEmptyVerified = prior.all_empty_verified !== false;
  if (!initialized || prior.complete === true) {
    const cities = await loadWgGesuchtSHCities();
    queue = cities.map((city) => wgGesuchtSHCategoryUrl(city, category));
    initialized = true;
    cityCount = cities.length;
    processedPages = 0;
    parsedTotal = 0;
    acceptedTotal = 0;
    allEmptyVerified = true;
  }
  const batch = queue.splice(0, WG_SH_BATCH_SIZE);
  if (!batch.length) throw new Error("WG-Gesucht Schleswig-Holstein has no pending city pages");
  const queued = new Set(queue);
  const candidates: Candidate[] = [];
  let parsed = 0;
  let requests = 0;
  let batchEmptyVerified = true;
  for (let offset = 0; offset < batch.length; offset += WG_SH_BATCH_SIZE) {
    const pages = await Promise.all(batch.slice(offset, offset + WG_SH_BATCH_SIZE).map(async (url) => {
      const response = await fetchText(url);
      const regionStateCode = "SH";
      const parsedRows = parseHtml(response.text, response.url, regionStateCode);
      const noOffers = /keine (?:passenden )?(?:angebote|anzeigen|immobilien)|0 (?:angebote|treffer)|leider (?:gibt es|haben wir) (?:aktuell )?keine/i.test(strip(response.text));
      if (!parsedRows.length && !noOffers) throw new Error(`WG-Gesucht ${category} parser found no cards and no verified-empty marker at ${url}`);
      const rows = parsedRows.map((candidate) => {
        const published = pageTimestamp(`${candidate.title || ""} ${candidate.raw?.text || ""}`);
        return { ...candidate, raw: { ...candidate.raw, ...(published ? { _newness: { method: "source_timestamp", source_published_at: published } } : {}) } };
      });
      return { url: response.url, html: response.text, parsedRows, rows, noOffers };
    }));
    requests += pages.length;
    for (const page of pages) {
      parsed += page.parsedRows.length;
      candidates.push(...page.rows);
      if (page.parsedRows.length || !page.noOffers) batchEmptyVerified = false;
      for (const next of wgGesuchtPaginationUrls(page.html, page.url, queued)) queue.push(next);
    }
  }
  const saved = await persistCategoryListings(source, stream, candidates, false);
  parsedTotal += parsed;
  acceptedTotal += saved.seen;
  processedPages += batch.length;
  const complete = queue.length === 0;
  allEmptyVerified = allEmptyVerified && batchEmptyVerified;
  const verifiedEmpty = complete && acceptedTotal === 0 && allEmptyVerified;
  return {
    requests: requests + (prior.initialized === true && prior.complete !== true ? 0 : 1),
    candidates: saved.seen,
    fresh: saved.fresh,
    cursor: {
      initialized, queue, city_count: cityCount, processed_pages: processedPages,
      parsed, parsed_total: parsedTotal, accepted: saved.seen, accepted_total: acceptedTotal,
      all_empty_verified: allEmptyVerified, complete, verified_empty: verifiedEmpty,
      last_checked_at: iso()
    }
  };
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
      else if(stream.adapter==='wg-gesucht-sh')result=await runWgGesuchtSHCategory(source,stream);
      else if(['wg-gesucht','ohne-makler'].includes(stream.adapter))result=await runHtmlCategory(source,stream);
      else if(stream.adapter==='immowelt')result=await runImmoweltCategory(source,stream);
      else throw new Error(`unsupported category adapter ${stream.adapter}`);
      const parsedCount=Number(result?.cursor?.parsed??result?.cursor?.opens??0);
      if(source.coverage_strategy==='category_streams_only'&&Number(result?.candidates||0)===0&&parsedCount>0&&result?.cursor?.verified_empty!==true){
        throw new Error(`${stream.adapter} ${stream.category} parser saw ${parsedCount} cards but accepted zero; sample=${JSON.stringify(result?.cursor?.sample_cards||[]).slice(0,900)}; refusing baseline approval`);
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
