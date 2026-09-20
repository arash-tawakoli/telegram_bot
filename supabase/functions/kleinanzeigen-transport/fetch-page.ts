const UA='Mozilla/5.0 (compatible; TraumwohnungHamburgBot/13.0; +https://traumwohnunghamburg.de)';

export async function fetchListingPage(raw: string, signal?: AbortSignal): Promise<Response> {
  try {
    const url=new URL(raw);
    if(url.protocol!=='https:' || url.hostname!=='www.kleinanzeigen.de' || url.port || url.username || url.password || !/^\/s-(?:wohnung-mieten|haus-mieten|auf-zeit-wg)\//.test(url.pathname))
      return new Response('invalid target',{status:400});
    const response=await fetch(url.href,{
      redirect:'follow',
      headers:{'user-agent':UA,accept:'text/html,application/xhtml+xml,*/*','accept-language':'de-DE,de;q=0.9','cache-control':'no-cache'},
      signal:AbortSignal.any([AbortSignal.timeout(12000),...(signal?[signal]:[])]),
    });
    const html=await response.text();
    signal?.throwIfAborted();
    return new Response(html,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-upstream-status':String(response.status),'x-upstream-url':response.url}});
  } catch(error) {
    return new Response(error instanceof Error?error.message:String(error),{status:502,headers:{'cache-control':'no-store'}});
  }
}
