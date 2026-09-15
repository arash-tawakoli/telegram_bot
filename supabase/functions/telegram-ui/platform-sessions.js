import {db,SUPABASE_URL,secret,send,edit,button,telegram,esc} from './runtime.js';

const privateOwner=(user,chat)=>chat?.type==='private'&&user.is_active
 && Number(chat.id)===Number(user.telegram_user_id)&&Number(chat.id)===Number(user.chat_id);

const REQUIRED=['first_name','last_name','email','phone','city','household_size'];
const PROFILE_FIELDS={
 salutation:{label:'Anrede',hint:'z. B. Herr, Frau oder Divers',max:40},
 first_name:{label:'Vorname',required:true,max:120},
 last_name:{label:'Nachname',required:true,max:120},
 email:{label:'E-Mail',required:true,max:320},
 phone:{label:'Telefon',required:true,max:80},
 street:{label:'Straße',max:160},
 house_number:{label:'Hausnummer',max:40},
 postcode:{label:'PLZ',max:10},
 city:{label:'Ort',required:true,max:120},
 household_size:{label:'Haushaltsgröße',required:true,type:'integer'},
 employment_status:{label:'Beschäftigung',max:160},
 monthly_net_income:{label:'Nettoeinkommen / Monat',type:'money'},
 pets:{label:'Haustiere',max:160},
 wbs_status:{label:'WBS-Status',max:160},
 move_in_date:{label:'Einzugsdatum',type:'date'},
 default_message:{label:'Standard-Bewerbungstext',max:4000}
};
const SETUP_PROMPT='👤 Bewerberprofil · Grundeinrichtung';
const FIELD_PROMPT_PREFIX='👤 Bewerberprofil · ';

export async function applicationWorker(action,userId,source,extra={}){
 let response;
 try{
  response=await fetch(`${SUPABASE_URL}/functions/v1/application-worker`,{
   method:'POST',headers:{'Content-Type':'application/json','x-internal-secret':await secret('internal_worker_secret')},
   body:JSON.stringify({action,userId,source,...extra}),signal:AbortSignal.timeout(45000)});
 }catch{throw Error('Auto-Bewerbung ist gerade nicht erreichbar. Bitte erneut versuchen.');}
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result){
  const code=result?.error;
  if(code==='premium_required')throw Error('Premium ist erforderlich.');
  if(code==='auth_flow_expired')throw Error('Die Kleinanzeigen-Anmeldung ist abgelaufen. Bitte erneut verbinden.');
  if(code==='invalid_callback_url')throw Error('Der Kleinanzeigen-Rücksprung ist unvollständig. Bitte den Login erneut starten.');
  if(code==='token_exchange_failed')throw Error('Kleinanzeigen konnte die Anmeldung nicht abschließen. Bitte erneut versuchen.');
  throw Error('Plattformverbindung momentan nicht verfügbar.');
 }
 return result;
}

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
const profileReady=p=>!!p&&REQUIRED.every(k=>String(p[k]??'').trim());
const shown=(v,fallback='–')=>v==null||String(v).trim()===''?fallback:esc(v);

async function readProfile(userId){
 const {data,error}=await db.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle();
 if(error)throw Error('Bewerberprofil konnte nicht geladen werden.');
 return data||null;
}

