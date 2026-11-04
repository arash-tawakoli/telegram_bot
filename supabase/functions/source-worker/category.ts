import {Source,db} from './shared.ts';
import {runScoutCategory} from './scout.ts';
import {runImmoweltCategory} from './generic.ts';
import {isAllowedSearchSource} from './search-policy.ts';

async function finish(stream:any,success:boolean,result:any,error:string|null){
  const {data, error:rpcError}=await db.rpc('finish_source_category_stream',{
    p_source_id:stream.source_id,p_category:stream.category,p_token:stream.lease_token,p_success:success,
    p_cursor:result?.cursor||stream.cursor||{},p_requests:Number(result?.requests||0),p_candidates:Number(result?.candidates||0),p_error:error
  });
  if(rpcError||data!==true)throw new Error('finish_source_category_stream failed: '+(rpcError?.message||'lease lost'));
}

export async function runCategoryStreams(source:Source){
  if(!isAllowedSearchSource(source.id))return [];
  const {data:streams,error}=await db.rpc('claim_source_category_streams',{p_source_id:source.id});
  if(error)throw error;
  const out:any[]=[];
  for(const stream of streams||[]){
    try{
      let result:any;
      if(stream.adapter==='scout')result=await runScoutCategory(source,stream);
      else if(stream.adapter==='immowelt')result=await runImmoweltCategory(source,stream);
      else throw new Error('unsupported retained category adapter '+stream.adapter);
      const parsedCount=Number(result?.cursor?.parsed??result?.cursor?.opens??0);
      if(Number(result?.candidates||0)===0&&parsedCount>0&&result?.cursor?.verified_empty!==true){
        throw new Error(stream.adapter+' '+stream.category+' parser saw '+parsedCount+' cards but accepted zero; refusing baseline approval');
      }
      await finish(stream,true,result,null);
      out.push({category:stream.category,adapter:stream.adapter,ok:true,...result});
    }catch(e){
      const message=e instanceof Error?e.message:String(e);
      try{await finish(stream,false,null,message)}catch(finishError){console.error('category_finish',String(finishError))}
      out.push({category:stream.category,adapter:stream.adapter,ok:false,error:message});
    }
  }
  return out;
}