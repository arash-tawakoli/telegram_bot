import {db,send} from './runtime.js';

export async function quickApplication(user,query){
 const chat=query.message?.chat;
 if(chat?.type!=='private'||Number(chat.id)!==Number(user.telegram_user_id)||Number(chat.id)!==Number(user.chat_id)||!user.is_active)return;
 const id=String(query.data||'').slice('apply:'.length);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return send(chat.id,'Dieses Angebot ist nicht verfügbar.');
 if(!user.is_premium)return send(chat.id,'⚡ Vollautomatische Bewerbungen benötigen Premium.');

 const [{data:deliveries,error:deliveryError},{data:saved,error:savedError}]=await Promise.all([
  db.from('delivery_events').select('id').eq('recipient_user_id',user.id).eq('listing_id',id).limit(1),
  db.from('saved_listings').select('id').eq('user_id',user.id).eq('listing_id',id).limit(1)
 ]);
 if(deliveryError||savedError)throw deliveryError||savedError;
 if(!deliveries?.length&&!saved?.length)return send(chat.id,'Bitte wähle eine dir zugestellte oder gespeicherte Wohnung.');

 const {data:listing,error:listingError}=await db.from('listings').select('id,source_id,title,is_active,raw').eq('id',id).maybeSingle();
 if(listingError)throw listingError;
 if(!listing?.is_active)return send(chat.id,'Dieses Angebot ist nicht mehr aktiv.');

 const {data:existing,error:applicationError}=await db.from('applications').select('id,status,submission_started_at,last_error').eq('user_id',user.id).eq('listing_id',id).maybeSingle();
 if(applicationError)throw applicationError;
 if(existing?.status==='sent')return send(chat.id,'✅ Diese Bewerbung wurde bereits automatisch versendet.');
 if(existing?.submission_started_at)return send(chat.id,'⚠️ Der Versand wurde bereits gestartet. Zur Sicherheit wird keine zweite Bewerbung ausgelöst.');
 if(existing?.status==='pending'||existing?.status==='processing')return send(chat.id,'⏳ Diese Bewerbung ist bereits zur automatischen Verarbeitung vorgemerkt.');

 const {data:profile,error:profileError}=await db.from('applicant_profiles').select('user_id').eq('user_id',user.id).maybeSingle();
 if(profileError)throw profileError;
 if(!profile)return send(chat.id,'👤 Für die vollautomatische Bewerbung fehlt noch dein Bewerberprofil.',{inline_keyboard:[[{text:'👤 Bewerberprofil einrichten',callback_data:'platforms:profile'}],[{text:'⚡ Automatische Bewerbung',callback_data:'platforms'}]]});

 const {data:applicationId,error:enqueueError}=await db.rpc('enqueue_application_now',{p_user:user.id,p_listing:id});
 if(enqueueError)throw enqueueError;
 if(!applicationId){
  const provider=Number(listing.source_id)===1?'ImmoScout24':Number(listing.source_id)===2?'Kleinanzeigen':String(listing.raw?.applicationLink||'').includes('tenant.immomio.com')?'Immomio':'diese Quelle';
  return send(chat.id,`🧪 Der vollautomatische Versand für ${provider} ist noch nicht produktiv freigegeben. Es wird keine manuelle Bewerbung ausgelöst.`);
 }
 return send(chat.id,'⚡ Bewerbung vorgemerkt. Sie wird vollständig automatisch verarbeitet; du musst nichts ausfüllen oder absenden.');
}