async function renderApplicantProfile(user,chat,messageId,notice=''){
 const p=await readProfile(user.id),render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 if(!p){
  return render(`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Noch kein Bewerberprofil angelegt. Die Grundeinrichtung erfolgt direkt hier in Telegram – ohne externe Supabase-Seite.`,[
   [button('➕ Bewerberprofil anlegen','platforms:profile-new')],
   [button('← Automatische Bewerbung','platforms')]
  ]);
 }
 const address=[p.street,p.house_number].filter(Boolean).join(' '),ready=profileReady(p);
 const text=`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Status: ${ready?'✅ vollständig':'⚠️ unvollständig'}\n\n`+
  `Anrede: ${shown(p.salutation)}\nVorname: ${shown(p.first_name)}\nNachname: ${shown(p.last_name)}\nE-Mail: ${shown(p.email)}\nTelefon: ${shown(p.phone)}\nAdresse: ${shown(address)}\nPLZ / Ort: ${shown([p.postcode,p.city].filter(Boolean).join(' '))}\nHaushalt: ${shown(p.household_size)}\nBeschäftigung: ${shown(p.employment_status)}\nNettoeinkommen: ${p.monthly_net_income==null?'–':`${shown(p.monthly_net_income)} €`}\nHaustiere: ${shown(p.pets)}\nWBS: ${shown(p.wbs_status)}\nEinzug: ${shown(p.move_in_date)}\nBewerbungstext: ${p.default_message?'✅ hinterlegt':'–'}`;
 const f=(name,label)=>button(label,`platforms:profile-field:${name}`);
 return render(text,[
  [f('first_name','Vorname'),f('last_name','Nachname')],
  [f('email','E-Mail'),f('phone','Telefon')],
  [f('salutation','Anrede'),f('household_size','Haushalt')],
  [f('street','Straße'),f('house_number','Hausnr.')],
  [f('postcode','PLZ'),f('city','Ort')],
  [f('employment_status','Beschäftigung'),f('monthly_net_income','Einkommen')],
  [f('pets','Haustiere'),f('wbs_status','WBS')],
  [f('move_in_date','Einzugsdatum')],
  [f('default_message','✍️ Bewerbungstext')],
  [button('← Automatische Bewerbung','platforms')]
 ]);
}

function fieldPrompt(name){
 const meta=PROFILE_FIELDS[name];if(!meta)return null;
 const optional=meta.required?'':'\nOptional: Sende nur <code>-</code>, um den Wert zu löschen.';
 const extra=meta.type==='date'?'\nFormat: <code>JJJJ-MM-TT</code>':meta.type==='integer'?'\nZahl von 1 bis 20':meta.type==='money'?'\nNur den Betrag eingeben, z. B. <code>2500</code>':meta.hint?`\n${meta.hint}`:'';
 return `${FIELD_PROMPT_PREFIX}${meta.label}\n\nBitte antworte auf diese Nachricht mit dem neuen Wert.${extra}${optional}`;
}

function validateField(name,input){
 const meta=PROFILE_FIELDS[name];if(!meta)throw Error('Unbekanntes Profilfeld.');
 const raw=String(input??'').trim();
 if(raw==='-'&&!meta.required)return null;
 if(!raw&&meta.required)throw Error(`${meta.label} darf nicht leer sein.`);
 if(!raw)return null;
 if(name==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))throw Error('Bitte eine gültige E-Mail-Adresse eingeben.');
 if(name==='phone'&&(raw.length<3||raw.length>80))throw Error('Bitte eine gültige Telefonnummer eingeben.');
 if(name==='postcode'&&!/^\d{5}$/.test(raw))throw Error('Bitte eine fünfstellige PLZ eingeben.');
 if(meta.type==='integer'){
  const n=Number(raw);if(!Number.isInteger(n)||n<1||n>20)throw Error('Haushaltsgröße muss zwischen 1 und 20 liegen.');return n;
 }
 if(meta.type==='money'){
  const n=Number(raw.replace(/\./g,'').replace(',','.'));if(!Number.isFinite(n)||n<0||n>1000000)throw Error('Bitte ein gültiges monatliches Nettoeinkommen eingeben.');return n;
 }
 if(meta.type==='date'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||Number.isNaN(Date.parse(`${raw}T00:00:00Z`)))throw Error('Bitte das Datum als JJJJ-MM-TT eingeben.');return raw;
 }
 if(raw.length>(meta.max||4000))throw Error(`${meta.label} ist zu lang.`);
 return raw;
}

