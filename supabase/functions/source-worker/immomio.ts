import {Candidate,Connector,Source,absolute,db,fetchText,hhZip,iso,markFailure,markSuccess,upsertCandidates} from './shared.ts';
import {fetchImmomioInventory} from './immomio-inventory.ts';

function tokenFrom(u:string){
  try{return new URL(u).searchParams.get('token')}catch{return null}
}

async function resolve(u:string){
  if(tokenFrom(u))return u;
  const p=await fetchText(u);
  const m=p.text.match(/(?:src|href)=["']([^"']*homepage\.immomio\.com[^"']+)["']/i)?.[1];
  if(m){const x=absolute(p.url,m);if(x&&tokenFrom(x))return x}
  const ajax=p.text.match(/data-ajaxurl=["']([^"']+)["']/i)?.[1];
  if(ajax){
    const au=absolute(p.url,ajax);
    if(au){
      const r=await fetch(au,{method:'POST',headers:{'accept':'text/html','cache-control':'no-cache','content-type':'application/x-www-form-urlencoded; charset=UTF-8','cookie':'waconcookiemanagement=max','user-agent':'Mozilla/5.0'},body:'',signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw new Error('Immomio consent HTTP '+r.status);
      const h=await r.text(),e=h.match(/(?:src|href)=["']([^"']*homepage\.immomio\.com[^"']+)["']/i)?.[1];
      if(e){const x=absolute(au,e);if(x&&tokenFrom(x))return x}
    }
  }
  throw new Error('Immomio homepage token not found');
}

function geoName(value:any){
  return String(value||'').normalize('NFKC').toLocaleLowerCase('de-DE').trim();
}

export async function runImmomio(source:Source,c:Connector,fallbacks:Connector[]=[]){
  const started=iso();
  try{
    const {nodes,total,totalPages,picked,attempts}=await fetchImmomioInventory(c,fallbacks,resolve);
    const [{data:allAreas,error:geoError},{data:aliases,error:aliasError}]=await Promise.all([
      db.rpc('get_schleswig_holstein_areas'),
      db.rpc('get_schleswig_holstein_area_aliases')
    ]);
    if(geoError)throw geoError;
    if(aliasError)throw aliasError;
    const shAreas=(allAreas||[]).filter((row:any)=>row.area_type==='municipality');
    const shByName=new Map<string,any[]>(),shByCode=new Map<string,any>();
    for(const row of shAreas){
      const key=geoName(row.name),items=shByName.get(key)||[];
      items.push(row);
      shByName.set(key,items);
      shByCode.set(String(row.area_code),row);
    }
    for(const alias of aliases||[]){
      const municipality=shByCode.get(String(alias.area_code));
      if(!municipality)continue;
      const key=geoName(alias.alias),items=shByName.get(key)||[];
      if(!items.some((row:any)=>String(row.area_code)===String(municipality.area_code)))items.push(municipality);
      shByName.set(key,items);
    }
    const located=(nodes||[]).map((node:any)=>{
      const city=String(node.address?.city||'').trim();
      const zip=String(node.address?.zipCode||'');
      if(city.toLocaleLowerCase('de-DE')==='hamburg'&&hhZip(zip)){
        return {node,geo:{stateCode:'HH' as const,city:'Hamburg',area:null}};
      }
      const matches=shByName.get(geoName(city))||[];
      const area=matches.length===1?matches[0]:null;
      if(area&&/^\d{5}$/.test(zip)){
        return {node,geo:{stateCode:'SH' as const,city,area}};
      }
      return {node,geo:null};
    });
    const valid=located.filter(({node,geo}:any)=>
      !!geo&&node.propertyType==='FLAT'&&node.marketingType==='RENT'&&node.status!=='RENTED'&&
      /^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f-]{36}$/i.test(String(node.applicationLink||''))
    );
    const cs:Candidate[]=valid.map(({node:n,geo}:any)=>{
      const zip=String(n.address?.zipCode||'');
      return {
        key:String(n.objectId||n.externalId),
        url:n.applicationLink,
        title:n.name,
        address:[n.address?.street,n.address?.houseNumber].filter(Boolean).join(' ')+(zip?', '+zip+' '+geo.city:''),
        city:geo.city,
        stateCode:geo.stateCode,
        adminRegionCode:geo.area?.parent_code||null,
        municipalityCode:geo.area?.area_code||null,
        district:n.address?.district,
        zip,
        warm:Number(n.totalRentGross)||null,
        rooms:Number(n.totalRooms)||null,
        area:Number(n.size)||null,
        available:n.availableFrom?.dateAvailable,
        type:'Wohnung',
        wbs:!!n.wbs,
        image:n.titleImage?.url,
        raw:{...n,provider:'immomio',provider_entity:source.name,provider_object_ref:String(n.externalId||n.objectId||''),applicationLink:n.applicationLink,object_id:n.objectId,external_id:n.externalId,status:n.status,address:n.address,availableFrom:n.availableFrom}
      };
    });
    const saved=await upsertCandidates(source,cs,true);
    if(source.baseline_completed_at){
      const keys=cs.map(x=>String(x.key));
      const {data:old}=await db.from('listings').select('id,source_listing_key,raw').eq('source_id',source.id).eq('is_active',true).throwOnError();
      const stale=(old||[]).filter((x:any)=>x.raw?.provider==='immomio'&&!keys.includes(String(x.source_listing_key))).map((x:any)=>x.id);
      if(stale.length)await db.from('listings').update({is_active:false}).in('id',stale).throwOnError();
    }
    const shCount=cs.filter(x=>x.stateCode==='SH').length;
    await markSuccess(source,started,picked,cs.length,saved.fresh,{strategy:'tenant_api',total_elements:total,total_pages:totalPages,complete:true,verified_empty:cs.length===0,connector_attempts:attempts,schleswig_holstein_candidates:shCount});
    return {ok:true,source_id:source.id,fetched:cs.length,new:saved.fresh,schleswig_holstein:shCount};
  }catch(e){return markFailure(source,started,e)}
}
