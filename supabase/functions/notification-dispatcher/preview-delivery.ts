import {TelegramFailure} from './telegram-request.ts';
export async function sourcePhoto(response:Response):Promise<Blob> {
  if(!response.ok)throw new TelegramFailure(`Source image HTTP ${response.status}`,false,true);
  const bytes=new Uint8Array(await response.arrayBuffer());
  const matches=(offset:number,signature:number[])=>signature.every((b,i)=>bytes[offset+i]===b);
  // Immomio/S3 can serve genuine photos as application/octet-stream.
  // Trust supported image signatures, never a misleading Content-Type or file extension.
  const type=matches(0,[255,216,255])?'image/jpeg':matches(0,[137,80,78,71,13,10,26,10])?'image/png':
    (matches(0,[71,73,70,56,55,97])||matches(0,[71,73,70,56,57,97]))?'image/gif':
    (matches(0,[82,73,70,70])&&matches(8,[87,69,66,80]))?'image/webp':null;
  if(!type||bytes.length>10*1024*1024)throw new TelegramFailure('Source image returned unsupported or oversized image data',false,true);
  return new Blob([bytes],{type});
}
function listingKeyboard(keyboard:any,caption:string) {
  const rows=Array.isArray(keyboard?.inline_keyboard)?keyboard.inline_keyboard:[];
  if(!rows.length)return keyboard;
  const offer=rows[0];
  const save=rows.find((row:any[])=>row.some((button:any)=>{
    const callback=String(button?.callback_data||''),text=String(button?.text||'');
    return callback.startsWith('save:')||/^(?:⭐\s*)?(?:Speichern|Gespeichert|Save|Saved)$/.test(text);
  }));
  if(!save)return keyboard;
  const middle=rows.filter((row:any[])=>row!==offer&&row!==save);
  const mapRow=middle.find((row:any[])=>row.some((button:any)=>{
    const text=String(button?.text||''),url=String(button?.url||'');
    return text.includes('Google Map')||url.includes('google.com/maps/');
  }));
  const autoApplyRow=middle.find((row:any[])=>row.some((button:any)=>String(button?.callback_data||'')==='platforms'));
  const clean=(value:string)=>value.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').trim();
  const locationLine=caption.split('\n').map(clean).reverse().find(line=>line.startsWith('📍'));
  const location=(locationLine||'').replace(/^📍\s*(?:[^:]+:\s*)?/,'').trim()||'Hamburg';
  const maps=mapRow||[{text:'🗺️ Google Map',url:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}];
  const autoApply=autoApplyRow||[{text:'⚡ Auto-Bewerbung',callback_data:'platforms'}];
  return {...keyboard,inline_keyboard:[offer,save,maps,autoApply]};
}
export function previewOperations(images:string[],caption:string,keyboard:any) {
  keyboard=listingKeyboard(keyboard,caption);
  const selectedImages=images.slice(0,1);
  const operations:any[]=[];
  // The preview deliberately sends one validated source photo; retain all text facts.
  // Conservative HTML-source length also covers decoded Telegram caption length.
  if(selectedImages.length===1 && caption.length<=1000) return [{method:'sendPhoto',body:{photo:selectedImages[0],caption,parse_mode:'HTML',reply_markup:keyboard}}];
  if(selectedImages.length)operations.push({method:'sendPhoto',body:{photo:selectedImages[0]}});
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
  // Unstarted legacy galleries can adopt the new single-photo policy on retry.
  // After any confirmed photo step, keep remaining text but send no further photos.
  if(previous?.version===1){
    if(state.next===0)state.operations=operations;
    else if(state.operations.slice(0,state.next).some((op:any)=>['sendPhoto','sendMediaGroup'].includes(op.method)))
      state.operations=[...state.operations.slice(0,state.next),...state.operations.slice(state.next).filter((op:any)=>!['sendPhoto','sendMediaGroup'].includes(op.method))];
  }
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
        try {response=await request(op,true);}
        catch(uploadError){
          // Only a confirmed image rejection may degrade to text. Unknown Telegram
          // outcomes and transient transport failures must never trigger a second send.
          if(!(uploadError instanceof TelegramFailure) || uploadError.outcomeUnknown || !uploadError.allowImageFallback || op.method!=='sendPhoto')throw uploadError;
          state.in_flight=false;
          if(op.body.caption){
            state.operations[state.next]={method:'sendMessage',body:{text:op.body.caption,parse_mode:op.body.parse_mode,reply_markup:op.body.reply_markup,disable_web_page_preview:true}};
          }else{
            state.operations.splice(state.next,1);
          }
          await save(state);
          continue;
        }
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
