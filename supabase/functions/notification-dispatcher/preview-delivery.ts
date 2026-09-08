import {TelegramFailure} from './telegram-request.ts';
export function previewOperations(images:string[],caption:string,keyboard:any,maxImages:number=Infinity) {
  const selectedImages=images.slice(0,Math.max(0,maxImages));
  const operations:any[]=[];
  // Preserve every validated source image; Telegram albums accept at most ten items.
  // Conservative HTML-source length also covers decoded Telegram caption length.
  if(selectedImages.length===1 && caption.length<=1000) return [{method:'sendPhoto',body:{photo:selectedImages[0],caption,parse_mode:'HTML',reply_markup:keyboard}}];
  for(let i=0;i<selectedImages.length;i+=10) {
    const batch=selectedImages.slice(i,i+10);
    operations.push(batch.length===1 ? {method:'sendPhoto',body:{photo:batch[0]}} : {method:'sendMediaGroup',body:{media:batch.map(media=>({type:'photo',media}))}});
  }
  const chunks:string[]=[]; let chunk='';
  for(const line of caption.split('\n')) {
    if(line.length>3800) throw new Error('Source field exceeds Telegram text limit');
    if(chunk && chunk.length+line.length+1>3800){chunks.push(chunk);chunk='';}
    chunk+=(chunk?'\n':'')+line;
  }
  if(chunk)chunks.push(chunk);
  for(let i=0;i<chunks.length;i++)operations.push({method:'sendMessage',body:{text:chunks[i],parse_mode:'HTML',disable_web_page_preview:true,...(i===chunks.length-1?{reply_markup:keyboard}:{})}});
  return operations;
}
export async function deliverPreview(operations:any[],previous:any,save:(state:any)=>Promise<void>,request:(operation:any,upload?:boolean)=>Promise<any>,pause=()=>new Promise(r=>setTimeout(r,1100))) {
  // Freeze the source snapshot per delivery, including ordering, through retries.
  let state:any = previous?.version===1 ? structuredClone(previous) : {version:1,operations,next:0,in_flight:false,message_id:null};
  if(state.in_flight)throw new TelegramFailure('Previous gallery request has an unknown outcome',true);
  const started=Date.now();
  while(state.next<state.operations.length){
    if(Date.now()-started>40000)throw new TelegramFailure('Gallery delivery will continue from its checkpoint',false,false,1);
    const op=state.operations[state.next];
    state.in_flight=true;await save(state);
    let response:any;
    try {
      try { response=await request(op); }
      catch(error) {
        if(!(error instanceof TelegramFailure) || !error.allowImageFallback || !['sendPhoto','sendMediaGroup'].includes(op.method))throw error;
        response=await request(op,true);
      }
    } catch(error) {
      if(!(error instanceof TelegramFailure) || !error.outcomeUnknown){state.in_flight=false;await save(state);}
      throw error;
    }
    state.next++;state.in_flight=false;
    state.message_id=Array.isArray(response)?response[0]?.message_id:response?.message_id;
    try {await save(state);} catch {throw new TelegramFailure('Telegram accepted the gallery step but its checkpoint could not be saved',true);}
    if(state.next<state.operations.length)await pause();
  }
  return {message_id:state.message_id};
}
