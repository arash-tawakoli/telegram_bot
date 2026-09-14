export class TelegramFailure extends Error {
 outcomeUnknown:boolean;allowImageFallback:boolean;retryAfter:number;
 constructor(message:string,outcomeUnknown=false,allowImageFallback=false,retryAfter=0){super(message);this.outcomeUnknown=outcomeUnknown;this.allowImageFallback=allowImageFallback;this.retryAfter=retryAfter;}
}

const PREVIEW_EMOJIS: Record<string,string> = {
 'Warmmiete':'💶',
 'Warmmiete / Gesamtmiete':'💶',
 'Warm rent':'💶',
 'Warm / total rent':'💶',
 'Gesamtmiete':'🧮',
 'Total rent':'🧮',
 'Kaltmiete':'❄️',
 'Cold rent':'❄️',
 'Nebenkosten':'🧾',
 'Utilities':'🧾',
 'Betriebskosten':'🏢',
 'Operating costs':'🏢',
 'Heizkosten':'🔥',
 'Heating costs':'🔥',
 'Kaution':'🔐',
 'Deposit':'🔐',
 'Angebotspreis/Monat (Nebenkosten ungeklärt)':'🪙',
 'Advertised monthly price (utilities unverified)':'🪙',
 'Zimmer':'🚪',
 'Rooms':'🚪',
 'Wohnfläche':'📐',
 'Living area':'📐',
 'Etage':'🛗',
 'Floor':'🛗',
 'Wohnungstyp':'🏘️',
 'Property type':'🏘️',
 'Einzugsdatum':'🔑',
 'Move-in date':'🔑',
 'Verfügbar ab':'📅',
 'Available from':'📅',
 'Bezirk':'🧭',
 'Stadtteil':'🌆',
 'Veröffentlicht laut Quelle':'📰',
 'Ausstattung':'🧰',
 'Schlafzimmer':'🛏️',
 'Badezimmer':'🚿',
 'Haustiere':'🐾',
 'Baujahr':'🏗️',
 'Objektzustand':'🧱',
 'Qualität der Ausstattung':'✨',
 'Energieausweis':'📄',
 'Heizungsart':'♨️',
 'Wesentliche Energieträger':'⚡',
 'Energieeffizienzklasse':'🌿',
 'Endenergieverbrauch':'📊',
 'Endenergiebedarf':'📈',
 'Miete für Garage/Stellplatz':'🚗',
 'Adresse':'📍',
 'Address':'📍',
};
const FALLBACK_EMOJIS=['🔎','🧩','📌','🔷','🔶','🪪','📋','🧿','🎛️','🧯','🪟','🪜','🧲','🧺','🗂️','🪴','🪑','🛋️','🪵','🧼','💡','🔌','🚰','🧹','🧵','🧶','📚','🗃️','🪄','🎯'];
const EMBEDDED_LABEL_EMOJIS=['🛗','🏘️','🔑'];

export function decorateListingPreview(text:string) {
 const used=new Set<string>();
 let fallbackIndex=0;
 const nextFallback=()=>{
  while(fallbackIndex<FALLBACK_EMOJIS.length && used.has(FALLBACK_EMOJIS[fallbackIndex]))fallbackIndex++;
  return FALLBACK_EMOJIS[fallbackIndex++] || '🔘';
 };
 return String(text||'').split('\n').map(line=>{
  const match=line.match(/^(?:(\S+)\s+)?<b>([^<]+):<\/b>(.*)$/);
  if(!match)return line;
  const existingOuter=match[1]||'';
  let label=match[2].trim();
  let embedded='';
  for(const emoji of EMBEDDED_LABEL_EMOJIS){
   if(label.startsWith(`${emoji} `)){embedded=emoji;label=label.slice(emoji.length).trim();break;}
  }
  let emoji=PREVIEW_EMOJIS[label] || existingOuter || embedded;
  if(!emoji || used.has(emoji))emoji=nextFallback();
  used.add(emoji);
  return `${emoji} <b>${label}:</b>${match[3]}`;
 }).join('\n');
}

function decorateTelegramBody(body:BodyInit|null|undefined) {
 if(typeof body==='string'){
  try {
   const parsed=JSON.parse(body);
   if(typeof parsed?.caption==='string')parsed.caption=decorateListingPreview(parsed.caption);
   if(typeof parsed?.text==='string')parsed.text=decorateListingPreview(parsed.text);
   if(Array.isArray(parsed?.media))for(const item of parsed.media)if(typeof item?.caption==='string')item.caption=decorateListingPreview(item.caption);
   return JSON.stringify(parsed);
  } catch { return body; }
 }
 if(body instanceof FormData){
  for(const key of ['caption','text']){
   const value=body.get(key);
   if(typeof value==='string')body.set(key,decorateListingPreview(value));
  }
  const media=body.get('media');
  if(typeof media==='string')try{
   const parsed=JSON.parse(media);
   if(Array.isArray(parsed))for(const item of parsed)if(typeof item?.caption==='string')item.caption=decorateListingPreview(item.caption);
   body.set('media',JSON.stringify(parsed));
  }catch{}
 }
 return body;
}

export async function telegramRequest(url: string, init: RequestInit, request=fetch) {
 let response:Response,body:any;
 const decorated={...init,body:decorateTelegramBody(init.body)};
 try {response=await request(url,{...decorated,signal:AbortSignal.timeout(20000)});body=await response.json();}
 catch {throw new TelegramFailure('Telegram transport ended without a confirmed outcome',true);}
 if(!response.ok||body?.ok!==true){
  const description=String(body?.description||`Telegram ${response.status}`);
  throw new TelegramFailure(description,false,response.status===400&&/photo|image|media|file|caption|failed to get HTTP URL content|WEBPAGE_CURL_FAILED/i.test(description),Number(body?.parameters?.retry_after||0));
 }
 return body.result;
}
