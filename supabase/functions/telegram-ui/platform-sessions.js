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
const DOCUMENT_BUCKET='applicant-documents';
const MAX_DOCUMENT_BYTES=6*1024*1024;
const DOCUMENT_TYPES={
 wbs:{label:'WBS',button:'🪪 WBS'},
 urgency_certificate:{label:'Dringlichkeitsschein',button:'🚨 Dringlichkeit'},
 guarantee:{label:'Bürgschaft',button:'🤝 Bürgschaft'},
 schufa:{label:'SCHUFA',button:'📊 SCHUFA'},
 income_proof:{label:'Einkommensnachweis',button:'💶 Einkommen'},
 rent_clearance:{label:'Mietschuldenfreiheitsbescheinigung',button:'🏠 Mietschuldenfrei'},
 other:{label:'Sonstiges Dokument',button:'📎 Sonstiges'}
};
const DOC_PROMPT_PREFIX='📎 Bewerberdokument · ';

const SETUP_PROMPT='👤 Bewerberprofil · Grundeinrichtung';
const FIELD_PROMPT_PREFIX='👤 Bewerberprofil · ';
const KLEIN_CALLBACK_ORIGIN='https://login.kleinanzeigen.de';
const KLEIN_CALLBACK_PATH='/android/com.ebay.kleinanzeigen/callback';
const IMMOMIO_CALLBACK_ORIGIN='https://tenant.immomio.com';
const IMMOMIO_CALLBACK_PATH='/assets/manifest.webmanifest';

export async function applicationWorker(action,userId,source,extra={}){
 let response;
 try{
  const endpoint=source===3?`${SUPABASE_URL}/functions/v1/immomio-account`:`${SUPABASE_URL}/functions/v1/application-worker`;
  response=await fetch(endpoint,{
   method:'POST',headers:{'Content-Type':'application/json','x-internal-secret':await secret('internal_worker_secret')},
   body:JSON.stringify({action,userId,source,...extra}),signal:AbortSignal.timeout(45000)});
 }catch{throw Error('Auto-Bewerbung ist gerade nicht erreichbar. Bitte erneut versuchen.');}
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result){
  const code=result?.error;
  if(code==='premium_required')throw Error('Premium ist erforderlich.');
  if(code==='auth_flow_expired')throw Error('Die Plattform-Anmeldung ist abgelaufen. Bitte erneut verbinden.');
  if(code==='invalid_callback_url')throw Error('Der Plattform-Rücksprung ist unvollständig. Bitte den Login erneut starten.');
  if(code==='token_exchange_failed')throw Error('Die Plattform konnte die Anmeldung nicht abschließen. Bitte erneut versuchen.');
  if(code==='immomio_email_required')throw Error('Im Bewerberprofil fehlt eine gültige E-Mail-Adresse.');
  throw Error('Plattformverbindung momentan nicht verfügbar.');
 }
 return result;
}

