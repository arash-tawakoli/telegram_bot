// Only traverse listing-owned containers. Never read publisher/contact/related offers.
export function present(v: any): boolean {
  return (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && !!v.trim() && !/^(?:[-–—]|n\/?a|null|undefined|NO_INFORMATION|NOT_SPECIFIED|UNKNOWN|nicht (?:vorhanden|angegeben)|keine Angabe|auf Anfrage)$/i.test(v.trim()));
}
export function textValue(v: any): string | null {
  return present(v) ? String(v) : null;
}
export function amount(v: any): number | null {
  if (v && typeof v === 'object') v = v.value ?? v.amount;
  if (!present(v) || typeof v === 'boolean') return null;
  const s = String(v).trim().replace(/\s*(?:€|EUR|m²|m2)(?:\s*(?:\/\s*Monat|pro Monat|monatlich))?\s*$/i, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(s)) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(?:\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function exactAddress(a: any): string | null {
  if (typeof a === 'string') return textValue(a);
  if (!a || typeof a !== 'object' || a.showAddress === false || a.hideAddress === true) return null;
  const full = a.formattedAddress ?? a.fullAddress ?? a.addressText;
  if (typeof full === 'string') return textValue(full);
  // Structured source components: retain spelling and house-number suffixes; no city default.
  const street = textValue(a.streetAddress) ?? [a.street ?? a.strasse, a.houseNumber ?? a.streetNumber ?? a.hausnummer].filter(present).map(x => String(x).trim()).join(' ');
  const place = [a.postalCode ?? a.postcode ?? a.zipCode ?? a.plz, a.addressLocality ?? a.city ?? a.ort].filter(present).join(' ');
  return [street, place || (a.district ?? a.quarter)].filter(present).join(', ') || null;
}
const aliases: Record<string, string[]> = {
  warm_rent: ['warm_rent','warmRent','totalRentGross','grossRent','monthlyTotalRent','totalRent','monatlGesamtkosten'],
  cold_rent: ['cold_rent','coldRent','baseRent','netColdRent','netRent','basePrice','mietpreis'],
  heating_costs: ['heating_costs','heatingCosts','heatingCost','heizkosten'],
  additional_costs: ['additional_costs','additionalCosts','serviceCharge','ancillaryCosts','nebenkosten'],
  operating_costs: ['operating_costs','operatingCosts','betriebskosten'],
  deposit: ['deposit','securityDeposit','bailment','kaution'],
  rooms: ['rooms','numberOfRooms','totalRooms','anzahlZimmer'],
  area_sqm: ['area_sqm','livingSpace','floorSize','size','area','wohnflaeche'],
};
const words: Record<string,string[]> = {
  floor: ['floor','floorNumber','etage','storey'],
  property_type: ['apartmentType','flatType','property_type','propertyType','wohnungstyp'],
  move_in_date: ['move_in_date','moveInDate','einzugsdatum','bezugsdatum'],
  available_text: ['available_text','availableDate','availableStart','available_from','freeFrom'],
  deposit_text: ['deposit_text','depositText'],
};
function imageUrl(v: any, base: string): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.replace(/&amp;/g, '&').replace(/%WIDTH%/g,'1200').replace(/%HEIGHT%/g,'800'), base);
    if (!/^https?:$/.test(u.protocol) || /\.(?:svg|pdf)(?:[?#]|$)|(?:logo|favicon|sprite|spinner|placeholder|avatar)(?:[_.\/-]|$)/i.test(u.href)) return null;
    return u.href;
  } catch { return null; }
}
export function collectImages(v: any, base: string): string[] {
  const result: string[] = [];
  const add = (x: any) => {
    if (Array.isArray(x)) { for (const y of x) add(y); return; }
    if (typeof x === 'string') { const u = imageUrl(x,base); if(u && !result.includes(u)) result.push(u); return; }
    if (!x || typeof x !== 'object' || x.encrypted === true) return;
    const u = x.originalUrl ?? x.contentUrl ?? x.url ?? x.href ?? x.src ?? x.filename;
    if (u) add(u);
    else for (const key of ['images','image','pictures','picture','photos','photo','attachments','attachment','urls']) if (x[key]) add(x[key]);
  };
  for (const key of ['images','image','image_urls','imageUrls','imageUrl','imageURL','pictures','photos','attachments','gallery','media','titleImage','titlePictureUrls','teaserImage']) if (v?.[key]) add(v[key]);
  return result;
}
export function structuredFacts(raw: any, base: string): any {
  const r = raw || {}, h = r.provider === 'immosolve_hpm_rest' ? r.detail?.immoObject?.labels : null;
  const node = h || r.entry || r.listing || r.property?.data || r.property || r;
  const out: any = {};
  // Cost/area containers are known property containers, not arbitrary recursion.
  const containers = [node, node.costs, node.prices, node.attributes].filter(x=>x && typeof x==='object' && !Array.isArray(x));
  for (const [key, names] of Object.entries(aliases)) for (const c of containers) {
    if(names.some(name=>Object.hasOwn(c,name)) && !Object.hasOwn(out,key))out[key]=null;
    if (out[key] != null) break;
    for (const name of names) { const n = amount(c[name]); if (n != null) {out[key]=n;break;} }
  }
  for (const [key,names] of Object.entries(words)) for (const c of containers) {
    if (out[key] != null) break;
    for (const name of names) if (present(c[name])) {out[key]=String(c[name]);break;}
  }
  if (typeof node.heatingCosts === 'string' && /enthalten|inklusive/i.test(node.heatingCosts)) out.heating_text=node.heatingCosts;
  if(r.property?.data && amount(node.rooms)!=null && amount(node.halfRooms)!=null)out.rooms=amount(node.rooms)!+amount(node.halfRooms)!/2;
  const typeNames:Record<string,string>={RAISED_GROUND_FLOOR:'Hochparterre',GROUND_FLOOR:'Erdgeschosswohnung',ATTIC:'Dachgeschosswohnung',MAISONETTE:'Maisonette',PENTHOUSE:'Penthouse',APARTMENT:'Apartment',FLAT:'Wohnung'};
  if(out.property_type && typeNames[out.property_type])out.property_type=typeNames[out.property_type];
  const av = node.availableFrom ?? r.availableFrom;
  if (typeof av === 'string') out.available_text = textValue(av);
  else if (av) out.available_text = textValue(av.stringAvailable) ?? textValue(av.dateAvailable);
  out.available_text ??= textValue(r.available_text);
  if (!out.deposit_text && typeof node.deposit === 'string' && amount(node.deposit)==null) out.deposit_text=textValue(node.deposit);
  out.address = node.showAddress === false ? null : exactAddress(h || node.address || (r.provider === 'kleinanzeigen' ? r.location : null));
  if(node.heatingCostIncluded === true)out.heating_text = 'in den Nebenkosten enthalten';
  const images = [...collectImages(node,base),...collectImages(r,base)];
  if (h) {
    for (const im of r.detail?.images || []) {
      const u=imageUrl(im.filename,base); if(u)images.push(u);
    }
  }
  out.images=[...new Set(images)];
  return out;
}
function decode(s: string): string {
  return s.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,x)=>String.fromCodePoint(x[0].toLowerCase()==='x'?parseInt(x.slice(1),16):Number(x))).replace(/&(amp|lt|gt|quot|apos|nbsp|auml|ouml|uuml|szlig);/gi,(m,x)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',auml:'ä',ouml:'ö',uuml:'ü',szlig:'ß'}[x.toLowerCase()] || m)).trim();
}
const fieldLabels: Record<string,string> = {
  warmmiete:'warm_rent',bruttowarmmiete:'warm_rent',gesamtmiete:'warm_rent',kaltmiete:'cold_rent',nettokaltmiete:'cold_rent',grundmiete:'cold_rent',
  heizkosten:'heating_costs',nebenkosten:'additional_costs',betriebskosten:'operating_costs',kaution:'deposit',mietsicherheit:'deposit',
  zimmer:'rooms',zimmeranzahl:'rooms',wohnfläche:'area_sqm',fläche:'area_sqm',etage:'floor',geschoss:'floor',wohnungstyp:'property_type',wohnungsart:'property_type',
  einzugsdatum:'move_in_date',bezugsdatum:'move_in_date','verfügbar ab':'available_text','frei ab':'available_text',bezugsfrei:'available_text',objektadresse:'address',
};
export function htmlFacts(html: string, base: string): any {
  const out: any = {images:[]};
  const apply = (keyText:string,value:string) => {
    const key=fieldLabels[decode(keyText).toLowerCase().replace(/\s*:\s*$/,'').trim()];
    const val=decode(value);
    if(!key || !present(val))return;
    if(aliases[key]) {const n=amount(val); if(n!=null)out[key]=n; else if(key==='deposit')out.deposit_text=val; else if(key==='heating_costs' && /enthalten|inklusive/i.test(val))out.heating_text=val;}
    else out[key]=val;
  };
  // Explicit label/value pairs only. No street-name regex over descriptions.
  const clean=html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  for(const m of clean.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi))apply(m[1],m[2]);
  for(const m of clean.matchAll(/<tr\b[^>]*>\s*<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi))apply(m[1],m[2]);
  for(const m of clean.matchAll(/<li\b[^>]*class=["'][^"']*addetailslist--detail[^"']*["'][^>]*>([^<]*)<span\b[^>]*>([\s\S]*?)<\/span>\s*<\/li>/gi))apply(m[1],m[2]);
  for(const m of clean.matchAll(/<([a-z][a-z0-9]*)\b[^>]*class=["'][^"']*\bis24qa-([a-z-]+)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi)) {
    const names:any={'warmmiete':'Warmmiete','kaltmiete':'Kaltmiete','heizkosten':'Heizkosten','nebenkosten':'Nebenkosten','kaution':'Kaution','zimmer':'Zimmer','wohnflaeche-ca':'Wohnfläche','etage':'Etage','wohnungstyp':'Wohnungstyp','bezugsfrei-ab':'Verfügbar ab'};
    if(names[m[2]])apply(names[m[2]],m[3]);
  }
  const address=clean.match(/<([a-z][a-z0-9]*)\b[^>]*id=["']viewad-locality["'][^>]*>([\s\S]*?)<\/\1>/i);
  if(address && /kleinanzeigen\.de/.test(new URL(base).hostname))out.address=decode(address[2]);
  for(const m of clean.matchAll(/<(?:img|meta|div)\b[^>]*>/gi)) {
    const tag=m[0], attr=(name:string)=>tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1];
    // Only listing gallery/itemprop images and the page's explicit preview image.
    if(attr('property')==='og:image') {const u=imageUrl(attr('content'),base);if(u)out.images.push(u);}
    else if(attr('itemprop')==='image' || /(?:gallery|imagebox|expose-picture|listing-image)/i.test(attr('class')||'')) {
      const u=imageUrl(attr('data-imgsrc')||attr('data-src')||attr('data-original')||attr('src'),base);if(u)out.images.push(u);
    }
  }
  out.images=[...new Set(out.images)];
  return out;
}
