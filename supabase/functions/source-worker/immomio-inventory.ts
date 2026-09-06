import {Connector} from './shared.ts';
const GQL='https://gql-hp.immomio.com/homepage/graphql';
const QUERY=`query propertyList($input: HomepagePropertySearchRequest!) { propertyList(input:$input){ page{page size totalElements totalPages} nodes{name totalRooms size totalRentGross externalId wbs applicationLink objectId propertyType marketingType status address{city street houseNumber zipCode district} availableFrom{dateAvailable stringAvailable} titleImage{url}}}}`;
function tokenFrom(url:string){try{const u=new URL(url);return u.hostname==='homepage.immomio.com'?u.searchParams.get('token'):null}catch{return null}}
function tenant(token:string|null){try{return String(JSON.parse(atob(String(token).split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).customerId||'')}catch{return ''}}
export function validateImmomioPage(j:any,page:number){
  const l=j?.data?.propertyList,p=l?.page;
  if(j?.errors?.length||!p||!Array.isArray(l.nodes))throw new Error('Immomio incomplete response');
  if(!Number.isInteger(p.page)||p.page!==page||!Number.isInteger(p.totalElements)||p.totalElements<0||!Number.isInteger(p.totalPages)||p.totalPages<0||p.totalPages>50||!Number.isInteger(p.size)||p.size<1||p.totalPages!==Math.ceil(p.totalElements/p.size))throw new Error('Immomio pagination invalid');
  if(l.nodes.length!==Math.min(p.size,Math.max(0,p.totalElements-page*p.size)))throw new Error('Immomio truncated page');
  return l;
}
export async function fetchImmomioInventory(primary:Connector,fallbacks:Connector[],resolve:(url:string)=>Promise<string>){
  const attempts:any[]=[],expected=tenant(tokenFrom(String(primary.config?.url||''))),tried=new Set<string>();
  for(const c of [primary,...fallbacks.filter(c=>c.connector_kind==='immomio_tenant'&&!c.shadow_only)]){
    const target=String(c.config?.url||'');if(tried.has(target))continue;tried.add(target);const begin=Date.now();
    try{
      const token=tokenFrom(await resolve(target));if(!token)throw new Error('Immomio token missing');
      if(expected&&tenant(token)!==expected)throw new Error('Immomio fallback tenant mismatch');
      const nodes:any[]=[],seen=new Set<string>();let total=0,totalPages=1;
      for(let page=0;page<totalPages;page++){
        const r=await fetch(GQL,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({query:QUERY,variables:{input:{page,size:250,token,sort:['created,desc'],marketingType:'RENT'}}}),signal:AbortSignal.timeout(12000)});
        if(!r.ok)throw new Error(`Immomio HTTP ${r.status}`);
        const l=validateImmomioPage(await r.json(),page);
        if(page&&(l.page.totalElements!==total||Math.max(1,l.page.totalPages)!==totalPages))throw new Error('Immomio inventory changed during pagination');
        total=l.page.totalElements;totalPages=Math.max(1,l.page.totalPages);
        for(const n of l.nodes){const key=String(n.objectId||n.externalId||'');if(!key||seen.has(key))throw new Error('Immomio missing or duplicate listing identity');seen.add(key);nodes.push(n)}
      }
      attempts.push({priority:c.priority,status:'ok',duration_ms:Date.now()-begin});
      return {nodes,total,totalPages,picked:c,attempts};
    }catch(e){attempts.push({priority:c.priority,status:'error',duration_ms:Date.now()-begin,error:e instanceof Error?e.message:String(e)})}
  }
  throw new Error(attempts.map(a=>`P${a.priority}: ${a.error}`).join('; ')||'Immomio no usable connector');
}