export async function purgePlatformSessions(userId){
 const {data:documents,error:documentError}=await db.from('applicant_documents').select('storage_path').eq('user_id',userId);
 if(documentError)throw Error('Bewerberdokumente konnten nicht geladen werden.');
 const paths=(documents||[]).map(row=>String(row.storage_path||'')).filter(Boolean);
 if(paths.length){
  const {error:storageError}=await db.storage.from(DOCUMENT_BUCKET).remove(paths);
  if(storageError)throw Error('Bewerberdokumente konnten nicht gelöscht werden.');
 }
 await db.from('applicant_documents').delete().eq('user_id',userId);
 const {data,error}=await db.from('platform_connections').select('provider').eq('user_id',userId);
 if(error)throw Error('Plattformverbindungen konnten nicht geladen werden.');
 const sourceFor={immoscout:1,kleinanzeigen:2,immomio:3};
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

function normalizeKleinCallback(value){
 let url;try{url=new URL(String(value||'').trim().replace(/[\])},.;!?]+$/g,''));}catch{return null;}
 if(url.origin!==KLEIN_CALLBACK_ORIGIN||url.pathname!==KLEIN_CALLBACK_PATH||url.username||url.password||url.port)return null;
 if(!url.searchParams.get('state'))return null;
 if(!url.searchParams.get('code')&&!url.searchParams.get('error'))return null;
 return url.href;
}
function normalizeImmomioCallback(value){
 let url;try{url=new URL(String(value||'').trim().replace(/[\])},.;!?]+$/g,''));}catch{return null;}
 if(url.origin!==IMMOMIO_CALLBACK_ORIGIN||url.pathname!==IMMOMIO_CALLBACK_PATH||url.username||url.password||url.port)return null;
 if(!url.searchParams.get('state')||!url.searchParams.get('code'))return null;
 return url.href;
}
function callbackCandidates(message,regex){
 const candidates=[];
 for(const [textKey,entitiesKey] of [['text','entities'],['caption','caption_entities']]){
  const text=String(message?.[textKey]||'');
  if(!text)continue;
  candidates.push(text);
  for(const match of text.matchAll(regex))candidates.push(match[0]);
  for(const entity of message?.[entitiesKey]||[]){
   if(entity?.type==='text_link'&&entity.url)candidates.push(String(entity.url));
   if(entity?.type==='url'&&Number.isInteger(entity.offset)&&Number.isInteger(entity.length))candidates.push(text.slice(entity.offset,entity.offset+entity.length));
  }
 }
 return candidates;
}
export function kleinCallbackFromMessage(message){
 for(const candidate of callbackCandidates(message,/https:\/\/login\.kleinanzeigen\.de\/android\/com\.ebay\.kleinanzeigen\/callback[^\s<>"']*/gi)){const parsed=normalizeKleinCallback(candidate);if(parsed)return parsed;}
 return null;
}
export function immomioCallbackFromMessage(message){
 for(const candidate of callbackCandidates(message,/https:\/\/tenant\.immomio\.com\/assets\/manifest\.webmanifest[^\s<>"']*/gi)){const parsed=normalizeImmomioCallback(candidate);if(parsed)return parsed;}
 return null;
}

const clip=(value,max=28)=>{const s=String(value||'').replace(/\s+/g,' ').trim();return s.length>max?s.slice(0,max-1)+'…':s;};
const safeOriginalName=value=>String(value||'Dokument')
 .replace(/[\u0000-\u001f\u007f]/g,' ')
 .replace(/[\\/]+/g,'_')
 .replace(/\s+/g,' ')
 .trim()
 .slice(0,180)||'Dokument';

function sniffDocumentMime(bytes){
 if(bytes.length>=5&&bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d)return 'application/pdf';
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a)return 'image/png';
 return null;
}
const extensionForMime=mime=>mime==='application/pdf'?'pdf':mime==='image/jpeg'?'jpg':'png';

async function readDocuments(userId){
 const {data,error}=await db.from('applicant_documents')
  .select('id,document_type,original_filename,storage_path,mime_type,size_bytes,send_with_auto_apply,created_at')
  .eq('user_id',userId)
  .order('created_at',{ascending:false});
 if(error)throw Error('Bewerberdokumente konnten nicht geladen werden.');
 return data||[];
}

async function downloadTelegramDocument(fileId){
 const file=await telegram('getFile',{file_id:fileId});
 const path=String(file?.file_path||'');
 if(!path||path.includes('..'))throw Error('Telegram-Datei konnte nicht geladen werden.');
 const request=async(force=false)=>{
  const token=await secret('telegram_bot_token_runtime',force);
  return fetch(`https://api.telegram.org/file/bot${token}/${path}`,{signal:AbortSignal.timeout(25000)});
 };
 let response=await request(false);
 if(response.status===401)response=await request(true);
 if(!response.ok)throw Error('Telegram-Datei konnte nicht geladen werden.');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(!bytes.length||bytes.length>MAX_DOCUMENT_BYTES)throw Error('Die Datei muss zwischen 1 Byte und 6 MB groß sein.');
 return bytes;
}

async function storeApplicantDocument(user,message,type){
 const meta=DOCUMENT_TYPES[type];if(!meta)throw Error('Unbekannter Dokumenttyp.');
 const doc=message?.document;
 if(!doc)throw Error('Bitte sende das Dokument als Datei – nicht als Foto.');
 const declaredSize=Number(doc.file_size||0);
 if(declaredSize>MAX_DOCUMENT_BYTES)throw Error('Die Datei darf maximal 6 MB groß sein.');
 const bytes=await downloadTelegramDocument(String(doc.file_id||''));
 const mime=sniffDocumentMime(bytes);
 if(!mime)throw Error('Erlaubt sind ausschließlich PDF-, JPG- und PNG-Dateien.');
 const original=safeOriginalName(doc.file_name||`${meta.label}.${extensionForMime(mime)}`);
 const storagePath=`${user.id}/${crypto.randomUUID()}.${extensionForMime(mime)}`;
 const {error:uploadError}=await db.storage.from(DOCUMENT_BUCKET).upload(storagePath,bytes,{
  contentType:mime,upsert:false,cacheControl:'3600'
 });
 if(uploadError)throw Error('Dokument konnte nicht sicher gespeichert werden.');
 const {error:insertError}=await db.from('applicant_documents').insert({
  user_id:user.id,document_type:type,original_filename:original,storage_path:storagePath,
  mime_type:mime,size_bytes:bytes.length,send_with_auto_apply:false
 });
 if(insertError){
  await db.storage.from(DOCUMENT_BUCKET).remove([storagePath]).catch(()=>{});
  throw Error('Dokumentmetadaten konnten nicht gespeichert werden.');
 }
 return {label:meta.label,filename:original};
}

async function deleteApplicantDocument(userId,id){
 const {data:doc,error}=await db.from('applicant_documents')
  .select('id,storage_path').eq('id',id).eq('user_id',userId).maybeSingle();
 if(error)throw Error('Dokument konnte nicht geladen werden.');
 if(!doc)return;
 const {error:storageError}=await db.storage.from(DOCUMENT_BUCKET).remove([doc.storage_path]);
 if(storageError)throw Error('Dokumentdatei konnte nicht gelöscht werden.');
 const {error:deleteError}=await db.from('applicant_documents').delete().eq('id',id).eq('user_id',userId);
 if(deleteError)throw Error('Dokument konnte nicht gelöscht werden.');
}

async function renderApplicantDocuments(user,chat,messageId,notice=''){
 const docs=await readDocuments(user.id),selected=docs.filter(d=>d.send_with_auto_apply).length;
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const text=`📎 <b>Bewerberdokumente</b>\n\n${notice?`${notice}\n\n`:''}${docs.length} Datei${docs.length===1?'':'en'} gespeichert · ${selected} für Auto-Bewerbungen ausgewählt.\n\n<b>Dateiversand</b>\nImmoScout24: ausgewählte Unterlagen über einen geschützten Bewerbungslink im Erstkontakt\nKleinanzeigen: ausgewählte Unterlagen über einen geschützten Bewerbungslink im Erstkontakt\nImmomio: nativer Upload in dein Tenant-Profil mit technischer Verifikation vor dem Versand\n\nDer geschützte Link enthält einen Snapshot der beim Erstellen ausgewählten Dateien. Späteres Abwählen verändert bereits erstellte Bewerbungen nicht; Löschen einer Datei widerruft den Zugriff auf diese Datei.`;
 const rows=[
  [button('🪪 WBS','platforms:doc-upload:wbs'),button('🚨 Dringlichkeit','platforms:doc-upload:urgency_certificate')],
  [button('🤝 Bürgschaft','platforms:doc-upload:guarantee'),button('📊 SCHUFA','platforms:doc-upload:schufa')],
  [button('💶 Einkommensnachweis','platforms:doc-upload:income_proof')],
  [button('🏠 Mietschuldenfrei','platforms:doc-upload:rent_clearance')],
  [button('📎 Sonstiges','platforms:doc-upload:other')]
 ];
 for(const doc of docs){
  const meta=DOCUMENT_TYPES[doc.document_type]||DOCUMENT_TYPES.other;
  rows.push([
   button(`${doc.send_with_auto_apply?'✅':'○'} ${meta.button} · ${clip(doc.original_filename,22)}`,`platforms:doc-toggle:${doc.id}`),
   button('🗑',`platforms:doc-delete:${doc.id}`)
  ]);
 }
 rows.push([button('← Bewerberprofil','platforms:profile')]);
 return render(text,rows);
}

async function readProfile(userId){
 const {data,error}=await db.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle();
 if(error)throw Error('Bewerberprofil konnte nicht geladen werden.');
 return data||null;
}

async function renderApplicantProfile(user,chat,messageId,notice=''){
 const [p,docs]=await Promise.all([readProfile(user.id),readDocuments(user.id)]),render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 if(!p){
  return render(`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Noch kein Bewerberprofil angelegt. Die Grundeinrichtung erfolgt direkt hier in Telegram – ohne externe Supabase-Seite.`,[
   [button('➕ Bewerberprofil anlegen','platforms:profile-new')],
   [button('← Automatische Bewerbung','platforms')]
  ]);
 }
 const address=[p.street,p.house_number].filter(Boolean).join(' '),ready=profileReady(p),selectedDocs=docs.filter(d=>d.send_with_auto_apply).length;
 const text=`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Status: ${ready?'✅ vollständig':'⚠️ unvollständig'}\n\n`+
  `Anrede: ${shown(p.salutation)}\nVorname: ${shown(p.first_name)}\nNachname: ${shown(p.last_name)}\nE-Mail: ${shown(p.email)}\nTelefon: ${shown(p.phone)}\nAdresse: ${shown(address)}\nPLZ / Ort: ${shown([p.postcode,p.city].filter(Boolean).join(' '))}\nHaushalt: ${shown(p.household_size)}\nBeschäftigung: ${shown(p.employment_status)}\nNettoeinkommen: ${p.monthly_net_income==null?'–':`${shown(p.monthly_net_income)} €`}\nHaustiere: ${shown(p.pets)}\nWBS: ${shown(p.wbs_status)}\nEinzug: ${shown(p.move_in_date)}\nBewerbungstext: ${p.default_message?'✅ hinterlegt':'–'}\nDokumente: ${docs.length} gespeichert · ${selectedDocs} ausgewählt`;
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
  [button('📎 Dokumente verwalten','platforms:docs')],
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
 const kleinUrl=kleinCallbackFromMessage(message),immomioUrl=immomioCallbackFromMessage(message),callbackUrl=immomioUrl||kleinUrl;
 if(callbackUrl){
  const source=immomioUrl?3:2,name=source===3?'Immomio':'Kleinanzeigen';
  await telegram('deleteMessage',{chat_id:chat.id,message_id:message.message_id}).catch(()=>{});
  if(!user.is_premium)return send(chat.id,`💎 Die ${name}-Verbindung benötigt Premium.`,{inline_keyboard:[[button('← Automatische Bewerbung','platforms')]]});
  try{
   const result=await applicationWorker('complete_login',user.id,source,{callbackUrl});
   if(result?.authenticated!==true&&result?.status!=='connected')throw Error(`${name} konnte nicht verbunden werden.`);
   return send(chat.id,`✅ <b>${name} verbunden</b>\n\nDie Anmeldung ist verschlüsselt gespeichert. Du musst nichts kopieren oder einfügen.`,{inline_keyboard:[[button('← Automatische Bewerbung','platforms')]]});
  }catch(error){
   return send(chat.id,`⚠️ ${esc(error.message)}`,{inline_keyboard:[[button(`🔐 ${name} erneut verbinden`,`platforms:login:${source}`)],[button('← Automatische Bewerbung','platforms')]]});
  }
 }
 if(replied.startsWith(DOC_PROMPT_PREFIX)){
  if(!user.is_premium)return send(chat.id,'💎 Bewerberdokumente benötigen Premium.');
  const label=replied.slice(DOC_PROMPT_PREFIX.length).split('\n')[0].trim();
  const type=Object.entries(DOCUMENT_TYPES).find(([,meta])=>meta.label===label)?.[0];
  if(!type)return null;
  try{
   const current=await readProfile(user.id);
   if(!current)return send(chat.id,'Bitte zuerst das Bewerberprofil anlegen.',{inline_keyboard:[[button('➕ Bewerberprofil anlegen','platforms:profile-new')]]});
   const saved=await storeApplicantDocument(user,message,type);
   await Promise.all([
    telegram('deleteMessage',{chat_id:chat.id,message_id:message.message_id}).catch(()=>{}),
    message.reply_to_message?.message_id?telegram('deleteMessage',{chat_id:chat.id,message_id:message.reply_to_message.message_id}).catch(()=>{}):null
   ]);
   return send(chat.id,`✅ ${esc(saved.label)} gespeichert. Die Datei ist standardmäßig <b>nicht</b> für Auto-Bewerbungen ausgewählt.`,{inline_keyboard:[[button('📎 Dokumente verwalten','platforms:docs')],[button('← Bewerberprofil','platforms:profile')]]});
  }catch(error){return send(chat.id,`⚠️ ${esc(error.message)}`,{inline_keyboard:[[button('📎 Dokumente','platforms:docs')]]});}
 }

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

 if(action==='docs'){
  if(!user.is_premium)return render('Bewerberdokumente für Auto-Bewerbungen benötigen Premium.',back);
  return renderApplicantDocuments(user,chat,messageId);
 }
 if(action==='doc-upload'){
  if(!user.is_premium)return render('Bewerberdokumente für Auto-Bewerbungen benötigen Premium.',back);
  const meta=DOCUMENT_TYPES[arg];if(!meta)return renderApplicantDocuments(user,chat,messageId);
  const profile=await readProfile(user.id);if(!profile)return renderApplicantProfile(user,chat,messageId,'Bitte zuerst das Bewerberprofil anlegen.');
  const incomeHint=arg==='income_proof'?'\nFür die letzten drei Monate kannst du diesen Upload dreimal nacheinander verwenden.':'';
  return send(chat.id,`${DOC_PROMPT_PREFIX}${meta.label}\n\nSende die Datei als <b>Antwort auf diese Nachricht</b>.\n\nErlaubt: PDF, JPG oder PNG · maximal 6 MB.${incomeHint}\nNeue Dateien sind zunächst nicht für Auto-Bewerbungen freigegeben.`,{force_reply:true,selective:true,input_field_placeholder:'Datei senden'});
 }
 if(action==='doc-toggle'){
  if(!user.is_premium)return render('Bewerberdokumente für Auto-Bewerbungen benötigen Premium.',back);
  const {data:doc,error}=await db.from('applicant_documents').select('id,send_with_auto_apply').eq('id',arg).eq('user_id',user.id).maybeSingle();
  if(error)throw Error('Dokument konnte nicht geladen werden.');
  if(doc){
   const next=!doc.send_with_auto_apply;
   const {error:updateError}=await db.from('applicant_documents').update({send_with_auto_apply:next,updated_at:new Date().toISOString()}).eq('id',doc.id).eq('user_id',user.id);
   if(updateError)throw Error('Dokumentauswahl konnte nicht gespeichert werden.');
   if(!next)await applicationWorker('sync_documents',user.id,3).catch(()=>null);
  }
  return renderApplicantDocuments(user,chat,messageId);
 }
 if(action==='doc-delete'){
  if(!user.is_premium)return render('Bewerberdokumente für Auto-Bewerbungen benötigen Premium.',back);
  try{
   await deleteApplicantDocument(user.id,arg);
   await applicationWorker('sync_documents',user.id,3).catch(()=>null);
   return renderApplicantDocuments(user,chat,messageId,'Dokument gelöscht.');
  }catch(error){return renderApplicantDocuments(user,chat,messageId,`⚠️ ${esc(error.message)}`);}
 }

 if(action==='login'||action==='disconnect'||action==='check'){
  if(![1,2,3].includes(source))return;
  if(action!=='disconnect'&&!user.is_premium)return render('Zum Verbinden ist Premium erforderlich.',back);
  const name=source===1?'ImmoScout24':source===2?'Kleinanzeigen':'Immomio';
  if(source===1&&action==='login')return render('🔐 <b>ImmoScout24</b>\n\nDie Verbindung wird ohne offizielle ImmoScout-API über eine gespeicherte Web-Session umgesetzt. Der kontrollierte Login-/Sendetest ist noch ausstehend; deshalb wird hier aktuell noch keine produktive Session angelegt.',back);
  try{
   const result=await applicationWorker(action,user.id,source);
   if(action==='disconnect')return render(`${name}: Verbindung gelöscht.`,back);
   if(action==='login'&&result.url){
    const note=source===3
     ? '<b>1.</b> Öffne Immomio und melde dich normal an.\n<b>2.</b> Auf der Abschlussseite tippe auf <b>Teilen</b>.\n<b>3.</b> Wähle <b>Telegram → Traumwohnung – Hamburg → Senden</b>.\n\nDer Bot übernimmt den Rücksprung automatisch und speichert die Sitzung verschlüsselt.'
     : result.bridgeRequired
      ? '<b>1.</b> Öffne Kleinanzeigen und melde dich normal an.\n<b>2.</b> Auf der Abschlussseite tippe auf <b>Teilen</b>.\n<b>3.</b> Wähle <b>Telegram → Traumwohnung Hamburg</b>.\n\nDas war’s. Der Bot erkennt den Rücksprung automatisch und löscht die geteilte Login-URL direkt wieder. Du musst nichts kopieren, einfügen oder zusätzlich installieren. Falls Telegram den Login intern öffnet, kannst du ihn über das Menü in Safari öffnen.'
      : result.automaticCallback
       ? 'Öffne Kleinanzeigen und melde dich ganz normal im Browser an. Nach erfolgreichem Login wird die Verbindung automatisch abgeschlossen und du wirst zurück zu Telegram geführt. Kein Kopieren, Teilen oder Remote-Browser.'
       : 'Melde dich einmalig an. Danach bleibt die Verbindung gespeichert.';
    return render(`🔐 <b>${name} verbinden</b>\n\n${note}`,[[{text:`🌐 ${name}-Login öffnen`,url:result.url}],...back]);
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
 const scout=connections?.find(r=>r.provider==='immoscout'),klein=connections?.find(r=>r.provider==='kleinanzeigen'),immomio=connections?.find(r=>r.provider==='immomio'),ready=profileReady(applicant);
 const text=`⚡ <b>Automatische Bewerbung</b>\n\n👤 Bewerberprofil: ${ready?'✅ vollständig':applicant?'⚠️ unvollständig':'⚠️ fehlt'}\n\n<b>Plattformen</b>\nKleinanzeigen: ${connectionLabel(klein)} · 🧪 Sendetest ausstehend\nImmoScout24: ${connectionLabel(scout)} · 🧪 Sendetest ausstehend\nImmomio: ${connectionLabel(immomio)} · 🧪 Sendetest ausstehend\n\nAuto-Bewerbung: ${state.auto_apply_enabled?'✅ aktiv':'aus'}\n\nNach der einmaligen Einrichtung läuft die Bewerbung auf freigegebenen Plattformen vollständig automatisch.`;
 const rows=[
  [button('👤 Bewerberprofil','platforms:profile')],
  ...(user.is_premium?[[button(klein?.status==='connected'?'✅ Kleinanzeigen verbunden':'🔐 Kleinanzeigen verbinden','platforms:login:2')],[button('✅ Kleinanzeigen prüfen','platforms:check:2')],[button('🔐 ImmoScout24 verbinden','platforms:login:1')],[button(immomio?.status==='connected'?'✅ Immomio verbunden':'🔐 Immomio verbinden','platforms:login:3')],[button('✅ Immomio prüfen','platforms:check:3')]]:[]),
  ...(klein?[[button('Kleinanzeigen trennen','platforms:disconnect:2')]]:[]),
  ...(scout?[[button('ImmoScout24 trennen','platforms:disconnect:1')]]:[]),
  ...(immomio?[[button('Immomio trennen','platforms:disconnect:3')]]:[]),
  [button(state.auto_apply_enabled?'Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',`platforms:${state.auto_apply_enabled?'off':'on'}`)],
  [button('← Einstellungen','settings')]
 ];
 return render(text,rows);
}