export async function handleAutoApplyMessage(user,message){
 const chat=message?.chat;if(!privateOwner(user,chat))return null;
 const text=String(message?.text||'').trim();
 const replied=String(message?.reply_to_message?.text||'');
 if(replied.startsWith(SETUP_PROMPT)){
  const parts=text.split('|').map(v=>v.trim());
  if(parts.length!==6)return send(chat.id,'Bitte genau 6 Werte mit <code>|</code> trennen:\nVorname | Nachname | E-Mail | Telefon | Ort | Haushaltsgröße');
  try{
   const values={
    user_id:user.id,
    first_name:validateField('first_name',parts[0]),last_name:validateField('last_name',parts[1]),email:validateField('email',parts[2]),phone:validateField('phone',parts[3]),city:validateField('city',parts[4]),household_size:validateField('household_size',parts[5]),updated_at:new Date().toISOString()
   };
   const {error}=await db.from('applicant_profiles').upsert(values,{onConflict:'user_id'});if(error)throw Error('Bewerberprofil konnte nicht gespeichert werden.');
   await Promise.all([telegram('deleteMessage',{chat_id:chat.id,message_id:message.message_id}).catch(()=>{}),message.reply_to_message?.message_id?telegram('deleteMessage',{chat_id:chat.id,message_id:message.reply_to_message.message_id}).catch(()=>{}):null]);
   return send(chat.id,'✅ Bewerberprofil angelegt.',{inline_keyboard:[[button('👤 Profil öffnen','platforms:profile')],[button('← Automatische Bewerbung','platforms')]]});
  }catch(error){return send(chat.id,`⚠️ ${esc(error.message)}`);}
 }
 if(replied.startsWith(FIELD_PROMPT_PREFIX)){
  const label=replied.slice(FIELD_PROMPT_PREFIX.length).split('\n')[0].trim();
  const entry=Object.entries(PROFILE_FIELDS).find(([,meta])=>meta.label===label);if(!entry)return null;
  const [name]=entry;
  try{
   const current=await readProfile(user.id);if(!current)return send(chat.id,'Bitte zuerst die Grundeinrichtung des Bewerberprofils abschließen.',{inline_keyboard:[[button('➕ Bewerberprofil anlegen','platforms:profile-new')]]});
   const value=validateField(name,text),{error}=await db.from('applicant_profiles').update({[name]:value,updated_at:new Date().toISOString()}).eq('user_id',user.id);if(error)throw Error('Änderung konnte nicht gespeichert werden.');
   await Promise.all([telegram('deleteMessage',{chat_id:chat.id,message_id:message.message_id}).catch(()=>{}),message.reply_to_message?.message_id?telegram('deleteMessage',{chat_id:chat.id,message_id:message.reply_to_message.message_id}).catch(()=>{}):null]);
   return send(chat.id,`✅ ${esc(PROFILE_FIELDS[name].label)} gespeichert.`,{inline_keyboard:[[button('👤 Bewerberprofil','platforms:profile')],[button('← Automatische Bewerbung','platforms')]]});
  }catch(error){return send(chat.id,`⚠️ ${esc(error.message)}`);}
 }
 return null;
}

