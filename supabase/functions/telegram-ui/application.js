import {db,send,telegram,secret,SUPABASE_URL} from './runtime.js';
import {quickApplyButton} from './application-message.js';

async function kickWorker(){
 try{await fetch(`${SUPABASE_URL}/functions/v1/application-worker`,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':await secret('internal_worker_secret')},body:JSON.stringify({action:'process'}),signal:AbortSignal.timeout(5000)});}catch{}
}

export async function quickApplication(user,query){
 const chat=query.message?.chat;
 if(chat?.type!=='private'||Number(chat.id)!==Number(user.telegram_user_id)||Number(chat.id)!==Number(user.chat_id)||!user.is_active)return;
 const id=String(query.data||'').slice('apply:'.length);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return send(chat.id,'Dieses Angebot ist nicht verfügbar.');
 const {data:deliveries,error:deliveryError}=await db.from('delivery_events').select('id').eq('recipient_user_id',user.id).eq('listing_id',id).limit(1);
 if(deliveryError)throw deliveryError;
 if(!deliveries?.length)return send(chat.id,'Bitte wähle eine dir zugestellte Wohnung.');
 const {data:listing,error}=await db.from('listings').select('id,source_id,title,is_active').eq('id',id).maybeSingle();
 if(error)throw error;
 if(!listing||!quickApplyButton(listing))return send(chat.id,'Dieses Angebot ist inaktiv oder unterstützt keine automatische Bewerbung.');
 const {data:existing,error:existingError}=await db.from('applications').select('status,submission_started_at,last_error').eq('user_id',user.id).eq('listing_id',id).maybeSingle();
 if(existingError)throw existingError;
 if(existing?.status==='sent')return send(chat.id,'✅ Diese Bewerbung wurde bereits automatisch versendet.');
 if(existing?.submission_started_at||existing?.status==='processing')return send(chat.id,'⏳ Diese Bewerbung wird bereits verarbeitet. Ein zweiter Versand ist gesperrt.');
 if(existing?.status==='manual_required')return send(chat.id,'⚠️ Der Versandstatus ist nicht eindeutig oder die Plattform verlangt eine erneute Verbindung. Die Bewerbung wird aus Sicherheitsgründen nicht automatisch wiederholt.');
 if(existing?.status==='pending'){EdgeRuntime.waitUntil(kickWorker());return send(chat.id,'⏳ Die Bewerbung ist bereits vorgemerkt und wird automatisch verarbeitet.');}
 const {data:applicationId,error:enqueueError}=await db.rpc('enqueue_application_now',{p_user:user.id,p_listing:id});
 if(enqueueError)throw enqueueError;
 if(!applicationId)return telegram('sendMessage',{chat_id:chat.id,text:'⚡ Automatische Bewerbung ist für dieses Angebot noch nicht freigegeben.\n\nPrüfe unter Einstellungen → Plattformkonten, ob dein Bewerberprofil vollständig ist und die jeweilige Plattform verbunden bzw. verifiziert ist.'});
 EdgeRuntime.waitUntil(kickWorker());
 return send(chat.id,'⏳ Bewerbung vorgemerkt. Der Bot füllt sie jetzt automatisch aus und sendet sie über die freigegebene Plattform.');
}
