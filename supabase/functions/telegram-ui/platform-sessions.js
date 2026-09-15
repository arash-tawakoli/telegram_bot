import {db,SUPABASE_URL,secret,send,edit,button} from './runtime.js';

const privateOwner=(user,chat)=>chat?.type==='private'&&user.is_active
 && Number(chat.id)===Number(user.telegram_user_id)&&Number(chat.id)===Number(user.chat_id);

export async function applicationWorker(action,userId,source,extra={}){
 let response;
 try{
  response=await fetch(`${SUPABASE_URL}/functions/v1/application-worker`,{
   method:'POST',headers:{'Content-Type':'application/json','x-internal-secret':await secret('internal_worker_secret')},
   body:JSON.stringify({action,userId,source,...extra}),signal:AbortSignal.timeout(45000)});
 }catch{throw Error('Auto-Bewerbung ist gerade nicht erreichbar. Bitte erneut versuchen.');}
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result)throw Error(result?.error==='premium_required'?'Premium ist erforderlich.':'Plattformverbindung momentan nicht verfügbar.');
 return result;
}

// Kept under the old export name so admin cleanup remains compatible.
export async function purgePlatformSessions(userId){
 const {data,error}=await db.from('platform_connections').select('provider').eq('user_id',userId);
 if(error)throw Error('Plattformverbindungen konnten nicht geladen werden.');
 const sourceFor={immoscout:1,kleinanzeigen:2};
 for(const row of data||[]){
  const source=sourceFor[row.provider];
  if(source)await applicationWorker('disconnect',userId,source).catch(()=>{});
 }
 // Remove token-less providers and obsolete Browserbase state during user deletion.
 await db.from('platform_connections').delete().eq('user_id',userId);
 await db.from('platform_auth_flows').delete().eq('user_id',userId);
 await db.from('platform_sessions').delete().eq('user_id',userId).catch(()=>{});
}

const connectionLabel=row=>{
 if(!row)return '⚪ nicht verbunden';
 if(row.status==='connected')return '🟢 verbunden';
 if(row.status==='pending')return '🟡 Anmeldung offen';
 if(row.status==='needs_login')return '🟠 erneut anmelden';
 return '🔴 Fehler';
};

export async function platformSessions(user,chat,messageId,data='platforms'){
 if(!privateOwner(user,chat))return;
 const [,action,rawSource]=data.split(':'),source=Number(rawSource);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const back=[[button('← Plattformkonten','platforms')]];

 if(action==='profile'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  const result=await applicationWorker('profile_link',user.id,0);
  return render('👤 <b>Bewerberprofil</b>\n\nHinterlege deine Angaben einmalig. Unterstützte Plattformen verwenden diese Daten danach automatisch.',[[{text:'👤 Bewerberprofil öffnen',url:result.url}],...back]);
 }

 if(action==='login'||action==='disconnect'||action==='check'){
  if(![1,2].includes(source))return;
  if(action!=='disconnect'&&!user.is_premium)return render('Zum Verbinden ist Premium erforderlich.',back);
  const name=source===1?'ImmoScout24':'Kleinanzeigen';
  if(source===1&&action==='login')return render('ImmoScout24 wird erst freigeschaltet, wenn der kontrollierte Web-Session-/Send-Test bestätigt ist. Es wird keine offizielle ImmoScout-API vorausgesetzt.',back);
  try{
   const result=await applicationWorker(action,user.id,source);
   if(action==='disconnect')return render(`${name}: Verbindung gelöscht.`,back);
   if(action==='login'&&result.url){
    const note=result.requiresCallback?'Nach dem Login führst du die Verbindung einmalig auf der Bewerberprofil-Seite zu Ende. Danach erneuert der Server den Token automatisch.':'Melde dich einmalig an.';
    return render(`${name}: ${note}`,[[{text:`🔐 ${name} verbinden`,url:result.url}],...back]);
   }
   return render(result.authenticated===true?`${name}: ✅ Verbindung bestätigt.`:result.authenticated===false?`${name}: Anmeldung erforderlich.`:`${name}: Verbindung gespeichert, aber noch nicht vollständig verifiziert.`,back);
  }catch(error){return render(error.message,back);}
 }

 if(action==='off'){
  const {error}=await db.from('bot_users').update({auto_apply_enabled:false}).eq('id',user.id);
  if(error)throw Error('Auto-Bewerbung konnte nicht deaktiviert werden.');
 }
 if(action==='on'){
  if(!user.is_premium)return render('Auto-Bewerbungen benötigen aktives Premium.',back);
  const {error}=await db.from('bot_users').update({auto_apply_enabled:true}).eq('id',user.id);
  if(error)return render('Auto-Bewerbungen sind noch nicht freigegeben. Hinterlege zuerst dein Bewerberprofil; mindestens eine Plattform muss technisch verifiziert sein.',back);
 }

 const [{data:connections,error},{data:state,error:stateError},{data:applicant,error:applicantError},{data:verified,error:verifiedError}]=await Promise.all([
  db.from('platform_connections').select('provider,status,account_hint,last_verified_at,last_error').eq('user_id',user.id),
  db.from('bot_users').select('auto_apply_enabled').eq('id',user.id).single(),
  db.from('applicant_profiles').select('user_id').eq('user_id',user.id).maybeSingle(),
  db.schema('app_private').from('application_platforms').select('source_id,verified_at').not('verified_at','is',null)
 ]);
 if(error||stateError||applicantError||verifiedError)throw Error('Auto-Bewerbung konnte nicht geladen werden.');
 const scout=connections?.find(r=>r.provider==='immoscout'),klein=connections?.find(r=>r.provider==='kleinanzeigen');
 const verifiedIds=new Set((verified||[]).map(r=>Number(r.source_id)));
 const readiness=id=>verifiedIds.has(id)?'✅ Versand freigegeben':'🧪 Sendetest ausstehend';
 const text=`⚡ <b>Automatische Bewerbung</b>\n\n👤 Bewerberprofil: ${applicant?'✅ vorhanden':'⚠️ fehlt'}\n\nImmoScout24: ${connectionLabel(scout)} · ${readiness(1)}\nKleinanzeigen: ${connectionLabel(klein)} · ${readiness(2)}\nImmomio: 🟢 kein Login erforderlich · ${verifiedIds.size&&[...verifiedIds].some(id=>![1,2].includes(id))?'✅ Versand teilweise freigegeben':'🧪 Sendetest ausstehend'}\n\nAuto-Bewerbung: ${state.auto_apply_enabled?'✅ aktiv':'aus'}\n\nNach Freigabe einer Quelle werden passende Wohnungen ohne weiteres Ausfüllen oder Absenden automatisch beworben.`;
 const rows=[
  [button('👤 Bewerberprofil', 'platforms:profile')],
  ...(user.is_premium?[[button('🔐 Kleinanzeigen verbinden','platforms:login:2')],[button('Kleinanzeigen prüfen','platforms:check:2')]]:[]),
  ...(klein?[[button('Kleinanzeigen trennen','platforms:disconnect:2')]]:[]),
  [button('ImmoScout24 Status','platforms:check:1')],
  [button(state.auto_apply_enabled?'Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',`platforms:${state.auto_apply_enabled?'off':'on'}`)],
  [button('← Einstellungen','settings')]
 ];
 return render(text,rows);
}