export async function platformSessions(user,chat,messageId,data='platforms'){
 if(!privateOwner(user,chat))return;
 const parts=data.split(':'),action=parts[1]||'',arg=parts[2]||'',source=Number(arg);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const back=[[button('← Automatische Bewerbung','platforms')]];

 if(action==='profile'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  return renderApplicantProfile(user,chat,messageId);
 }
 if(action==='profile-new'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  const existing=await readProfile(user.id);if(existing)return renderApplicantProfile(user,chat,messageId);
  return send(chat.id,`${SETUP_PROMPT}\n\nAntworte in <b>einer Nachricht</b> mit diesen 6 Angaben, getrennt durch <code>|</code>:\n\n<code>Vorname | Nachname | E-Mail | Telefon | Ort | Haushaltsgröße</code>\n\nBeispiel:\n<code>Max | Mustermann | max@example.de | +49 170 1234567 | Hamburg | 1</code>`,{force_reply:true,selective:true,input_field_placeholder:'Vorname | Nachname | E-Mail | Telefon | Ort | 1'});
 }
 if(action==='profile-field'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  const prompt=fieldPrompt(arg);if(!prompt)return renderApplicantProfile(user,chat,messageId);
  return send(chat.id,prompt,{force_reply:true,selective:true,input_field_placeholder:PROFILE_FIELDS[arg].label});
 }
 if(action==='immomio')return render('🟢 <b>Immomio</b>\n\nKein separates Immomio-Konto ist für den geplanten Gastbewerbungsweg erforderlich. Passende Immomio-Angebote werden über ihren Bewerbungslink verarbeitet. Der automatische Versand bleibt bis zum kontrollierten Sendetest gesperrt.',back);

 if(action==='login'||action==='disconnect'||action==='check'){
  if(![1,2].includes(source))return;
  if(action!=='disconnect'&&!user.is_premium)return render('Zum Verbinden ist Premium erforderlich.',back);
  const name=source===1?'ImmoScout24':'Kleinanzeigen';
  if(source===1&&action==='login')return render('🔐 <b>ImmoScout24</b>\n\nDie Verbindung wird ohne offizielle ImmoScout-API über eine gespeicherte Web-Session umgesetzt. Der kontrollierte Login-/Sendetest ist noch ausstehend; deshalb wird hier aktuell noch keine produktive Session angelegt.',back);
  try{
   const result=await applicationWorker(action,user.id,source);
   if(action==='disconnect')return render(`${name}: Verbindung gelöscht.`,back);
   if(action==='login'&&result.url){
    const note=result.bridgeRequired
     ? 'Öffne den Login in <b>Safari</b>. Die installierte Traumwohnung Safari-Erweiterung erkennt den Kleinanzeigen-Rücksprung und verbindet dein Konto automatisch. Kein Kopieren oder Teilen. Falls Telegram den Link zunächst intern öffnet, tippe unten rechts einmal auf das Safari-Symbol.'
     : result.automaticCallback
      ? 'Öffne Kleinanzeigen und melde dich ganz normal im Browser an. Nach erfolgreichem Login wird die Verbindung automatisch abgeschlossen und du wirst zurück zu Telegram geführt. Kein Kopieren, Teilen oder Remote-Browser.'
      : 'Melde dich einmalig an. Danach bleibt die Verbindung gespeichert.';
    const label=result.bridgeRequired?'🌐 Kleinanzeigen in Safari öffnen':`🔐 ${name} jetzt verbinden`;
    return render(`${name}: ${note}`,[[{text:label,url:result.url}],...back]);
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
  db.from('applicant_profiles').select('*').eq('user_id',user.id).maybeSingle()
 ]);
 if(error||stateError||applicantError)throw Error('Auto-Bewerbung konnte nicht geladen werden.');
 const scout=connections?.find(r=>r.provider==='immoscout'),klein=connections?.find(r=>r.provider==='kleinanzeigen'),ready=profileReady(applicant);
 const text=`⚡ <b>Automatische Bewerbung</b>\n\n👤 Bewerberprofil: ${ready?'✅ vollständig':applicant?'⚠️ unvollständig':'⚠️ fehlt'}\n\n<b>Plattformen</b>\nKleinanzeigen: ${connectionLabel(klein)} · 🧪 Sendetest ausstehend\nImmoScout24: ${connectionLabel(scout)} · 🧪 Sendetest ausstehend\nImmomio: 🟢 kein Login erforderlich · 🧪 Sendetest ausstehend\n\nAuto-Bewerbung: ${state.auto_apply_enabled?'✅ aktiv':'aus'}\n\nNach der einmaligen Einrichtung läuft die Bewerbung auf freigegebenen Plattformen vollständig automatisch.`;
 const rows=[
  [button('👤 Bewerberprofil','platforms:profile')],
  ...(user.is_premium?[[button(klein?.status==='connected'?'✅ Kleinanzeigen verbunden':'🔐 Kleinanzeigen verbinden','platforms:login:2')],[button('✅ Kleinanzeigen prüfen','platforms:check:2')],[button('🔐 ImmoScout24 verbinden','platforms:login:1')],[button('🟢 Immomio · kein Login nötig','platforms:immomio')]]:[]),
  ...(klein?[[button('Kleinanzeigen trennen','platforms:disconnect:2')]]:[]),
  ...(scout?[[button('ImmoScout24 trennen','platforms:disconnect:1')]]:[]),
  [button(state.auto_apply_enabled?'Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',`platforms:${state.auto_apply_enabled?'off':'on'}`)],
  [button('← Einstellungen','settings')]
 ];
 return render(text,rows);
}
