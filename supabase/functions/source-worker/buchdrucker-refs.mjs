const APPLY_RE=/https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/?(?:[?#][^\s"'<>\\]*)?)?/ig;
const RDR_RE=/https:\/\/rdr\.immomio\.com\/[A-Za-z0-9_-]{3,128}(?:\/?(?:[?#][^\s"'<>\\]*)?)?/ig;

export function normalizeBuchdruckerApply(value){
  if(!value)return null;
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.hostname!=='tenant.immomio.com'||u.port||u.username||u.password)return null;
    const m=u.pathname.match(/^\/(?:de\/)?apply\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
    if(!m)return null;
    return 'https://tenant.immomio.com/apply/'+m[1].toLowerCase();
  }catch{return null}
}
export function normalizeBuchdruckerRedirect(value){
  if(!value)return null;
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.hostname!=='rdr.immomio.com'||u.port||u.username||u.password)return null;
    if(!/^\/[A-Za-z0-9_-]{3,128}\/?$/.test(u.pathname))return null;
    u.search='';u.hash='';
    return u.href;
  }catch{return null}
}
export function extractBuchdruckerApplicationRefs(text){
  const applies=[...new Set((String(text||'').match(APPLY_RE)||[]).map(normalizeBuchdruckerApply).filter(Boolean))];
  const redirects=[...new Set((String(text||'').match(RDR_RE)||[]).map(normalizeBuchdruckerRedirect).filter(Boolean))];
  return {applies,redirects};
}
export function countBuchdruckerFeedItems(text){
  if(!/<rss\b/i.test(String(text||''))||!/<channel\b/i.test(String(text||'')))return null;
  return [...String(text).matchAll(/<item\b[^>]*>[\s\S]*?<\/item>/gi)].length;
}
