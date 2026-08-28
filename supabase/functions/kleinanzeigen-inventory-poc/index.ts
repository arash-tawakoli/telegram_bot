import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BASE = "https://www.kleinanzeigen.de";
const ROOT = "/s-wohnung-mieten/hamburg/c203l9409";
const UA = "Mozilla/5.0 (compatible; TraumWohnungHamburg inventory validation)";

function abs(v: string) { try { return new URL(v, BASE).href; } catch { return v; } }
function strip(s: string) { return s.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&auml;/gi,"ä").replace(/&ouml;/gi,"ö").replace(/&uuml;/gi,"ü").replace(/&szlig;/gi,"ß").replace(/\s+/g," ").trim(); }
async function get(url: string) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 12000);
  try { const r = await fetch(url,{redirect:"follow",signal:c.signal,headers:{"user-agent":UA,"accept":"text/html,application/xhtml+xml","accept-language":"de-DE,de;q=0.9"}}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return {html:await r.text(),url:r.url}; } finally { clearTimeout(t); }
}
function offerCount(html:string) {
  const text=strip(html);
  const patterns=[/(\d[\d.]*)\s+Angebote\b/i,/Angebote\s*\((\d[\d.]*)\)/i,/1\s*-\s*25\s+von\s+(\d[\d.]*)/i];
  for(const p of patterns){const m=text.match(p);if(m)return Number(m[1].replace(/\./g,""));}
  return null;
}
function ids(html:string){return [...html.matchAll(/<article\b[^>]*\bdata-adid=["'](\d+)["'][^>]*\bdata-href=["']([^"']+)["']/gi)].map(m=>({id:m[1],url:abs(m[2])}));}
function pageUrl(page:number){return page<=1?`${BASE}${ROOT}`:`${BASE}/s-seite:${page}/wohnung-mieten/hamburg/c203l9409`;}

Deno.serve(async(req)=>{
  try{
    if(req.method!=="POST") return Response.json({ok:false,error:"POST required"},{status:405});
    const body=await req.json().catch(()=>({}));
    const maxPages=Math.max(1,Math.min(Number(body.max_pages||5),20));
    const first=await get(pageUrl(1));
    const root=offerCount(first.html);
    const pages=root?Math.ceil(root/25):null;
    const seen=new Map<string,string>(); const perPage:any[]=[];
    for(let p=1;p<=maxPages;p++){
      const r=p===1?first:await get(pageUrl(p)); const rows=ids(r.html); let added=0;
      for(const x of rows){if(!seen.has(x.id)){seen.set(x.id,x.url);added++;}}
      perPage.push({page:p,raw_ids:rows.length,new_unique:added,url:r.url});
      if(rows.length===0) break;
      if(p<maxPages) await new Promise(res=>setTimeout(res,250));
    }
    return Response.json({ok:true,mode:"isolated_poc_no_db_writes",root_offers:root,expected_pages:pages,requested_max_pages:maxPages,pages_tested:perPage.length,raw_ids:perPage.reduce((a,x)=>a+x.raw_ids,0),unique_ids:seen.size,duplicates:perPage.reduce((a,x)=>a+x.raw_ids,0)-seen.size,coverage_root:root?Number((seen.size/root*100).toFixed(3)):null,per_page:perPage,sample:[...seen.entries()].slice(0,10).map(([id,url])=>({id,url}))});
  }catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500});}
});
