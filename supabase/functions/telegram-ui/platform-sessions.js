import {db,SUPABASE_URL,secret,send,edit,button,telegram,esc} from './runtime.js';
import {providerStaticMissing} from '../_shared/application-profile-adapters.ts';

const privateOwner=(user,chat)=>chat?.type==='private'&&user.is_active
 && Number(chat.id)===Number(user.telegram_user_id)&&Number(chat.id)===Number(user.chat_id);

const SALUTATION_LABELS={MR:'Herr',MS:'Frau',DIVERSE:'Divers',NEUTRAL:'Neutral',NOT_SPECIFIED:'Keine Angabe',COMPANY:'Firma'};
const HOUSEHOLD_LABELS={
 SINGLE:'Einpersonenhaushalt',
 TWO_ADULTS:'Zwei Erwachsene',
 FAMILY:'Familie',
 SHARED_FLAT:'Wohngemeinschaft',
 NOT_SPECIFIED:'Keine Angabe'
};
const INCOME_LABELS={
 UNDER_500:'Unter 500 €',
 '500_1000':'500 € - 1.000 €',
 '1000_1500':'1.000 € - 1.500 €',
 '1500_2000':'1.500 € - 2.000 €',
 '2000_3000':'2.000 € - 3.000 €',
 '3000_4000':'3.000 € - 4.000 €',
 '4000_5000':'4.000 € - 5.000 €',
 OVER_5000:'Über 5.000 € (bitte präzisieren)',
 '5000_6000':'5.000 € - 6.000 €',
 '6000_7000':'6.000 € - 7.000 €',
 OVER_7000:'Über 7.000 €',
 HOUSING_BENEFIT:'Ich beziehe Wohngeld',
 NOT_SPECIFIED:'Keine Angabe'
};
const MOVE_IN_LABELS={
 NOT_SPECIFIED:'Keine Angabe',
 FLEXIBLE:'Flexibel',
 IMMEDIATE:'So bald wie möglich',
 WITHIN_1_MONTH:'Innerhalb 1 Monat',
 WITHIN_3_MONTHS:'Innerhalb 3 Monate',
 AFTER_3_MONTHS:'Später als 3 Monate',
 EXACT_DATE:'Genaues Datum'
};
const EMPLOYMENT_CHOICES={
 NOT_SPECIFIED:'Keine Angabe',
 EMPLOYEE:'Angestellte(r)',
 WORKER:'Arbeiter(in)',
 SELF_EMPLOYED:'Selbstständige(r)',
 CIVIL_SERVANT:'Beamte(r)',
 APPRENTICE:'Auszubildende(r)',
 STUDENT:'Studierende(r)',
 DOCTORAL:'Doktorand(in)',
 HOMEMAKER:'Hausfrau/-mann',
 JOBSEEKER:'Arbeitssuchende(r)',
 RETIRED:'Rentner(in)',
 OTHER:'Sonstiges'
};
const PET_CHOICES={NONE:'Keine Angaben',YES:'Ja',NO:'Nein'};
const PROFILE_FIELDS={
 salutation:{label:'Anrede',type:'choice',required:true,max:40},
 first_name:{label:'Vorname',required:true,max:120},
 last_name:{label:'Nachname',required:true,max:120},
 email:{label:'E-Mail-Adresse',required:true,max:320,hint:'ImmoScout24 und Immowelt: Pflichtfeld beim Bewerben. Kleinanzeigen prüft das konkrete Formular. Immomio: nötig zum Verbinden des Kontos; beim Bewerben kein Feld.'},
 phone:{label:'Telefonnummer',required:true,max:80},
 street:{label:'Straße',required:true,max:160},
 house_number:{label:'Hausnummer',required:true,max:40},
 postcode:{label:'PLZ',required:true,max:10},
 city:{label:'Ort',required:true,max:120},
 household_type:{label:'Haushaltstyp',required:true,type:'choice'},
 employment_status:{label:'Beschäftigungsstatus',required:true,type:'choice',max:160},
 income_range:{label:'Haushalts-Nettoeinkommen',required:true,type:'choice'},
 pets:{label:'Haustiere',required:true,type:'choice',max:160},
 wbs_status:{label:'WBS-Status',required:true,max:160},
 move_in_preference:{label:'Einzugstermin',required:true,type:'choice'},
 move_in_date:{label:'Gewünschtes Einzugsdatum',required:true,type:'date'},
 household_size:{label:'Haushaltsgröße (Legacy)',type:'integer'},
 monthly_net_income:{label:'Monatliches Nettoeinkommen (Legacy)',type:'money'},
 schufa_status:{label:'SCHUFA-Status',required:true,type:'choice'},
 message_apartment:{label:'Bewerbungstext Wohnung',required:true,max:4000},
 message_house:{label:'Bewerbungstext Haus',required:true,max:4000},
 message_temporary_wg:{label:'Bewerbungstext Auf Zeit & WG',required:true,max:4000},
 message_swap:{label:'Bewerbungstext Tauschwohnung',required:true,max:4000}
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
 const sourceFor={immoscout:1,kleinanzeigen:2,immomio:3,immowelt:4};
 for(const row of data||[]){const source=sourceFor[row.provider];if(source)await applicationWorker('disconnect',userId,source).catch(()=>{});}
 await db.from('platform_connections').delete().eq('user_id',userId);
 await db.from('platform_auth_flows').delete().eq('user_id',userId);
 const {error:sessionError}=await db.from('platform_sessions').delete().eq('user_id',userId);
 if(sessionError)throw Error('Plattformsitzungen konnten nicht gelöscht werden.');
}

