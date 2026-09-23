// Online is evidence of an advertised offer, never a landlord's availability guarantee.
export function recentInventory(l:any, now=Date.now()) {
  const age=now-Date.parse(l.last_seen_at);
  const maxAge=Number(l.source_id)===6 ? 60*60*1000 : 10*60*1000;
  if(!l.is_active || !l.fresh_delivery_eligible || !Number.isFinite(age) || age<0 || age>maxAge)return false;
  const r=l.raw||{};
  return [6,10,19].includes(Number(l.source_id)) ||
    (Number(l.source_id)===1 && r.provider==='immoscout_mcp' && (['fresh_global','fresh_borough','coverage_proven','map_delta'].includes(r.delivery_lane))) ||
    (r.provider==='kleinanzeigen' && r.native_offer===true && r.lane==='fast') ||
    (Number(l.source_id)===3 && r.provider==='immowelt') ||
    r.provider==='immosolve_hpm_rest';
}
export function pageAvailability(status:number, same:boolean, html:string) {
  if(status===404||status===410)return 'unavailable';
  if(status<200||status>=300)return 'unknown';
  if(!same)return 'unknown';
  const headings=[...html.matchAll(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/gi)].map(m=>m[1].replace(/<[^>]*>/g,' ')).join(' ');
  if(/(?:anzeige|inserat|angebot|expos[eé]|wohnung)\s+(?:ist\s+|wurde\s+)?(?:leider\s+)?(?:nicht mehr (?:verfügbar|vorhanden|online)|gelöscht|deaktiviert|bereits vermietet)|(?:anzeige|inserat|angebot)\s+nicht gefunden|404\s*[-–:]?\s*(?:not found|nicht gefunden)/i.test(headings))return 'unavailable';
  if(/captcha|cf-chl-|access denied|verify you are human/i.test(headings+html.slice(0,12000)))return 'unknown';
  return headings.trim() ? 'online' : 'unknown';
}
