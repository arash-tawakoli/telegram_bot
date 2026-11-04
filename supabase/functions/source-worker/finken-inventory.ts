import {Candidate,Connector,Source,db,fetchText,iso,markFailure,markSuccess,upsertCandidates} from './shared.ts';

export function parseFinkenInventory(text:string){
  const rows=JSON.parse(text);if(!Array.isArray(rows))throw new Error('Finkenwaerder inventory schema missing');const candidates:Candidate[]=[];
  for(const x of rows){
    if(!x.id||!x.city||!x.postalcode)throw new Error('Finkenwaerder apartment schema missing');
    if(x.city.toLowerCase()!=='hamburg'||!/^2\d{4}$/.test(String(x.postalcode))||!(Number(x.numberOfRooms)>0))continue;
    if(!/^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f-]{36}$/i.test(x.applicationLink))throw new Error('Finkenwaerder application identity missing');
    candidates.push({key:x.id,url:x.applicationLink,title:x.altText||'Wohnung '+x.street,address:[x.street,x.houseNumber,x.postalcode,'Hamburg'].filter(Boolean).join(' '),district:x.district,zip:x.postalcode,cold:Number(x.baseRent)||null,rooms:Number(x.numberOfRooms)||null,area:Number(x.overallSpace)||null,raw:{provider:'finkenwaerder_public_api',provider_entity:'Finkenwärder-Hoffnung',applicationLink:x.applicationLink,...((x.providerObjectRef||x.objectReference||x.reference||x.externalId||x.objectNumber||x.refId)?{provider_object_ref:String(x.providerObjectRef||x.objectReference||x.reference||x.externalId||x.objectNumber||x.refId)}:{})}});
  }
  return {candidates,enumerated:rows.length,complete:true};
}

export async function runPublicInventory(source:Source,connector:Connector) {
  const started=iso();
  try{
    if(String(connector.config?.adapter||'')!=='source-worker/finken-public')throw new Error('Unsupported public inventory adapter');
    const response=await fetchText(String(connector.config?.url||''));
    const parsed=parseFinkenInventory(response.text);
    const {data:state}=await db.from('source_coverage_state').select('cursor').eq('source_id',source.id).maybeSingle().throwOnError();
    const warmed=!!source.baseline_completed_at&&state?.cursor?.adapter==='source-worker/finken-public'&&state?.cursor?.url===connector.config.url;
    const fresh=parsed.candidates.filter(()=>warmed);
    const blocked=parsed.candidates.filter(c=>!fresh.includes(c));
    const a=await upsertCandidates(source,fresh,true),b=await upsertCandidates(source,blocked,false);
    const provider='finkenwaerder_public_api';
    if(parsed.complete){
      const {data:active}=await db.from('listings').select('id,source_listing_key').eq('source_id',source.id).eq('is_active',true).eq('raw->>provider',provider).throwOnError();
      const keys=new Set(parsed.candidates.map(c=>String(c.key)));
      const stale=(active||[]).filter((r:any)=>!keys.has(String(r.source_listing_key))).map((r:any)=>r.id);
      if(stale.length)await db.from('listings').update({is_active:false}).in('id',stale).throwOnError();
    }
    await db.from('source_coverage_state').upsert({source_id:source.id,cycle_id:crypto.randomUUID(),strategy:'verified_public_inventory',status:'complete',cursor:{adapter:'source-worker/finken-public',url:connector.config.url},seen_count:parsed.enumerated,request_count:1,cycle_started_at:started,cycle_finished_at:iso(),last_complete_at:iso(),updated_at:iso(),last_error:null}).throwOnError();
    await markSuccess(source,started,connector,parsed.candidates.length,a.fresh+b.fresh,{adapter:'source-worker/finken-public',complete:true,enumerated:parsed.enumerated,verified_empty:parsed.enumerated===0,fallback_warmed:warmed});
    return {ok:true,source_id:source.id,fetched:parsed.candidates.length,new:a.fresh,complete:true};
  }catch(error){return markFailure(source,started,error);}
}