const connectionLabel=row=>{
 if(!row)return '⚪ nicht verbunden';
 if(row.status==='connected')return '🟢 verbunden';
 if(row.status==='pending')return '🟡 Anmeldung noch nicht abgeschlossen';
 if(row.status==='needs_login')return '🟠 erneut anmelden';
 return '🔴 Fehler';
};
const shown=(v,fallback='–')=>v==null||String(v).trim()===''?fallback:esc(v);
const salutationLabel=v=>SALUTATION_LABELS[v]||shown(v,'Keine Angabe');
const employmentLabel=v=>EMPLOYMENT_CHOICES[v]||shown(v,'Keine Angabe');
const schufaLabel=v=>v==='AVAILABLE'?'Vorhanden (&lt; 3 Monate)':v==='NOT_AVAILABLE'?'Nicht vorhanden':'Keine Angabe';
const householdLabel=p=>HOUSEHOLD_LABELS[p?.household_type]||shown(p?.household_size);
const incomeLabel=p=>INCOME_LABELS[p?.income_range]||(p?.monthly_net_income==null?'–':`${shown(p.monthly_net_income)} €`);
const moveInLabel=p=>p?.move_in_preference==='EXACT_DATE'
 ? `Genaues Datum · ${shown(p.move_in_date)}`
 : MOVE_IN_LABELS[p?.move_in_preference]||shown(p?.move_in_date);

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

async function ensureApplicantProfile(userId){
 const current=await readProfile(userId);
 if(current)return current;
 const {error}=await db.from('applicant_profiles').upsert({
  user_id:userId,
  first_name:'',
  last_name:'',
  updated_at:new Date().toISOString()
 },{onConflict:'user_id',ignoreDuplicates:true});
 if(error)throw Error('Bewerberprofil konnte nicht vorbereitet werden.');
 const created=await readProfile(userId);
 if(!created)throw Error('Bewerberprofil konnte nicht vorbereitet werden.');
 return created;
}

async function renderApplicantProfile(user,chat,messageId,notice=''){
 const [p,docs,missingResult]=await Promise.all([
  ensureApplicantProfile(user.id),
  readDocuments(user.id),
  db.rpc('application_profile_missing_fields',{p_user:user.id})
 ]);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 if(!p){
  return render(`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Noch kein Bewerberprofil vorbereitet.`,[
   [button('👤 Bewerberprofil öffnen','platforms:profile-new')],
   [button('← Start','home')]
  ]);
 }
 if(missingResult.error)throw Error('Profilstatus konnte nicht geladen werden.');
 const missing=Array.isArray(missingResult.data)?missingResult.data:[],missingSet=new Set(missing),ready=missing.length===0,selectedDocs=docs.filter(d=>d.send_with_auto_apply).length;
 const isMissing=(key,label)=>missingSet.has(key)||missingSet.has(label)||missingSet.has(PROFILE_FIELDS[key]?.label);
 const req=(key,label,value,required=false)=>`${label}${required&&isMissing(key,label)?' *':''}: ${isMissing(key,label)?'⚠️ fehlt':value}`;
 const messageCount=[p.message_apartment,p.message_house,p.message_temporary_wg,p.message_swap].filter(v=>String(v||'').trim()).length;
 const text=`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Profilstatus: ${ready?'✅ vollständig':`⚠️ ${missing.length} Pflichtfeld${missing.length===1?' offen':'n offen'}`}\n\n`+
  `${req('Anrede','Anrede',salutationLabel(p.salutation),true)}\n${req('Vorname','Vorname',shown(p.first_name),true)}\n${req('Nachname','Nachname',shown(p.last_name),true)}\n${req('E-Mail-Adresse','E-Mail',shown(p.email),true)}\n${req('Telefonnummer','Telefonnummer',shown(p.phone),true)}\n${req('Straße','Straße',shown(p.street),true)}\n${req('Hausnummer','Hausnummer',shown(p.house_number),true)}\n${req('PLZ','PLZ',shown(p.postcode),true)}\n${req('Ort','Ort',shown(p.city),true)}\n${req('Haushaltstyp','Haushaltstyp',householdLabel(p),true)}\n${req('Beschäftigungsstatus','Beschäftigungsstatus',employmentLabel(p.employment_status),true)}\n${req('Haushalts-Nettoeinkommen','Haushalts-Nettoeinkommen',incomeLabel(p),true)}\n${req('Haustiere','Haustiere',shown(p.pets),true)}\n${req('Einzugstermin','Einzugstermin',moveInLabel(p),true)}\n${req('SCHUFA-Status','SCHUFA-Status',schufaLabel(p.schufa_status),true)}\n${req('WBS-Status','WBS-Status',shown(p.wbs_status),true)}\n\n✍️ Bewerbungstexte: ${messageCount}/4 hinterlegt\n\nDokumente: ${docs.length} gespeichert · ${selectedDocs} ausgewählt`;
 const f=(name,label)=>{const clean=String(label).replace(/ \*$/,'');return button(isMissing(name,clean)?`${clean} *`:clean,`platforms:profile-field:${name}`)};
 return render(text,[
  [f('salutation','Anrede *'),f('schufa_status','SCHUFA *')],
  [f('first_name','Vorname *'),f('last_name','Nachname *')],
  [f('email','E-Mail *'),f('phone','Telefon *')],
  [f('street','Straße *'),f('house_number','Hausnr. *')],
  [f('postcode','PLZ *'),f('city','Ort *')],
  [f('household_type','Haushalt *'),f('employment_status','Beschäftigung *')],
  [f('income_range','Einkommen *'),f('pets','Haustiere *')],
  [f('move_in_preference','Einzugstermin *')],
  [f('wbs_status','WBS-Status *')],
  [button('✍️ Bewerbungstext','platforms:profile-texts')],
  [button('📎 Dokumente verwalten','platforms:docs')],
  [button('← Start','home')]
 ]);
}

