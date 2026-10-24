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

type WgGesuchtSHCity = { slug: string; id: string; name?: string | null };
type WgGesuchtSHQueueItem = { url: string; city: string | null };
const WG_SH_DIRECTORY_URL = "https://www.wg-gesucht.de/staedte-in-schleswig-holstein.13.html";
const WG_SH_BATCH_SIZE = 10;
let wgSHCityCache: { at: number; cities: WgGesuchtSHCity[] } | null = null;

function wgGesuchtCityKey(value: string) {
  return String(value || "")
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseWgGesuchtSHCities(html: string, base = WG_SH_DIRECTORY_URL, allowedNames?: string[]): WgGesuchtSHCity[] {
  const allowed = allowedNames ? new Set(allowedNames.map(wgGesuchtCityKey)) : null;
  const cities = new Map<string, WgGesuchtSHCity>();
  for (const match of html.matchAll(/href=["']([^"'<>]*anzeigen-in-[^"'<>]+\.html(?:\?[^"'<>]*)?)["']/gi)) {
    let url: URL;
    try { url = new URL(match[1].replace(/&amp;/g, "&"), base); } catch { continue; }
    if (url.hostname !== "www.wg-gesucht.de") continue;
    const path = url.pathname.split("/").pop() || "";
    const city = path.match(/^anzeigen-in-(.+)\.(\d+)\.html$/i);
    if (!city || !city[1] || !city[2]) continue;
    if (allowed && !allowed.has(wgGesuchtCityKey(city[1].replace(/-/g, " ")))) continue;
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
  const [{ data: areas, error }, { data: aliases, error: aliasError }, response] = await Promise.all([
    db.rpc("get_schleswig_holstein_areas"),
    db.from("geo_area_aliases").select("alias,area_code"),
    fetchText(WG_SH_DIRECTORY_URL),
  ]);
  if (error) throw error;
  if (aliasError) throw aliasError;
  const rows = (areas || []).filter((area: any) => ["municipality", "independent_city"].includes(String(area.area_type)));
  const byCode = new Map(rows.map((area: any) => [String(area.area_code), area]));
  const byName = new Map<string, any | null>();
  const addName = (name: string, area: any) => {
    const key = wgGesuchtCityKey(name);
    if (!key) return;
    if (!byName.has(key)) { byName.set(key, area); return; }
    const previous = byName.get(key);
    if (!previous || String(previous.area_code) === String(area.area_code)) return;
    if (previous.area_type === "independent_city" && area.area_type === "municipality") { byName.set(key, area); return; }
    if (previous.area_type === "municipality" && area.area_type === "independent_city") return;
    byName.set(key, null);
  };
  const allowedNames: string[] = [];
  for (const area of rows) {
    addName(String(area.name), area);
    allowedNames.push(String(area.name));
    const parent = byCode.get(String(area.parent_code)) as any;
    if (parent) {
      for (const combined of [`${area.name} ${parent.name}`, `${parent.name} ${area.name}`]) {
        addName(combined, area);
        allowedNames.push(combined);
      }
    }
  }
  for (const alias of aliases || []) {
    const area = byCode.get(String(alias.area_code));
    if (area) { addName(String(alias.alias), area); allowedNames.push(String(alias.alias)); }
  }
  const discovered = parseWgGesuchtSHCities(response.text, response.url, allowedNames);
  const cities = discovered.map((city) => {
    const area = byName.get(wgGesuchtCityKey(city.slug.replace(/-/g, " ")));
    return { ...city, name: area?.name ? String(area.name) : city.slug.replace(/-/g, " ") };
  });
  const minimum = Math.ceil(rows.length * 0.85);
  if (cities.length < minimum) throw new Error(`WG-Gesucht Schleswig-Holstein directory mapped only ${cities.length}/${rows.length} official areas (minimum ${minimum}); refusing partial baseline`);
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

export function wgGesuchtVerifiedEmptyResult(html: string, category: string): boolean {
  const labels: Record<string, string> = {
    room: "WG[- ]Zimmer",
    one_room: "1-Zimmer-Wohnungen?",
    apartment: "Wohnungen?",
    house: "(?:Haus|Häuser)",
  };
  const label = labels[category];
  const headings = [...html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
    .map((match) => strip(match[1]))
    .join(" ");
  if (label) {
    const count = headings.match(new RegExp("\\b(\\d+)\\s+" + label + "\\b", "i"));
    if (count) return Number(count[1]) === 0;
  }
  if (/href=["'][^"'<>]*\/\d{6,}\.html(?:[?#][^"'<>]*)?["']/i.test(html)) return false;
  return /keine (?:passenden )?(?:angebote|anzeigen|immobilien)|0 (?:angebote|treffer)|leider (?:gibt es|haben wir) (?:aktuell )?keine/i.test(headings);
}

async function runWgGesuchtSHCategory(source: Source, stream: any) {
  const category = String(stream.category || "");
  const prior = stream.cursor && typeof stream.cursor === "object" ? stream.cursor : {};
  let queue: WgGesuchtSHQueueItem[] = Array.isArray(prior.queue)
    ? prior.queue.map((entry: any) => typeof entry === "string"
      ? { url: entry, city: null }
      : { url: String(entry?.url || ""), city: entry?.city ? String(entry.city) : null })
      .filter((entry: WgGesuchtSHQueueItem) => !!entry.url)
    : [];
  let initialized = prior.initialized === true;
  let cityCount = Number(prior.city_count || 0);
  let processedPages = Number(prior.processed_pages || 0);
  let parsedTotal = Number(prior.parsed_total || 0);
  let acceptedTotal = Number(prior.accepted_total || 0);
  let allEmptyVerified = prior.all_empty_verified !== false;
  let directoryRequested = false;
  if (!initialized || prior.complete === true) {
    const cities = await loadWgGesuchtSHCities();
    directoryRequested = true;
    queue = cities.map((city) => ({ url: wgGesuchtSHCategoryUrl(city, category), city: city.name || null }));
    initialized = true;
    cityCount = cities.length;
    processedPages = 0;
    parsedTotal = 0;
    acceptedTotal = 0;
    allEmptyVerified = true;
  } else if (queue.some((entry) => !entry.city)) {
    const cities = await loadWgGesuchtSHCities();
    directoryRequested = true;
    const cityById = new Map(cities.map((city) => [city.id, city.name || city.slug.replace(/-/g, " ")]));
    queue = queue.map((entry) => {
      if (entry.city) return entry;
      const match = new URL(entry.url).pathname.match(/\.(\d+)\.(?:0|1|2|3)\.1\.0\.html$/i)
        || new URL(entry.url).pathname.match(/\.(\d+)\.\d+\.1\.0\.html$/i);
      return { ...entry, city: match ? cityById.get(match[1]) || null : null };
    });
  }
  const batch = queue.splice(0, WG_SH_BATCH_SIZE);
  if (!batch.length) throw new Error("WG-Gesucht Schleswig-Holstein has no pending city pages");
  const queued = new Set(queue.map((entry) => entry.url));
  const candidates: Candidate[] = [];
  let parsed = 0;
  let requests = 0;
  let batchEmptyVerified = true;
  const pageResults = await Promise.all(batch.map(async (entry) => {
    const response = await fetchText(entry.url);
    const parsedRows = parseHtml(response.text, response.url, "SH").map((candidate) => ({
      ...candidate,
      city: entry.city || candidate.city || null,
      raw: { ...candidate.raw, region_state_code: "SH", provider_city: entry.city || null },
    }));
    const noOffers = wgGesuchtVerifiedEmptyResult(response.text, category);
    if (!parsedRows.length && !noOffers) throw new Error(`WG-Gesucht ${category} parser found no cards and no verified-empty marker at ${entry.url}; sample=${strip(response.text).slice(0,350)}`);
    const rows = parsedRows.map((candidate) => {
      const published = pageTimestamp(`${candidate.title || ""} ${candidate.raw?.text || ""}`);
      return { ...candidate, raw: { ...candidate.raw, ...(published ? { _newness: { method: "source_timestamp", source_published_at: published } } : {}) } };
    });
    return { url: response.url, html: response.text, city: entry.city, parsedRows, rows, noOffers };
  }));
  requests += pageResults.length;
  for (const page of pageResults) {
    parsed += page.parsedRows.length;
    candidates.push(...page.rows);
    if (page.parsedRows.length || !page.noOffers) batchEmptyVerified = false;
    for (const next of wgGesuchtPaginationUrls(page.html, page.url, queued)) queue.push({ url: next, city: page.city });
  }
  const saved = await persistCategoryListings(source, stream, candidates, false);
  parsedTotal += parsed;
  acceptedTotal += saved.seen;
  processedPages += batch.length;
  const complete = queue.length === 0;
  allEmptyVerified = allEmptyVerified && batchEmptyVerified;
  const verifiedEmpty = complete && acceptedTotal === 0 && allEmptyVerified;
  return {
    requests: requests + (directoryRequested ? 1 : 0),
    candidates: saved.seen,
    fresh: saved.fresh,
    cursor: {
      initialized, queue, city_count: cityCount, processed_pages: processedPages,
      parsed, parsed_total: parsedTotal, accepted: saved.seen, accepted_total: acceptedTotal,
      ...(saved.seen===0&&candidates.length?{sample_cards:candidates.slice(0,5).map(candidate=>({title:candidate.title,url:candidate.url,city:candidate.city,zip:candidate.zip,text:String(candidate.raw?.text||'').slice(0,180)}))}:{}),
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
        throw new Error(`${stream.adapter} ${stream.category} parser saw ${parsedCount} cards but accepted zero; url=${String(result?.cursor?.first_url||'')}; room_signals=${String(result?.cursor?.room_signal_count??'')}; sample=${JSON.stringify(result?.cursor?.sample_cards||[]).slice(0,900)}; refusing baseline approval`);
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
