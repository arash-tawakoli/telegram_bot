import {db,SUPABASE_URL,secret,send,edit,button} from './runtime.js';
import {privateApplicant} from './dossier-rules.js';

export async function applicationWorker(action,userId,source){
 let response;try{response=await fetch(`${SUPABASE_URL}/functions/v1/application-worker`,{method:'POST',
  headers:{'Content-Type':'application/json','x-internal-secret':await secret('internal_worker_secret')},
  body:JSON.stringify({action,userId,source}),signal:AbortSignal.timeout(45000)});}catch{throw Error('Die Plattform antwortet gerade nicht. Bitte erneut versuchen; ein bereits gestartetes Anmeldefenster wird wiederverwendet.');}
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result)throw Error(result?.error==='session_busy'?'Eine Sitzung läuft noch. Bitte in Kürze erneut versuchen.':'Plattformverbindung momentan nicht verfügbar. Bitte erneut versuchen.');
 return result;
}
export async function purgePlatformSessions(userId){
 const {data,error}=await db.from('platform_sessions').select('source_id').eq('user_id',userId);
 if(error)throw Error('Plattformverbindungen konnten nicht geladen werden.');
 for(const row of data||[]){const result=await applicationWorker('disconnect',userId,row.source_id);if(result.status!=='disconnected')throw Error('Die Plattformsitzung wird noch verwendet. Bitte später erneut löschen.');}
}
export async function platformSessions(user,chat,messageId,data='platforms'){
 if(!privateApplicant(user,chat))return;
 const [,action,rawSource]=data.split(':'),source=Number(rawSource);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 /** @type {Array<Array<{text:string,callback_data?:string,url?:string}>>} */
 const back=[[button('← Plattformkonten','platforms')]];
 if(action==='login'||action==='disconnect'||action==='check'){
  if(![1,2].includes(source))return;
  if(action!=='disconnect'&&!user.is_premium)return render('Zum Verbinden ist Premium erforderlich.',back);
  // Each operation has its own card: concurrent platform clicks cannot overwrite
  // another platform's personal login link or a menu opened in the meantime.
  const name=source===1?'ImmoScout24':'Kleinanzeigen';
  const progress=await send(chat.id,`${name}: ${action==='login'?'Anmeldefenster wird vorbereitet …':action==='check'?'Verbindung wird geprüft …':'Sitzung wird getrennt …'}`,{inline_keyboard:back});
  const finish=(text,rows=back)=>progress?.message_id?edit(chat.id,progress.message_id,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
  let result;
  try{result=await applicationWorker(action,user.id,source);}catch(error){return finish(error.message);}
  if(result.status==='busy')return finish(`${name}: Die Sitzung wird noch verwendet. Bitte in ${Math.max(1,Math.ceil(result.retryAfter||10))} Sekunden erneut versuchen.`);
  if(result.status==='login')return finish(`${name}: ${result.reused?'Dein Anmeldefenster ist bereits geöffnet.':'Dein Anmeldefenster ist bereit; die Plattformseite lädt gegebenenfalls noch kurz.'}\n\nÖffne den Button und melde dich dort selbst an. Das Fenster bleibt noch etwa ${Math.max(1,Math.floor(result.expiresIn||100))} Sekunden offen. Prüfe die Verbindung nach Ende des Anmeldefensters.\n\nDer Link ist persönlich; bitte nicht weitergeben. Passwörter nicht an den Bot senden.`,[[{text:`🔐 ${name} öffnen`,url:result.url}],...back]);
  if(action==='disconnect')return finish('Plattformsitzung gelöscht.');
  return finish(result.authenticated===true?'Anmeldung bestätigt.':result.authenticated===false?'Bitte erneut bei der Plattform anmelden.':'Die Anmeldung konnte nicht eindeutig bestätigt werden. Bitte das Anmeldefenster öffnen und den Plattformstatus prüfen.');
 }
 if(action==='off'){
  const {error}=await db.from('bot_users').update({auto_apply_enabled:false}).eq('id',user.id);
  if(error)throw Error('Auto-Bewerbung konnte nicht deaktiviert werden.');
 }
 if(action==='on'){
  if(!user.is_premium)return render('Auto-Bewerbungen benötigen aktives Premium.',back);
  const {error}=await db.from('bot_users').update({auto_apply_enabled:true}).eq('id',user.id);
  if(error)return render('Auto-Bewerbungen sind noch nicht freigegeben. Zuerst müssen die Plattformtests abgeschlossen sein.',back);
 }
 const [{data:rows,error},{data:profile,error:profileError},{data:applications,error:applicationError}]=await Promise.all([
  db.from('platform_sessions').select('source_id,status,session_id,lease_until').eq('user_id',user.id),
  db.from('bot_users').select('auto_apply_enabled').eq('id',user.id).single(),
  db.from('applications').select('listing_id,status').eq('user_id',user.id).order('created_at',{ascending:false}).limit(5)]);
 if(error||profileError||applicationError)throw Error('Plattformkonten konnten nicht geladen werden.');
 const names={1:'ImmoScout24',2:'Kleinanzeigen'},labels={login:'Anmeldefenster geöffnet',saved:'Sitzung gespeichert; Anmeldung wird beim Verwenden geprüft',needs_login:'Anmeldung erforderlich',disconnecting:'Löschung noch offen'};
 const sessionLabel=row=>row?.status==='login'&&(!row.session_id||Date.parse(row.lease_until)<=Date.now())?'Anmeldefenster beendet – Verbindung prüfen':labels[row?.status]||'nicht verbunden';
 return render(`🔐 Plattformkonten\n\n${[1,2].map(id=>`${names[id]}: ${sessionLabel(rows?.find(r=>r.source_id===id))}`).join('\n')}\n\nAuto-Bewerbung: ${profile.auto_apply_enabled?'aktiv (nur mit Premium)':'aus'}\nDer automatische Versand bleibt bis zum erfolgreichen Plattformtest gesperrt.`,[
  ...[1,2].flatMap(id=>[...(user.is_premium?[[button(`${names[id]} anmelden`,`platforms:login:${id}`)],[button(`${names[id]} prüfen`,`platforms:check:${id}`)]]:[]),...(rows?.some(r=>r.source_id===id)?[[button(`${names[id]} trennen`,`platforms:disconnect:${id}`)]]:[])]),
  [button(profile.auto_apply_enabled?'Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',`platforms:${profile.auto_apply_enabled?'off':'on'}`)],
  ...(applications||[]).map((a,i)=>[button(`${{sent:'✅ Gesendet',failed:'❌ Fehlgeschlagen',manual_required:'⚡ Manueller Schritt',pending:'⏳ Vorgemerkt',processing:'⏳ Wird verarbeitet'}[a.status]} · ${i+1}`,`apply:${a.listing_id}`)]),
  [button('← Bewerbermappe','dossier')]]);
}