async function renderApplicationTexts(user,chat,messageId){
 const p=await ensureApplicantProfile(user.id);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const entry=(name,label,value)=>{const clean=String(label).replace(/ \*$/,'');const filled=String(value??'').trim()!=='';return button(`${filled?'✅':'⚠️'} ${filled?clean:`${clean} *`}`,`platforms:profile-text:${name}`)};
 const text='✍️ <b>Bewerbungstext</b>\n\nWähle eine Wohnform, um den hinterlegten Bewerbungstext als Vorschau zu öffnen und zu bearbeiten.';
 return render(text,[
  [entry('message_house','Haus *',p.message_house),entry('message_apartment','Wohnung *',p.message_apartment)],
  [entry('message_temporary_wg','Auf Zeit & WG *',p.message_temporary_wg),entry('message_swap','Tauschwohnung *',p.message_swap)],
  [button('← Bewerberprofil','platforms:profile')]
 ]);
}

async function renderApplicationTextDetail(user,chat,messageId,name){
 const allowed=new Set(['message_apartment','message_house','message_temporary_wg','message_swap']);
 if(!allowed.has(name))return renderApplicationTexts(user,chat,messageId);
 const p=await ensureApplicantProfile(user.id);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const labels={
  message_apartment:'Wohnung',
  message_house:'Haus',
  message_temporary_wg:'Auf Zeit & WG',
  message_swap:'Tauschwohnung'
 };
 const raw=String(p[name]??'').trim();
 const max=3200,visible=raw.length>max?`${raw.slice(0,max-1)}…`:raw;
 const preview=raw
  ? `<blockquote>${esc(visible)}</blockquote>${raw.length>max?'\n<i>Vorschau gekürzt</i>':''}`
  : '⚠️ <i>Noch kein Bewerbungstext hinterlegt.</i>';
 const text=`✍️ <b>Bewerbungstext · ${esc(labels[name])}</b>\n\n${preview}`;
 return render(text,[
  [button('✏️ Bewerbungstext bearbeiten',`platforms:profile-field:${name}`)],
  [button('← Bewerbungstext','platforms:profile-texts')]
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
 const kleinUrl=kleinCallbackFromMessage(message),immomioUrl=immomioCallbackFromMessage(message),callbackUrl=kleinUrl||immomioUrl;
 if(callbackUrl){
  const source=kleinUrl?2:3,name=kleinUrl?'Kleinanzeigen':'Immomio';
  await telegram('deleteMessage',{chat_id:chat.id,message_id:message.message_id}).catch(()=>{});
  if(source===3&&!user.is_premium)return send(chat.id,`💎 Die ${name}-Verbindung benötigt Premium.`,{inline_keyboard:[[button('← Automatische Bewerbung','platforms')]]});
  try{
   const action=source===2?'complete_shared_login':'complete_login';
   const result=await applicationWorker(action,user.id,source,{callbackUrl});
   if(result?.authenticated!==true&&result?.status!=='connected')throw Error(`${name} konnte nicht verbunden werden.`);
   return send(chat.id,`✅ <b>${name} verbunden</b>\n\nDein Konto wurde erfolgreich verbunden.`,{inline_keyboard:[[button('← Automatische Bewerbung','platforms')]]});
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
 if(![2,3,5,6].includes(parts.length))return send(chat.id,'Bitte <code>Vorname | Nachname</code> eingeben; optional kannst du die E-Mail als dritten Wert ergänzen. Für ImmoScout24 und Immowelt ist die E-Mail erforderlich; Kleinanzeigen prüft die Formularpflichten beim Versand.');
  try{
   const values={
    user_id:user.id,
    first_name:validateField('first_name',parts[0]),last_name:validateField('last_name',parts[1]),email:parts.length>=3?validateField('email',parts[2]):null,...(parts.length>=5?{phone:validateField('phone',parts[3]),city:validateField('city',parts[4])}:{}),updated_at:new Date().toISOString()
   };
   if(parts.length===6){
    const legacySize=validateField('household_size',parts[5]);
    values.household_size=legacySize;
    values.household_type=legacySize===1?'SINGLE':legacySize===2?'TWO_ADULTS':null;
   }
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
   await ensureApplicantProfile(user.id);
   const value=validateField(name,text),patch=name==='move_in_date'
    ? {[name]:value,move_in_preference:'EXACT_DATE',updated_at:new Date().toISOString()}
    : {[name]:value,updated_at:new Date().toISOString()};
   const {error}=await db.from('applicant_profiles').update(patch).eq('user_id',user.id);if(error)throw Error('Änderung konnte nicht gespeichert werden.');
   await Promise.all([telegram('deleteMessage',{chat_id:chat.id,message_id:message.message_id}).catch(()=>{}),message.reply_to_message?.message_id?telegram('deleteMessage',{chat_id:chat.id,message_id:message.reply_to_message.message_id}).catch(()=>{}):null]);
   const messageField=name.startsWith('message_');
   return send(chat.id,`✅ ${esc(PROFILE_FIELDS[name].label)} gespeichert.`,{inline_keyboard:[[button(messageField?'✍️ Vorschau öffnen':'👤 Bewerberprofil',messageField?`platforms:profile-text:${name}`:'platforms:profile')],[button('← Automatische Bewerbung','platforms')]]});
  }catch(error){return send(chat.id,`⚠️ ${esc(error.message)}`);}
 }
 return null;
}

const AUTO_APPLY_PROVIDERS={
  1:{key:'immoscout',name:'ImmoScout24',field:'immoscout_enabled'},
  2:{key:'kleinanzeigen',name:'Kleinanzeigen',field:'kleinanzeigen_enabled'},
  3:{key:'immomio',name:'Immomio',field:'immomio_enabled'},
  4:{key:'immowelt',name:'Immowelt',field:'immowelt_enabled'}
};

export async function platformSessions(user,chat,messageId,data='platforms'){
 if(!privateOwner(user,chat))return;
 const parts=data.split(':'),action=parts[1]||'',arg=parts[2]||'',choice=parts.slice(3).join(':'),source=Number(arg);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const back=[[button('← Automatische Bewerbung','platforms')]];

 if(action==='profile'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  return renderApplicantProfile(user,chat,messageId);
 }
 if(action==='profile-new'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  await ensureApplicantProfile(user.id);
  return renderApplicantProfile(user,chat,messageId);
 }
 if(action==='profile-texts'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  return renderApplicationTexts(user,chat,messageId);
 }
 if(action==='profile-text'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  return renderApplicationTextDetail(user,chat,messageId,arg);
 }
 if(action==='profile-field'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  const current=await ensureApplicantProfile(user.id);
  const mark=(value,selected,label)=>value===selected?`✅ ${label}`:label;
  if(arg==='salutation'){
   const s=current?.salutation;
   return render('<b>Anrede</b>\n\nWähle eine Option.',[
    [button(mark('MR',s,'Herr'),'platforms:profile-set:salutation:MR'),button(mark('MS',s,'Frau'),'platforms:profile-set:salutation:MS')],
    [button(mark('DIVERSE',s,'Divers'),'platforms:profile-set:salutation:DIVERSE'),button(mark('NEUTRAL',s,'Neutral'),'platforms:profile-set:salutation:NEUTRAL')],
    [button(mark('NOT_SPECIFIED',s,'Keine Angabe'),'platforms:profile-set:salutation:NOT_SPECIFIED'),button(mark('COMPANY',s,'Firma'),'platforms:profile-set:salutation:COMPANY')],
    [button('← Bewerberprofil','platforms:profile')]
   ]);
  }
  if(arg==='household_type'){
   return render('<b>Haushaltstyp</b>\n\nWähle eine Option.',[
    [button(mark('SINGLE',current?.household_type,'Einpersonenhaushalt'),'platforms:profile-set:household_type:SINGLE'),button(mark('TWO_ADULTS',current?.household_type,'Zwei Erwachsene'),'platforms:profile-set:household_type:TWO_ADULTS')],
    [button(mark('FAMILY',current?.household_type,'Familie'),'platforms:profile-set:household_type:FAMILY'),button(mark('SHARED_FLAT',current?.household_type,'Wohngemeinschaft'),'platforms:profile-set:household_type:SHARED_FLAT')],
    [button(mark('NOT_SPECIFIED',current?.household_type,'Keine Angabe'),'platforms:profile-set:household_type:NOT_SPECIFIED')],
    [button('← Bewerberprofil','platforms:profile')]
   ]);
  }
  if(arg==='employment_status'){
   const e=current?.employment_status;
   return render('<b>Beschäftigungsstatus</b>\n\nWähle eine Option.',[
    [button(mark('NOT_SPECIFIED',e,'Keine Angabe'),'platforms:profile-set:employment_status:NOT_SPECIFIED')],
    [button(mark('EMPLOYEE',e,'Angestellte(r)'),'platforms:profile-set:employment_status:EMPLOYEE'),button(mark('WORKER',e,'Arbeiter(in)'),'platforms:profile-set:employment_status:WORKER')],
    [button(mark('SELF_EMPLOYED',e,'Selbstständige(r)'),'platforms:profile-set:employment_status:SELF_EMPLOYED'),button(mark('CIVIL_SERVANT',e,'Beamte(r)'),'platforms:profile-set:employment_status:CIVIL_SERVANT')],
    [button(mark('APPRENTICE',e,'Auszubildende(r)'),'platforms:profile-set:employment_status:APPRENTICE'),button(mark('STUDENT',e,'Studierende(r)'),'platforms:profile-set:employment_status:STUDENT')],
    [button(mark('DOCTORAL',e,'Doktorand(in)'),'platforms:profile-set:employment_status:DOCTORAL'),button(mark('HOMEMAKER',e,'Hausfrau/-mann'),'platforms:profile-set:employment_status:HOMEMAKER')],
    [button(mark('JOBSEEKER',e,'Arbeitssuchende(r)'),'platforms:profile-set:employment_status:JOBSEEKER'),button(mark('RETIRED',e,'Rentner(in)'),'platforms:profile-set:employment_status:RETIRED')],
    [button(mark('OTHER',e,'Sonstiges'),'platforms:profile-set:employment_status:OTHER')],
    [button('← Bewerberprofil','platforms:profile')]
   ]);
  }
  if(arg==='income_range'){
   return render('<b>Haushalts-Nettoeinkommen</b>\n\nWähle eine Option.',[
    [button(mark('HOUSING_BENEFIT',current?.income_range,'Ich beziehe Wohngeld'),'platforms:profile-set:income_range:HOUSING_BENEFIT')],
    [button(mark('UNDER_500',current?.income_range,'Unter 500 €'),'platforms:profile-set:income_range:UNDER_500'),button(mark('500_1000',current?.income_range,'500 € - 1.000 €'),'platforms:profile-set:income_range:500_1000')],
    [button(mark('1000_1500',current?.income_range,'1.000 € - 1.500 €'),'platforms:profile-set:income_range:1000_1500'),button(mark('1500_2000',current?.income_range,'1.500 € - 2.000 €'),'platforms:profile-set:income_range:1500_2000')],
    [button(mark('2000_3000',current?.income_range,'2.000 € - 3.000 €'),'platforms:profile-set:income_range:2000_3000'),button(mark('3000_4000',current?.income_range,'3.000 € - 4.000 €'),'platforms:profile-set:income_range:3000_4000')],
    [button(mark('4000_5000',current?.income_range,'4.000 € - 5.000 €'),'platforms:profile-set:income_range:4000_5000'),button(mark('5000_6000',current?.income_range,'5.000 € - 6.000 €'),'platforms:profile-set:income_range:5000_6000')],
    [button(mark('6000_7000',current?.income_range,'6.000 € - 7.000 €'),'platforms:profile-set:income_range:6000_7000'),button(mark('OVER_7000',current?.income_range,'Über 7.000 €'),'platforms:profile-set:income_range:OVER_7000')],
    [button(mark('NOT_SPECIFIED',current?.income_range,'Keine Angabe'),'platforms:profile-set:income_range:NOT_SPECIFIED')],
    [button('← Bewerberprofil','platforms:profile')]
   ]);
  }
  if(arg==='pets'){
   const p=current?.pets;
   return render('<b>Haustiere</b>\n\nWähle eine Option.',[
    [button(mark('Keine Angaben',p,'Keine Angaben'),'platforms:profile-set:pets:NONE')],
    [button(mark('Ja',p,'Ja'),'platforms:profile-set:pets:YES'),button(mark('Nein',p,'Nein'),'platforms:profile-set:pets:NO')],
    [button('← Bewerberprofil','platforms:profile')]
   ]);
  }
  if(arg==='move_in_preference'){
   const m=current?.move_in_preference;
   return render('<b>Gewünschtes Einzugsdatum</b>\n\nWähle eine Option.',[
    [button(mark('IMMEDIATE',m,'So bald wie möglich'),'platforms:profile-set:move_in_preference:IMMEDIATE'),button(mark('WITHIN_1_MONTH',m,'< 1 Monat'),'platforms:profile-set:move_in_preference:WITHIN_1_MONTH')],
    [button(mark('WITHIN_3_MONTHS',m,'< 3 Monate'),'platforms:profile-set:move_in_preference:WITHIN_3_MONTHS'),button(mark('AFTER_3_MONTHS',m,'> 3 Monate'),'platforms:profile-set:move_in_preference:AFTER_3_MONTHS')],
    [button(mark('FLEXIBLE',m,'Flexibel'),'platforms:profile-set:move_in_preference:FLEXIBLE'),button(mark('EXACT_DATE',m,'Genaues Datum'),'platforms:profile-set:move_in_preference:EXACT_DATE')],
    [button(mark('NOT_SPECIFIED',m,'Keine Angabe'),'platforms:profile-set:move_in_preference:NOT_SPECIFIED')],
    [button('← Bewerberprofil','platforms:profile')]
   ]);
  }
  if(arg==='schufa_status'){
   return render('<b>SCHUFA-Status</b>\n\nWähle eine Option.',[
    [button('Keine Angabe','platforms:profile-set:schufa_status:NOT_SPECIFIED')],
    [button('Vorhanden (< 3 Monate)','platforms:profile-set:schufa_status:AVAILABLE')],
    [button('Nicht vorhanden','platforms:profile-set:schufa_status:NOT_AVAILABLE')],
    [button('← Bewerberprofil','platforms:profile')]
   ]);
  }
  const prompt=fieldPrompt(arg);if(!prompt)return renderApplicantProfile(user,chat,messageId);
  return send(chat.id,prompt,{force_reply:true,selective:true,input_field_placeholder:PROFILE_FIELDS[arg].label});
 }
 if(action==='profile-set'){
  if(!user.is_premium)return render('Das Bewerberprofil für Auto-Bewerbungen benötigt Premium.',back);
  await ensureApplicantProfile(user.id);
  let patch=null;
  if(arg==='salutation'){
   if(!Object.hasOwn(SALUTATION_LABELS,choice))return renderApplicantProfile(user,chat,messageId);
   patch={salutation:choice};
  }else if(arg==='household_type'){
   if(!Object.hasOwn(HOUSEHOLD_LABELS,choice))return renderApplicantProfile(user,chat,messageId);
   patch={household_type:choice,household_size:choice==='SINGLE'?1:choice==='TWO_ADULTS'?2:null};
  }else if(arg==='employment_status'){
   if(!Object.hasOwn(EMPLOYMENT_CHOICES,choice))return renderApplicantProfile(user,chat,messageId);
   patch={employment_status:choice};
  }else if(arg==='income_range'){
   if(!Object.hasOwn(INCOME_LABELS,choice))return renderApplicantProfile(user,chat,messageId);
   patch={income_range:choice,monthly_net_income:null};
  }else if(arg==='pets'){
   const value=PET_CHOICES[choice];if(value===undefined)return renderApplicantProfile(user,chat,messageId);
   patch={pets:value};
  }else if(arg==='move_in_preference'){
   if(!Object.hasOwn(MOVE_IN_LABELS,choice))return renderApplicantProfile(user,chat,messageId);
   if(choice==='EXACT_DATE'){
    const prompt=fieldPrompt('move_in_date');
    return send(chat.id,prompt,{force_reply:true,selective:true,input_field_placeholder:'JJJJ-MM-TT'});
   }
   patch={move_in_preference:choice,move_in_date:null};
  }else if(arg==='schufa_status'){
   if(!['NOT_SPECIFIED','AVAILABLE','NOT_AVAILABLE'].includes(choice))return renderApplicantProfile(user,chat,messageId);
   patch={schufa_status:choice};
  }else return renderApplicantProfile(user,chat,messageId);
  const {error}=await db.from('applicant_profiles').update({...patch,updated_at:new Date().toISOString()}).eq('user_id',user.id);
  if(error)throw Error('Änderung konnte nicht gespeichert werden.');
  return renderApplicantProfile(user,chat,messageId);
 }

 if(action==='docs'){
  if(!user.is_premium)return render('Bewerberdokumente für Auto-Bewerbungen benötigen Premium.',back);
  return renderApplicantDocuments(user,chat,messageId);
 }
 if(action==='doc-upload'){
  if(!user.is_premium)return render('Bewerberdokumente für Auto-Bewerbungen benötigen Premium.',back);
  const meta=DOCUMENT_TYPES[arg];if(!meta)return renderApplicantDocuments(user,chat,messageId);
  await ensureApplicantProfile(user.id);
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
   if(!next)EdgeRuntime.waitUntil(applicationWorker('sync_documents',user.id,3).catch(()=>null));
  }
  return renderApplicantDocuments(user,chat,messageId);
 }
 if(action==='doc-delete'){
  if(!user.is_premium)return render('Bewerberdokumente für Auto-Bewerbungen benötigen Premium.',back);
  try{
   await deleteApplicantDocument(user.id,arg);
   EdgeRuntime.waitUntil(applicationWorker('sync_documents',user.id,3).catch(()=>null));
   return renderApplicantDocuments(user,chat,messageId,'Dokument gelöscht.');
  }catch(error){return renderApplicantDocuments(user,chat,messageId,`⚠️ ${esc(error.message)}`);}
 }

 if(action==='provider'){
  if(!user.is_premium)return render('Auto-Bewerbungen benötigen aktives Premium.',back);
  const meta=AUTO_APPLY_PROVIDERS[source];if(!meta)return;
  const {data:connection,error}=await db.from('platform_connections').select('provider,status').eq('user_id',user.id).eq('provider',meta.key).maybeSingle();
  if(error)throw Error('Plattform konnte nicht geladen werden.');
  if(connection?.status!=='connected'){
   return render(`<b>${meta.name}</b>\n\nKonto nicht verbunden.`,[
    [button(`🔐 ${meta.name} verbinden`,`platforms:login:${source}`)],
    ...back
   ]);
  }
  return render(`<b>${meta.name}</b>\n\nKonto verbunden.`,[
   [button('Verbindung prüfen',`platforms:check:${source}`)],
   [button('Verbindung trennen',`platforms:disconnect:${source}`)],
   ...back
  ]);
 }

 if(action==='pause'||action==='resume'){
  if(!user.is_premium)return render('Auto-Bewerbungen benötigen aktives Premium.',back);
  const meta=AUTO_APPLY_PROVIDERS[source];if(!meta)return;
  const {data:newer,error:newerError}=await db.from('bot_events')
   .select('telegram_update_id,payload')
   .eq('telegram_user_id',user.telegram_user_id)
   .gt('telegram_update_id',Number(user.request_update_id||0))
   .order('telegram_update_id',{ascending:false})
   .limit(20);
  if(newerError)throw Error('Plattform konnte nicht aktualisiert werden.');
  const superseded=(newer||[]).some(event=>{
   const value=String(event?.payload?.callback_query?.data||'');
   return value===`platforms:pause:${source}`||value===`platforms:resume:${source}`;
  });
  if(!superseded){
   const {error}=await db.rpc('set_application_provider_enabled_shared',{
    p_user:user.id,
    p_provider:meta.key,
    p_enabled:action==='resume'
   });
   if(error)throw Error(action==='resume'?'Plattform konnte nicht fortgesetzt werden.':'Plattform konnte nicht pausiert werden.');
  }
 }

 if(action==='login'||action==='disconnect'||action==='check'){
  if(![1,2,3,4].includes(source))return;
  if(action!=='disconnect'&&!user.is_premium)return render('Zum Verbinden ist Premium erforderlich.',back);
  const name=source===1?'ImmoScout24':source===2?'Kleinanzeigen':source===3?'Immomio':'Immowelt';
  if(source===1&&action==='login')return render('🔐 <b>ImmoScout24</b>\n\nDie Verbindung wird ohne offizielle ImmoScout-API über eine gespeicherte Web-Session umgesetzt. Der kontrollierte Login-/Sendetest ist noch ausstehend; deshalb wird hier aktuell noch keine produktive Session angelegt.',back);
  try{
   let workerAction=action;
   if(source===2&&action==='login'){
    let health=null;
    try{health=await applicationWorker('health',user.id,source);}catch{}
    workerAction=health?.kleinanzeigenOAuthClientProvisioned===true?'login':'login_share';
   }
   const extra=source===2&&action==='login'
    ?{origin:'telegram',returnTarget:'telegram',context:{channel:'telegram',...(workerAction==='login_share'?{share_flow:true}:{direct_oauth:true})}}
    :source===4&&action==='login'?{origin:'telegram',returnTarget:'telegram',context:{channel:'telegram'}}:{};
   const result=await applicationWorker(workerAction,user.id,source,extra);
   if(action==='disconnect')return render(`${name}: Verbindung gelöscht.`,back);
   if(action==='login'&&result.url){
    const note=source===4
     ? '<b>1.</b> Tippe unten auf <b>Immowelt verbinden</b>.\n<b>2.</b> Melde dich mit deinem Konto an.\n<b>3.</b> Dein Konto wird automatisch verbunden.\n\nNach erfolgreicher Anmeldung wird dein Konto als <b>verbunden</b> angezeigt.'
     : source===3
      ? '<b>1.</b> Öffne Immomio und melde dich normal an.\n<b>2.</b> Auf der Abschlussseite tippe auf <b>Teilen</b>.\n<b>3.</b> Wähle <b>Telegram → Traumwohnung – Hamburg → Senden</b>.\n\nDer Bot übernimmt den Rücksprung automatisch und speichert die Sitzung verschlüsselt.'
      : source===2&&result.bridgeRequired
       ? '<b>1.</b> Öffne Kleinanzeigen und melde dich normal an.\n<b>2.</b> Auf der Abschlussseite tippe auf <b>Teilen</b>.\n<b>3.</b> Wähle <b>Telegram → Traumwohnung Hamburg → Senden</b>.\n\nDer Bot erkennt den Rücksprung automatisch und löscht die geteilte Login-URL direkt wieder.'
       : result.automaticCallback
        ? 'Öffne Kleinanzeigen und melde dich ganz normal im Browser an. Danach wird die Verbindung automatisch abgeschlossen.'
        : 'Melde dich einmalig an. Danach bleibt die Verbindung gespeichert.';
    const loginLabel=source===4?`🌐 ${name} verbinden`:`🌐 ${name}-Login öffnen`;
    return render(`🔐 <b>${name} verbinden</b>\n\n${note}`,[[{text:loginLabel,web_app:{url:result.url}}],...back]);
   }
   return render(result.authenticated===true?`${name}: ✅ Verbindung bestätigt.`:result.authenticated===false?`${name}: Anmeldung erforderlich.`:`${name}: Verbindung gespeichert, aber noch nicht vollständig verifiziert.`,back);
  }catch(error){return render(error.message,back);}
 }

 if(action==='off'||action==='on'){
  const {data:newer,error:newerError}=await db.from('bot_events')
   .select('telegram_update_id,payload')
   .eq('telegram_user_id',user.telegram_user_id)
   .gt('telegram_update_id',Number(user.request_update_id||0))
   .order('telegram_update_id',{ascending:false})
   .limit(20);
  if(newerError)throw Error('Auto-Bewerbung konnte nicht aktualisiert werden.');
  const superseded=(newer||[]).some(event=>['platforms:on','platforms:off'].includes(String(event?.payload?.callback_query?.data||'')));
  if(!superseded){
   if(action==='off'){
    const {error}=await db.rpc('set_application_enabled_shared',{p_user:user.id,p_enabled:false});
    if(error)throw Error('Auto-Bewerbung konnte nicht deaktiviert werden.');
   }
   if(action==='on'){
    if(!user.is_premium)return render('Auto-Bewerbungen benötigen aktives Premium.',back);
    const {data:missing,error:missingError}=await db.rpc('application_profile_missing_fields',{p_user:user.id});
    if(missingError)throw Error('Bewerberprofil konnte nicht geprüft werden.');
    if(Array.isArray(missing)&&missing.length){
     const preview=missing.slice(0,8).map(v=>`• ${esc(v)}`).join('\n'),more=missing.length>8?`\n• … und ${missing.length-8} weitere`:'';
     return render(`⚠️ <b>Bewerberprofil unvollständig</b>\n\nVervollständige zuerst alle mit * markierten Pflichtfelder.\n\n${preview}${more}`,[[button('👤 Bewerberprofil vervollständigen','platforms:profile')],...back]);
    }
    const {error}=await db.rpc('set_application_enabled_shared',{p_user:user.id,p_enabled:true});
    if(error){
     const reason=String(error.message||'');
     const message=reason.includes('provider_required')
      ? 'Verbinde zuerst mindestens eine Bewerbungsplattform.'
      : reason.includes('profile_incomplete')
       ? 'Im Bewerberprofil fehlen noch Pflichtfelder.'
       : 'Der globale Auto-Bewerbungs-Schalter konnte nicht gespeichert werden. Bitte prüfe die Verbindung und versuche es erneut.';
     return render(`⚠️ <b>Auto-Bewerbung nicht aktiviert</b>\n\n${message}`,[[button('👤 Bewerberprofil','platforms:profile')],...back]);
    }
   }
  }
 }

  const [{data:connections,error},{data:state,error:stateError}]=await Promise.all([
  db.from('platform_connections').select('provider,status').eq('user_id',user.id),
  db.from('bot_users').select('auto_apply_enabled').eq('id',user.id).single()
 ]);
 if(error||stateError)throw Error('Auto-Bewerbung konnte nicht geladen werden.');
 const connection=(key)=>connections?.find(r=>r.provider===key);
 const rows=[];
 for(const sourceId of [1,2,3,4]){
  const meta=AUTO_APPLY_PROVIDERS[sourceId],connected=connection(meta.key)?.status==='connected';
  rows.push([connected
   ? button(`✅ ${meta.name}`,`platforms:provider:${sourceId}`)
   : button(`🔐 ${meta.name} verbinden`,`platforms:login:${sourceId}`)]);
 }
 rows.push([button(state.auto_apply_enabled?'⚡ Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',`platforms:${state.auto_apply_enabled?'off':'on'}`)]);
 rows.push([button('← Start','home')]);
 return render('⚡ <b>Automatische Bewerbung</b>\n\nVerbinde deine Plattformen und aktiviere oder deaktiviere die automatische Bewerbung zentral.',rows);

}
