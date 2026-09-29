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
  warm_rent: ['warm_rent','warmRent','totalRentGross','grossRent','monthlyTotalRent','totalRent','monatlGesamtkosten','grossMonthlyRent'],
  cold_rent: ['cold_rent','coldRent','baseRent','netColdRent','netRent','basePrice','mietpreis','nettoKaltmiete'],
  heating_costs: ['heating_costs','heatingCosts','heatingCost','heizkosten','heatingFee'],
  additional_costs: ['additional_costs','additionalCosts','serviceCharge','ancillaryCosts','nebenkosten','serviceCosts','utilityCosts'],
  operating_costs: ['operating_costs','operatingCosts','betriebskosten','operatingCharge'],
  deposit: ['deposit','securityDeposit','bailment','kaution','depositAmount'],
  rooms: ['rooms','numberOfRooms','totalRooms','anzahlZimmer'],
  area_sqm: ['area_sqm','livingSpace','floorSize','size','area','wohnflaeche'],
};
const words: Record<string,string[]> = {
  floor: ['floor','floorNumber','etage','storey'],
  property_type: ['apartmentType','flatType','property_type','propertyType','wohnungstyp','objectType','estateType'],
  move_in_date: ['move_in_date','moveInDate','einzugsdatum','bezugsdatum'],
  available_text: ['available_text','availableDate','availableStart','available_from','freeFrom','availableFromText'],
  deposit_text: ['deposit_text','depositText'],
};
function imageUrl(v: any, base: string): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.replace(/&amp;/g, '&').replace(/%WIDTH%/g,'1200').replace(/%HEIGHT%/g,'800'), base);
    if ((u.pathname === '/' && !u.search) || u.href === new URL(base).href || !/^https?:$/.test(u.protocol) || /\.(?:svg|pdf)(?:[?#]|$)|(?:logo|favicon|sprite|spinner|placeholder|avatar)(?:[_.\/-]|$)/i.test(u.href)) return null;
    return u.href;
  } catch { return null; }
}
export function imageIdentity(url:string):string {
  const u=new URL(url);
  if(u.hostname==='pictures.immobilienscout24.de')return u.origin+(u.pathname.match(/^\/listings\/[^/]+/)?.[0]||u.pathname);
  if(u.hostname==='img.kleinanzeigen.de')return u.origin+u.pathname;
  return url;
}
export function collectImages(v: any, base: string): string[] {
  const result: string[] = [];
  const add = (x: any) => {
    if (Array.isArray(x)) { for (const y of x) add(y); return; }
    if (typeof x === 'string') { const u = imageUrl(x,base); if(u && !result.some(old=>imageIdentity(old)===imageIdentity(u))) result.push(u); return; }
    if (!x || typeof x !== 'object' || x.encrypted === true) return;
    const u = x.fullSizePictureUrl ?? x.originalUrl ?? x.original ?? x.contentUrl ?? x.url ?? x.href ?? x.src ?? x.filename;
    if (u) add(u);
    else for (const key of ['images','image','pictures','picture','photos','photo','attachments','attachment','urls','gallery']) if (x[key]) add(x[key]);
  };
  for (const key of ['images','image','image_urls','imageUrls','imageUrl','imageURL','pictures','photos','attachments','gallery','media','titleImage','titlePictureUrls','teaserImage']) if (v?.[key]) add(v[key]);
  return result;
}
export function structuredFacts(raw: any, base: string): any {
  const r = raw || {}, h = r.provider === 'immosolve_hpm_rest' ? r.detail?.immoObject?.labels : null;
  const node = h || r.entry || r.listing || r.property?.data || r.property || r;
  const out: any = {};
  if (present(r.provider_entity)) out.provider_entity = String(r.provider_entity);
  if (present(r.provider_object_ref)) out.provider_object_ref = String(r.provider_object_ref);
  if (present(r.saga_object_ref)) out.saga_object_ref = String(r.saga_object_ref);
  if (present(r.applicationLink)) out.applicationLink = String(r.applicationLink);
  let sourceHostname='';
  try{sourceHostname=new URL(base).hostname}catch{}
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
  const typeNames:Record<string,string>={
    RAISED_GROUND_FLOOR:'Hochparterre',
    GROUND_FLOOR:'Erdgeschosswohnung',
    ROOF_STOREY:'Dachgeschosswohnung',
    ATTIC:'Dachgeschosswohnung',
    FLOOR:'Etagenwohnung',
    MAISONETTE:'Maisonette',
    PENTHOUSE:'Penthouse',
    APARTMENT:'Apartment',
    FLAT:'Wohnung',
    LOFT:'Loft',
    SOUTERRAIN:'Souterrainwohnung',
    TERRACE_FLAT:'Terrassenwohnung'
  };
  if(out.property_type && typeNames[out.property_type])out.property_type=typeNames[out.property_type];
  if(r.property?.data && out.floor != null && /^9\d$/.test(String(out.floor).trim()))delete out.floor;
  const av = node.availableFrom ?? r.availableFrom;
  if (typeof av === 'string') out.available_text = textValue(av);
  else if (av) out.available_text = textValue(av.stringAvailable) ?? textValue(av.dateAvailable);
  out.available_text ??= textValue(r.available_text);
  out.district=textValue(node.address?.quarter ?? node.address?.neighborhood ?? node.address?.stadtteil ?? node.address?.district ?? node.neighborhood ?? node.stadtteil ?? node.district ?? node.quarter);
  out.borough=textValue(node.address?.borough ?? node.address?.bezirk ?? node.borough ?? node.bezirk);
  out.published_text=textValue(node.datePosted ?? node.datePublished ?? node.publishedAt);
  const features=node.features ?? node.amenities ?? node.equipment ?? r.catalog_amenities;
  if(Array.isArray(features))out.features=features.map(x=>textValue(typeof x==='object'?(x?.name ?? x?.label ?? x?.title):x)).filter(Boolean);
  else if(typeof features==='string' && present(features))out.features=[features];
  if(typeof node.furnished==='boolean')out.furnished=node.furnished;
  if (!out.deposit_text && typeof node.deposit === 'string' && amount(node.deposit)==null) out.deposit_text=textValue(node.deposit);
  out.address = node.showAddress === false ? null : exactAddress(h || node.address || (r.provider === 'kleinanzeigen' ? r.location : null));
  if(!out.address && (node.streetAddress||node.street||node.strasse||node.postalCode||node.postcode||node.zipCode||node.plz||node.addressLocality||node.city||node.ort)){
    out.address=exactAddress(node);
  }
  if(r.provider==='ohne_makler' && (r.streetAddress||r.postalCode||r.addressLocality)){
    out.address=exactAddress({streetAddress:r.streetAddress,postalCode:r.postalCode,addressLocality:r.addressLocality});
  }
  if(node.heatingCostIncluded === true)out.heating_text = 'in den Nebenkosten enthalten';

  if(/(^|\.)wg-gesucht\.de$/i.test(sourceHostname) && typeof r.text==='string'){
    const text=r.text.replace(/\s+/g,' ').trim();
    const available=text.match(/\bVerfügbar:\s*(.+?)(?=\s+Diese Anzeige|\s+<img|$)/i)?.[1]?.trim();
    if(!out.available_text && present(available))out.available_text=available;
    const place=text.match(/\|\s*Hamburg\s+([^|]{2,60}?)\s*\|\s*([^|]{2,100}?)\s+Verfügbar:/i);
    if(place){
      if(!out.district)out.district=textValue(place[1]);
      if(!out.address)out.address=[textValue(place[2]),textValue(place[1])?'Hamburg '+textValue(place[1]):'Hamburg'].filter(Boolean).join(', ');
    }
    if(/\bmöbliert\b/i.test(text))(out.features??=[]).push('möbliert');
    if(/\bunmöbliert\b/i.test(text))(out.features??=[]).push('unmöbliert');
  }

  if(r.provider==='immosolve_hpm_rest' && h){
    const extra:Record<string,string>={};
    const put=(label:string,value:any)=>{const v=textValue(value);if(v)extra[label]=v;};
    put('Baujahr',h.baujahr);
    put('Heizungsart',h.heizungsart);
    put('Energieträger',h.primaereBefeuerungsart);
    put('Energieeffizienzklasse',h.energieeffizienzklasse);
    put('Endenergiebedarf',h.endEnergieBedarf);
    put('Stellplatz',h.stellplatz);
    put('Stellplatzmiete',h.mietpreisStellplatz);
    put('Genossenschaftsanteile',h.anteile);
    if(Object.keys(extra).length)out.extra_facts={...(out.extra_facts||{}),...extra};
    const featureValues:string[]=[];
    const specialties=textValue(r.detail?.specialties);
    if(specialties)featureValues.push(...specialties.split(',').map((x:string)=>x.trim()).filter(Boolean));
    const equipment=textValue(r.detail?.descriptions?.ausstattungsbeschreibung);
    if(equipment)featureValues.push(...equipment.split(/[,;\n]+/).map((x:string)=>x.trim()).filter(Boolean));
    if(featureValues.length)out.features=[...new Set([...(out.features||[]),...featureValues])];
  }

  if((r.provider==='nestpick_public_api'||r.provider==='wunderflats_catalog') && present(r.minimum_stay)){
    out.extra_facts={...(out.extra_facts||{}),'Mindestmietdauer':String(r.minimum_stay)};
  }

  if(r.provider==='nestpick_public_api'){
    const extra:Record<string,string>={};
    const put=(label:string,value:any)=>{const v=textValue(value);if(v)extra[label]=v;};
    put('Verfügbar ab',r.available_from);
    put('Mindestmietdauer',r.minimum_stay);
    put('Anbieter',r.partner);
    if(Object.keys(extra).length)out.extra_facts={...(out.extra_facts||{}),...extra};
    if(Array.isArray(r.amenities)){
      const amenityLabels:Record<string,string>={
        internet:'Internet',
        wifi:'WLAN',
        washing_machine:'Waschmaschine',
        dishwasher:'Geschirrspüler',
        equipped_kitchen:'Einbauküche',
        kitchen:'Küche',
        oven:'Backofen',
        microwave:'Mikrowelle',
        elevator:'Aufzug',
        lift:'Aufzug',
        tv:'TV',
        balcony:'Balkon',
        terrace:'Terrasse',
        parking:'Stellplatz',
        dryer:'Trockner',
        air_conditioning:'Klimaanlage'
      };
      const rawAmenityNames=new Set(r.amenities.map((x:any)=>textValue(typeof x==='object'?(x?.name??x?.label):x)).filter(Boolean).map((x:string)=>x.toLowerCase()));
      const mapped=r.amenities.map((x:any)=>{
        const value=textValue(typeof x==='object'?(x?.name??x?.label):x);
        return value ? (amenityLabels[value.toLowerCase()]||value.replace(/_/g,' ')) : null;
      }).filter(Boolean);
      const existing=(out.features||[]).filter((x:any)=>!rawAmenityNames.has(String(x).toLowerCase()));
      out.features=[...new Set([...existing,...mapped])];
    }
  }
  if (r.provider === 'immowelt') {
    const card = [textValue(r.title), textValue(r.alt)].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    const rawAlt = String(r.alt || '');
    const type = card.match(/\b(Studio|Wohnung|Apartment|Maisonette|Penthouse|Loft|Dachgeschosswohnung|Erdgeschosswohnung)\s+zur Miete\b/i)?.[1];
    if (!out.property_type && type) out.property_type = type;
    const floorForward = card.match(/\bGeschoss\s+(\d+(?:\/\d+)?)\b/i)?.[1];
    const floorOrdinal = card.match(/\b(\d+\.)\s*Geschoss\b/i)?.[1];
    if (!out.floor && (floorForward || floorOrdinal)) out.floor = floorForward || `${floorOrdinal} Geschoss`;
    const available = card.match(/\bfrei ab\s+(sofort|\d{2}\.\d{2}\.\d{4}|nach Vereinbarung)\b/i)?.[1];
    if (!out.available_text && available) out.available_text = available;
    if (!out.address && rawAlt) {
      const location = rawAlt.match(/\b\d+(?:[.,]\d+)?\s*m²(?:\s+(?:Geschoss\s+\d+(?:\/\d+)?|\d+\.\s*Geschoss))?(?:\s+frei ab\s+(?:sofort|\d{2}\.\d{2}\.\d{4}|nach Vereinbarung))?\s+(.+?)\s+Hamburg\s+(2\d{4})$/i);
      if (location) {
        const remainder=location[1].trim().replace(/^(?:Geschoss\s+\d+(?:\/\d+)?|\d+\.\s*Geschoss)\s+/i,'');
        const knownDistrict=remainder.match(/\s([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,30})$/)?.[1]||null;
        if(knownDistrict && !out.district)out.district=knownDistrict;
        const street=knownDistrict?remainder.slice(0,-knownDistrict.length).trim():remainder;
        out.address=[street,location[2]+' Hamburg'].filter(Boolean).join(', ');
      } else {
        const zip = rawAlt.match(/\b(2\d{4})\s*$/)?.[1];
        if (zip) out.address = zip+' Hamburg';
      }
    }
  }
  const images = [...collectImages(node,base),...collectImages(r,base)];
  if (h) {
    for (const im of r.detail?.images || []) {
      const u=imageUrl(im.filename,base); if(u)images.push(u);
    }
  }
  out.images=collectImages({images},base);
  return out;
}
function decode(s: string): string {
  return s.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,x)=>String.fromCodePoint(x[0].toLowerCase()==='x'?parseInt(x.slice(1),16):Number(x))).replace(/&(amp|lt|gt|quot|apos|nbsp|auml|ouml|uuml|szlig|euro);/gi,(m,x)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',auml:'ä',ouml:'ö',uuml:'ü',szlig:'ß',euro:'€'}[x.toLowerCase()] || m)).trim();
}
const fieldLabels: Record<string,string> = {
  bezirk:'borough',stadtteil:'district',wohnlage:'district',
  warmmiete:'warm_rent',bruttowarmmiete:'warm_rent',gesamtmiete:'warm_rent','monatliche gesamtmiete':'warm_rent',bruttomiete:'warm_rent',
  kaltmiete:'cold_rent',nettokaltmiete:'cold_rent',grundmiete:'cold_rent','netto-kaltmiete':'cold_rent',
  heizkosten:'heating_costs',nebenkosten:'additional_costs','nebenkosten ohne heizkosten':'additional_costs',betriebskosten:'operating_costs',
  kaution:'deposit',mietsicherheit:'deposit','kaution / genoss.-anteile':'deposit_or_coop','kaution o. genossenschaftsanteile':'deposit_or_coop',
  zimmer:'rooms',zimmeranzahl:'rooms',wohnfläche:'area_sqm',fläche:'area_sqm',
  etage:'floor',geschoss:'floor',stockwerk:'floor',
  wohnungstyp:'property_type',wohnungsart:'property_type',objekttyp:'property_type',immobilientyp:'property_type',
  einzugsdatum:'move_in_date',bezugsdatum:'move_in_date','verfügbar ab':'available_text','frei ab':'available_text',bezugsfrei:'available_text','mietbeginn':'available_text',
  objektadresse:'address',adresse:'address','veröffentlicht am':'published_text',ausstattung:'features',merkmale:'features',
};
function jsonObjectAfter(text:string, marker:RegExp):any {
  const match=marker.exec(text);if(!match)return null;
  const start=match.index+match[0].length;let depth=0,quoted=false,escape=false;
  for(let i=start;i<text.length;i++){
    const c=text[i];
    if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(text.slice(start,i+1))}catch{return null;}}
  }return null;
}
export function htmlFacts(html: string, base: string): any {
  const out: any = {images:[]};
  const apply = (keyText:string,value:string) => {
    const key=fieldLabels[decode(keyText).toLowerCase().replace(/\s*:\s*$/,'').trim()];
    const val=decode(value);
    if(!key || !present(val))return;
    if(aliases[key]) {const n=amount(val); if(n!=null)out[key]=n; else if(key==='deposit')out.deposit_text=val; else if(key==='heating_costs' && /enthalten|inklusive/i.test(val))out.heating_text=val;}
    else if(key==='deposit_or_coop')(out.extra_facts??={})['Kaution / Genossenschaftsanteile']=val;
    else if(key==='features')out.features=[...(out.features||[]),val];
    else out[key]=val;
  };
  // Explicit label/value pairs only. No street-name regex over descriptions.
  const clean=html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const pageText=decode(clean.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
  const providerRules:Array<[string,RegExp,RegExp?]>=[
    ['SAGA',/(?:Vermietungshotline der\s+)?SAGA Unternehmensgruppe/i,/\b(MO\s*\d{4}\s*\/\s*[A-Za-z0-9.-]+\s*\/\s*[A-Za-z0-9.-]+)\b/i],
    ['Finkenwärder-Hoffnung',/(?:Baugenossenschaft\s+)?Finkenw(?:ä|ae)rder[-\s]+Hoffnung(?:\s+eG)?/i],
    ['GEWOBA Nord',/GEWOBA\s+Nord(?:\s+Baugenossenschaft(?:\s+eG)?)?/i],
    ['NEUE LÜBECKER',/NEUE\s+LÜBECKER(?:\s+Norddeutsche\s+Baugenossenschaft(?:\s+eG)?)?/i],
    ['Bauverein Reiherstieg',/Bauverein\s+Reiherstieg(?:\s+eG)?/i],
    ['VHW',/(?:Vereinigte\s+Hamburger\s+Wohnungsbaugenossenschaft|\bVHW\b)(?:\s+eG)?/i],
    ['mgf Gartenstadt Farmsen',/(?:mgf\s+)?Gartenstadt\s+Farmsen(?:\s+eG)?/i],
    ['HARABAU',/(?:Hamburg[-\s]+Rahlstedter\s+Baugenossenschaft|\bHARABAU\b)(?:\s+eG)?/i],
    ['Baugenossenschaft der Buchdrucker',/Baugenossenschaft\s+der\s+Buchdrucker(?:\s+eG)?/i],
    ['FLUWOG-NORDMARK',/(?:Baugenossenschaft\s+)?FLUWOG[-\s]*NORDMARK(?:\s+eG)?/i],
    ['Gartenstadt Hamburg',/(?:Wohnungsgenossenschaft\s+)?Gartenstadt\s+Hamburg(?:\s+eG)?/i],
    ['WG von 1904',/(?:Wohnungsgenossenschaft\s+von\s+1904|\bWG\s+von\s+1904\b)(?:\s+eG)?/i],
    ['WHW 1897',/(?:Wohnungsgenossenschaft\s+Hamburg[-\s]*Wandsbek\s+von\s+1897|\bWHW\s*1897\b)/i],
    ['ADLERSHORST',/ADLERSHORST\s+Baugenossenschaft(?:\s+eG)?/i],
    ['Wohnwarft eG',/Wohnwarft(?:\s+eG)?/i],
    ['Falkenried-Terrassen',/(?:Baugenossenschaft\s+)?Falkenried[-\s]+Terrassen(?:\s+eG)?/i],
  ];
  const labelledRef=pageText.match(/\b(?:Objektreferenz|Referenznummer|Objektnummer|Objekt[-\s]?(?:Nr\.?|ID)|Angebotsnummer)\s*:?\s*([A-Za-z0-9][A-Za-z0-9./_-]{3,80})/i)?.[1]||null;
  const linkText=html
    .replace(/\\u003a/gi,':')
    .replace(/\\u002f/gi,'/')
    .replace(/\\\//g,'/')
    .replace(/&#x3a;|&#58;/gi,':')
    .replace(/&#x2f;|&#47;/gi,'/')
    .replace(/&amp;/gi,'&')
    .replace(/\\u0026/gi,'&');
  const directApplication=linkText.match(/https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?/i)?.[0]||null;
  const encodedApplication=html.match(/https%3a%2f%2ftenant\.immomio\.com%2f(?:de%2f)?apply%2f[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}%2f?/i)?.[0]||null;
  let application=directApplication;
  if(!application&&encodedApplication){
    try{application=decodeURIComponent(encodedApplication)}catch{}
  }
  if(application)out.applicationLink=application;
  for(const [entity,provider,refPattern] of providerRules){
    if(!provider.test(pageText))continue;
    out.provider_entity=entity;
    const rawRef=refPattern?.exec(pageText)?.[1]||labelledRef;
    if(rawRef){
      const normalized=rawRef.toUpperCase().replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ').trim();
      out.provider_object_ref=normalized;
      if(entity==='SAGA')out.saga_object_ref=normalized;
    }
    if(application)out.applicationLink=application;
    break;
  }
  for(const m of clean.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi))apply(m[1],m[2]);
  for(const m of clean.matchAll(/<tr\b[^>]*>\s*<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi))apply(m[1],m[2]);
  for(const m of clean.matchAll(/<li\b[^>]*class=["'][^"']*addetailslist--detail[^"']*["'][^>]*>([^<]*)<span\b[^>]*>([\s\S]*?)<\/span>\s*<\/li>/gi))apply(m[1],m[2]);
  for(const m of clean.matchAll(/<([a-z][a-z0-9]*)\b[^>]*class=["'][^"']*\bis24qa-([a-z-]+)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi)) {
    const names:any={'warmmiete':'Warmmiete','kaltmiete':'Kaltmiete','heizkosten':'Heizkosten','nebenkosten':'Nebenkosten','kaution':'Kaution','zimmer':'Zimmer','wohnflaeche-ca':'Wohnfläche','etage':'Etage','wohnungstyp':'Wohnungstyp','typ':'Wohnungstyp','bezugsfrei-ab':'Verfügbar ab','gesamtmiete':'Warmmiete','kaution-o-genossenschaftsanteile':'Kaution'};
    if(names[m[2]])apply(names[m[2]],m[3]);
  }
  const hostname = new URL(base).hostname;
  if(hostname==='www.immobilienscout24.de'){
    const gallery=jsonObjectAfter(html,/\bgalleryData:\s*/);
    if(gallery?.images)out.images.push(...collectImages({images:gallery.images},base));
  }
  if(/(^|\.)kleinanzeigen\.de$/.test(hostname)){
    for(const m of clean.matchAll(/<li\b[^>]*class=["']checktag["'][^>]*>([\s\S]*?)<\/li>/gi)){
      const value=decode(m[1]);if(present(value))(out.features??=[]).push(value);
    }
  }
  const extraLabels:Record<string,string>={
    'schlafzimmer':'Schlafzimmer','badezimmer':'Badezimmer','haustiere':'Haustiere','baujahr':'Baujahr',
    'objektzustand':'Objektzustand','zustand':'Objektzustand','qualität der ausstattung':'Qualität der Ausstattung',
    'energieausweis':'Energieausweis','heizungsart':'Heizungsart','wesentliche energieträger':'Wesentliche Energieträger',
    'energieträger':'Energieträger','energieeffizienzklasse':'Energieeffizienzklasse','endenergieverbrauch':'Endenergieverbrauch',
    'endenergiebedarf':'Endenergiebedarf','miete für garage/stellplatz':'Miete für Garage/Stellplatz',
    'stellplatz':'Stellplatz','personen':'Personen','max. personen':'Max. Personen','mindestmietdauer':'Mindestmietdauer'
  };
  for(const m of clean.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)){
    const rawKey=decode(m[1]).replace(/\s*:\s*$/,'').trim(),value=decode(m[2]),label=extraLabels[rawKey.toLowerCase()];
    if(label&&present(value))(out.extra_facts??={})[label]=value;
  }
  if (/(^|\.)ohne-makler\.net$/i.test(hostname)) {
    const h1End=clean.search(/<\/h1>/i);
    const scoped=decode(clean.slice(h1End>=0?h1End+5:0).replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
    const location=scoped.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'’-]*(?:\s+[A-Za-zÄÖÜäöüß.'’-]+){0,4}\s+\d+[a-zA-Z]?)\s*,\s*(2\d{4})\s+Hamburg(?:\s*\(([^)]+)\))?/i);
    if(location){
      out.address=location[1].trim()+', '+location[2]+' Hamburg';
      if(!out.district && present(location[3]))out.district=location[3].trim();
    }
  }
  if (/(^|\.)immowelt\.de$/i.test(hostname)) {
    const text = decode(clean.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
    const rentSection = text.match(/\bMietkosten\b([\s\S]*?)(?=\bLage\b|\bWeitere Services\b|$)/i)?.[1] || '';
    const rentLabels = ['Warmmiete','Gesamtmiete','Kaltmiete','Nettokaltmiete','Nebenkosten','Betriebskosten','Heizkosten','Kaution'];
    const stop = rentLabels.join('|')+'|Miete pro Stellplatz|Stellplatzmiete';
    for (const labelText of rentLabels) {
      const scope=rentSection||text;
      const part = scope.match(new RegExp(labelText+'\\s+([\\s\\S]*?)(?='+stop+'|$)','i'))?.[1];
      if (!part) continue;
      const values = [...part.matchAll(/([\d.]+(?:,\d{1,2})?)\s*€(?!\s*\/\s*m²)/gi)];
      const value = values.at(-1)?.[1];
      if (value) apply(labelText, value+' €');
    }
    if(/Heizkosten[^.]{0,80}(?:in (?:den )?Nebenkosten enthalten|inklusive|enthalten)/i.test(rentSection||text))
      out.heating_text='in den Nebenkosten enthalten';
    const floorForward = text.match(/\bGeschoss\s+(\d+(?:\/\d+)?)\b/i)?.[1];
    const floorOrdinal = text.match(/\b(\d+)\.\s*Geschoss(?:\/(\d+)\s*Geschossen)?\b/i);
    if (!out.floor && floorForward) out.floor = floorForward;
    else if (!out.floor && floorOrdinal) out.floor = `${floorOrdinal[1]}. Geschoss${floorOrdinal[2] ? `/${floorOrdinal[2]}` : ''}`;
    const available = text.match(/\bfrei ab\s+(sofort|\d{2}\.\d{2}\.\d{4}|nach Vereinbarung)\b/i)?.[1];
    if (!out.available_text && available) out.available_text = available;
    const propertyType = text.match(/\b(Studio|Wohnung|Apartment|Maisonette|Penthouse|Loft|Dachgeschosswohnung|Erdgeschosswohnung)\s+zur Miete\b/i)?.[1];
    if (!out.property_type && propertyType) out.property_type = propertyType;
    const locationSection = text.match(/\bLage\b([\s\S]*?)(?=\bWeitere Services\b|$)/i)?.[1] || '';
    const location = locationSection.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9 .,'’\/-]{1,80}?)\s*\((2\d{4})\)/);
    if (!out.address && location) out.address = `${location[1].trim()} (${location[2]})`;
  }
  const address=clean.match(/<([a-z][a-z0-9]*)\b[^>]*id=["']viewad-locality["'][^>]*>([\s\S]*?)<\/\1>/i);
  if(address && /kleinanzeigen\.de/.test(hostname))out.address=decode(address[2]);
  for(const m of clean.matchAll(/<(?:img|meta|div)\b[^>]*>/gi)) {
    const tag=m[0], attr=(name:string)=>tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1];
    // Only listing gallery/itemprop images and the page's explicit preview image.
    if(attr('property')==='og:image') {const u=imageUrl(attr('content'),base);if(u)out.images.push(u);}
    else if((/(^|\.)kleinanzeigen\.de$/.test(hostname)&&attr('data-imgsrc')) || attr('itemprop')==='image' || /(?:gallery|imagebox|expose-picture|listing-image)/i.test(attr('class')||'')) {
      const u=imageUrl(attr('data-imgsrc')||attr('data-src')||attr('data-original')||attr('src'),base);if(u)out.images.push(u);
    }
  }
  out.images=collectImages({images:out.images},base);
  return out;
}
