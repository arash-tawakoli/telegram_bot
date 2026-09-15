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

// Export name retained for admin.js compatibility while Browserbase state is retired.
export async function purgePlatformSessions(userId){
 const {data,error}=await db.from('platform_connections').select('provider').eq('user_id',userId);
 if(error)throw Error('Plattformverbindungen konnten nicht geladen werden.');
 const sourceFor={immoscout:1,kleinanzeigen:2};
 for(const row of data||[]){const source=sourceFor[row.provider];if(source)await applicationWorker('disconnect',userId,source).catch(()=>{});}
 await db.from('platform_connections').delete().eq('user_id',userId);
 await db.from('platform_auth_flows').delete().eq('user_id',userId);
 await db.from('platform_sessions').delete().eq('user_id',userId).catch(()=>{});
}

const connectionLabel=row=>{
 if(!row)return '⚪ nicht verbunden';
 if(row.status==='connected')return '🟢 verbunden';
 if(row.status==='pending')return '🟡 Anmeldung noch nicht abgeschlossen';
 if(row.status==='needs_login')return '🟠 erneut anmelden';
 return '🔴 Fehler';
};

export async function platformSessions(user,chat,messageId,data='platforms'){
 if(!privateOwner(user,chat))return;
 const [,action,rawSource]=data.split(':'),source=Number(rawSource);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const back=[[button('← Automatische Bewerbung','platforms')]];

 if(action==='profile'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  const result=await applicationWorker('profile_link',user.id,0);
  return render('👤 <b>Bewerberprofil</b>\n\nHinterlege deine Bewerberdaten einmalig. Danach werden diese Angaben bei unterstützten Plattformen automatisch verwendet.',[[{text:'👤 Bewerberprofil öffnen',url:result.url}],...back]);
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
    const note=result.requiresCallback
     ? 'Melde dich einmalig bei Kleinanzeigen an. Falls danach auf dem iPhone die Seite „Die Anmeldung konnte nicht abgeschlossen werden“ erscheint, kopiere dort über das Teilen-Symbol die vollständige URL. Öffne anschließend dein Bewerberprofil, füge diese URL im Feld „Callback-URL“ ein und tippe auf „Verbindung abschließen“. Danach bleibt die Verbindung gespeichert.'
     : 'Melde dich einmalig an. Danach bleibt die Verbindung gespeichert.';
    return render(`${name}: ${note}`,[[{text:`🔐 ${name} jetzt verbinden`,url:result.url}],...back]);
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

 const [{data:connections,error},{data:state,error:stateError},{data:applicant,error:applicantError}]=await Promise.all([
  db.from('platform_connections').select('provider,status,account_hint,last_verified_at,last_error').eq('user_id',user.id),
  db.from('bot_users').select('auto_apply_enabled').eq('id',user.id).single(),
  db.from('applicant_profiles').select('user_id').eq('user_id',user.id).maybeSingle()
 ]);
 if(error||stateError||applicantError)throw Error('Auto-Bewerbung konnte nicht geladen werden.');
 const scout=connections?.find(r=>r.provider==='immoscout'),klein=connections?.find(r=>r.provider==='kleinanzeigen');
 const text=`⚡ <b>Automatische Bewerbung</b>\n\n👤 Bewerberprofil: ${applicant?'✅ vorhanden':'⚠️ fehlt'}\n\n<b>Plattformen</b>\nKleinanzeigen: ${connectionLabel(klein)} · 🧪 Sendetest ausstehend\nImmoScout24: ${connectionLabel(scout)} · 🧪 Sendetest ausstehend\nImmomio: 🟢 kein Login erforderlich · 🧪 Sendetest ausstehend\n\nAuto-Bewerbung: ${state.auto_apply_enabled?'✅ aktiv':'aus'}\n\nFür Kleinanzeigen meldest du dich nur einmal an. Danach soll der Versand vollständig automatisch im Hintergrund laufen; du musst keine Nachricht selbst schreiben oder absenden.`;
 const rows=[
  [button('👤 Bewerberprofil','platforms:profile')],
  ...(user.is_premium?[[button('🔐 Kleinanzeigen einmalig verbinden','platforms:login:2')],[button('✅ Kleinanzeigen-Verbindung prüfen','platforms:check:2')]]:[]),
  ...(klein?[[button('Kleinanzeigen trennen','platforms:disconnect:2')]]:[]),
  [button(state.auto_apply_enabled?'Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',`platforms:${state.auto_apply_enabled?'off':'on'}`)],
  [button('← Einstellungen','settings')]
 ];
 return render(text,rows);
}
