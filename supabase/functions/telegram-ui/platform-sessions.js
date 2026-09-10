import {db,SUPABASE_URL,secret,send,edit,button} from './runtime.js';
import {privateApplicant} from './dossier-rules.js';

export async function applicationWorker(action,userId,source){
 const response=await fetch(`${SUPABASE_URL}/functions/v1/application-worker`,{method:'POST',
  headers:{'Content-Type':'application/json','x-internal-secret':await secret('internal_worker_secret')},
  body:JSON.stringify({action,userId,source}),signal:AbortSignal.timeout(45000)});
 const result=await response.json();
 if(!response.ok)throw Error(result.error==='session_busy'?'Eine Sitzung läuft noch. Bitte in drei Minuten erneut versuchen.':'Plattformverbindung momentan nicht verfügbar. Bitte erneut versuchen.');
 return result;
}
export async function purgePlatformSessions(userId){
 const {data,error}=await db.from('platform_sessions').select('source_id').eq('user_id',userId);
 if(error)throw Error('Plattformverbindungen konnten nicht geladen werden.');
 for(const row of data||[])await applicationWorker('disconnect',userId,row.source_id);
}
export async function platformSessions(user,chat,messageId,data='platforms'){
 if(!privateApplicant(user,chat))return;
 const [,action,rawSource]=data.split(':'),source=Number(rawSource);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const back=[[button('← Plattformkonten','platforms')]];
 if(action==='login'||action==='disconnect'){
  if(![1,2].includes(source))return;
  if(action==='login'&&!user.is_premium)return render('Zum Verbinden ist Premium erforderlich.',back);
  if(action==='disconnect'){
   await applicationWorker('disconnect',user.id,source);return render('Plattformsitzung gelöscht.',back);
  }
  const result=await applicationWorker('login',user.id,source);
  // A Live View link is a short-lived credential. Send it only to the verified owner.
  return render('Melde dich selbst bei der Plattform an. Das Browserfenster bleibt etwa 100 Sekunden offen. Die Sitzung wird verschlüsselt beim Browserdienst gespeichert. Passwörter nicht an den Bot senden. Der Link ist persönlich; bitte nicht weitergeben.\n\nDie gespeicherte Sitzung ist noch kein Versandnachweis.',[[{text:'🔐 Jetzt anmelden',url:result.url}],...back]);
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
  db.from('platform_sessions').select('source_id,status').eq('user_id',user.id),
  db.from('bot_users').select('auto_apply_enabled').eq('id',user.id).single(),
  db.from('applications').select('listing_id,status').eq('user_id',user.id).order('created_at',{ascending:false}).limit(5)]);
 if(error||profileError||applicationError)throw Error('Plattformkonten konnten nicht geladen werden.');
 const names={1:'ImmoScout24',2:'Kleinanzeigen'},labels={login:'Anmeldefenster geöffnet',saved:'Sitzung gespeichert; Anmeldung wird beim Verwenden geprüft',needs_login:'Anmeldung erforderlich',disconnecting:'Löschung noch offen'};
 return render(`🔐 Plattformkonten\n\n${[1,2].map(id=>`${names[id]}: ${labels[rows?.find(r=>r.source_id===id)?.status]||'nicht verbunden'}`).join('\n')}\n\nAuto-Bewerbung: ${profile.auto_apply_enabled?'aktiv (nur mit Premium)':'aus'}\nDer automatische Versand bleibt bis zum erfolgreichen Plattformtest gesperrt.`,[
  ...[1,2].flatMap(id=>[...(user.is_premium?[[button(`${names[id]} anmelden`,`platforms:login:${id}`)]]:[]),...(rows?.some(r=>r.source_id===id)?[[button(`${names[id]} trennen`,`platforms:disconnect:${id}`)]]:[])]),
  [button(profile.auto_apply_enabled?'Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',`platforms:${profile.auto_apply_enabled?'off':'on'}`)],
  ...(applications||[]).map((a,i)=>[button(`${{sent:'✅ Gesendet',failed:'❌ Fehlgeschlagen',manual_required:'⚡ Manueller Schritt',pending:'⏳ Vorgemerkt',processing:'⏳ Wird verarbeitet'}[a.status]} · ${i+1}`,`apply:${a.listing_id}`)]),
  [button('← Bewerbermappe','dossier')]]);
}
