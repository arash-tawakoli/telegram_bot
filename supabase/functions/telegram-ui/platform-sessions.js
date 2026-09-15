import {db,SUPABASE_URL,secret,send,edit,button} from './runtime.js';

const privateSessionOwner=(user,chat)=>chat?.type==='private'&&user.is_active
 && Number(chat.id)===Number(user.telegram_user_id)&&Number(chat.id)===Number(user.chat_id);

export async function applicationWorker(action,userId,source,extra={}){
 let response;try{response=await fetch(`${SUPABASE_URL}/functions/v1/application-worker`,{method:'POST',
  headers:{'Content-Type':'application/json','x-internal-secret':await secret('internal_worker_secret')},
  body:JSON.stringify({action,userId,source,...extra}),signal:AbortSignal.timeout(45000)});}catch{throw Error('Die Plattform antwortet gerade nicht. Bitte erneut versuchen.');}
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result)throw Error(result?.error==='premium_required'?'Für automatische Bewerbungen ist Premium erforderlich.':'Plattformverbindung momentan nicht verfügbar. Bitte erneut versuchen.');
 return result;
}

export async function purgePlatformSessions(userId){
 for(const source of [1,2]){try{await applicationWorker('disconnect',userId,source);}catch{}}
 await Promise.all([
  db.from('platform_auth_flows').delete().eq('user_id',userId),
  db.from('platform_sessions').delete().eq('user_id',userId)
 ]).catch(()=>{});
}

export async function platformSessions(user,chat,messageId,data='platforms'){
 if(!privateSessionOwner(user,chat))return;
 const [,action,rawSource]=data.split(':'),source=Number(rawSource);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const back=[[button('← Plattformkonten','platforms')]];
 if(action==='login'||action==='disconnect'||action==='check'){
  if(![1,2].includes(source))return;
  if(action!=='disconnect'&&!user.is_premium)return render('Zum Verbinden ist Premium erforderlich.',back);
  const name=source===1?'ImmoScout24':'Kleinanzeigen';
  if(source===1&&action==='login')return render('ImmoScout24 wird ohne offizielle API über eine wiederverwendbare Web-Session angebunden. Der Login-/Send-Vertrag bleibt bis zum kontrollierten Plattformtest gesperrt; es wird kein unsicherer oder geratener Login aktiviert.',back);
  let result;try{result=await applicationWorker(action,user.id,source);}catch(error){return render(error.message,back);}
  if(action==='disconnect')return render(`${name}: Verbindung gelöscht.`,back);
  if(action==='login'&&result.url){
   return render(`${name}: Öffne den normalen Login. Nach erfolgreicher Anmeldung wird der Refresh-Token einmalig verschlüsselt gespeichert.`,[[{text:`🔐 ${name} Login öffnen`,url:result.url}],...back]);
  }
  return render(result.authenticated===true?`${name}: ✅ Verbindung bestätigt.`:result.authenticated===null?`${name}: Verbindung gespeichert; der private Sendepfad ist noch nicht freigegeben.`:`${name}: Bitte erneut verbinden.`,back);
 }
 if(action==='off'){
  const {error}=await db.from('bot_users').update({auto_apply_enabled:false}).eq('id',user.id);
  if(error)throw Error('Auto-Bewerbung konnte nicht deaktiviert werden.');
 }
 if(action==='on'){
  if(!user.is_premium)return render('Auto-Bewerbungen benötigen aktives Premium.',back);
  const {data:profile}=await db.from('applicant_profiles').select('user_id,first_name,last_name,email,phone,city,household_size').eq('user_id',user.id).maybeSingle();
  if(!profile?.first_name||!profile?.last_name||!profile?.email||!profile?.phone||!profile?.city||!profile?.household_size)return render('Bitte zuerst das Bewerberprofil vollständig einrichten.',back);
  const {error}=await db.from('bot_users').update({auto_apply_enabled:true}).eq('id',user.id);
  if(error)return render('Auto-Bewerbungen sind noch nicht freigegeben. Zuerst muss mindestens ein Plattform-Sendetest erfolgreich verifiziert sein.',back);
 }
 const [{data:connections,error},{data:profile,error:profileError},{data:applications,error:applicationError},profileLink]=await Promise.all([
  db.from('platform_connections').select('provider,status,account_hint,last_verified_at,last_error').eq('user_id',user.id),
  db.from('bot_users').select('auto_apply_enabled').eq('id',user.id).single(),
  db.from('applications').select('listing_id,status').eq('user_id',user.id).order('created_at',{ascending:false}).limit(5),
  applicationWorker('profile_link',user.id,0).catch(()=>null)
 ]);
 if(error||profileError||applicationError)throw Error('Auto-Bewerbung konnte nicht geladen werden.');
 const applicant=await db.from('applicant_profiles').select('user_id,first_name,last_name,email,phone,city,household_size').eq('user_id',user.id).maybeSingle();
 const applicantReady=!!(applicant.data?.first_name&&applicant.data?.last_name&&applicant.data?.email&&applicant.data?.phone&&applicant.data?.city&&applicant.data?.household_size);
 const row=provider=>connections?.find(item=>item.provider===provider),label=provider=>row(provider)?.status==='connected'?'🟢 verbunden':row(provider)?.status==='pending'?'🟡 Anmeldung offen':row(provider)?.status==='needs_login'?'🟠 erneut anmelden':'⚪ nicht verbunden';
 const rows=[];
 if(profileLink?.url)rows.push([{text:applicantReady?'👤 Bewerberprofil bearbeiten':'👤 Bewerberprofil einrichten',url:profileLink.url}]);
 if(user.is_premium){rows.push([button('Kleinanzeigen verbinden','platforms:login:2')],[button('Kleinanzeigen prüfen','platforms:check:2')]);}
 if(row('kleinanzeigen'))rows.push([button('Kleinanzeigen trennen','platforms:disconnect:2')]);
 rows.push([button(profile.auto_apply_enabled?'Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',`platforms:${profile.auto_apply_enabled?'off':'on'}`)]);
 for(const [i,a] of (applications||[]).entries())rows.push([button(`${{sent:'✅ Gesendet',failed:'❌ Fehlgeschlagen',manual_required:'⚠️ Prüfung nötig',pending:'⏳ Vorgemerkt',processing:'⏳ Wird verarbeitet'}[a.status]||a.status} · ${i+1}`,`apply:${a.listing_id}`)]);
 rows.push([button('← Einstellungen','settings')]);
 return render(`⚡ <b>Automatische Bewerbung</b>\n\nBewerberprofil: ${applicantReady?'✅ vollständig':'⚠️ unvollständig'}\n\nImmoScout24: ${label('immoscout')}\nKleinanzeigen: ${label('kleinanzeigen')}\nImmomio: 🟢 kein Login erforderlich\n\nAuto-Bewerbung: ${profile.auto_apply_enabled?'✅ aktiv':'aus'}\n\nNach der einmaligen Einrichtung werden freigegebene Plattformen vollständig automatisch ausgefüllt und abgesendet. Plattformen werden erst nach einem kontrollierten Sendetest freigeschaltet.`,rows);
}
