import {db,secret,send,edit,sendCelebration,button,telegram,esc,runtimeEnv} from './runtime.js';
import {encryptProviderCredentials} from '../provider-credentials.js';
import {providerStaticMissing} from './application-profile-adapters.js';
import { DEFAULT_APPLICATION_TEXT, resolveApplicationText } from '../application-text.js';

const userFacingError=(error)=>{
 const reason=String(error?.message||error||'');
 const translated={
  test_mode_forbidden:'Der persönliche Testzugang ist nicht freigegeben.',
  test_mode_global_auto_apply_active:'Bitte zuerst die reguläre Auto-Bewerbung deaktivieren.',
  test_mode_profile_incomplete:'Bitte zuerst das Bewerberprofil vervollständigen.',
  test_mode_search_profile_missing:'Es fehlt ein aktives ImmoScout24-Suchprofil.',
  test_mode_central_account_unavailable:'Der zentrale ImmoScout24-Testzugang ist derzeit nicht verfügbar.',
  immomio_email_required:'Bitte im Bewerberprofil zuerst eine gültige E-Mail-Adresse eintragen.',
  auth_flow_expired:'Der Anmeldelink ist abgelaufen. Bitte erneut verbinden.',
  invalid_callback_url:'Der Anmeldelink ist ungültig.',
  provider_operation_not_supported:'Diese Aktion wird für die Plattform nicht unterstützt.',
  connection_read_failed:'Der Verbindungsstatus konnte nicht geladen werden.',
  disconnect_failed:'Die Plattformverbindung konnte nicht getrennt werden.',
  provider_not_allowlisted:'Diese Bewerbungsplattform ist nicht unterstützt.'
 };
 if(translated[reason])return translated[reason];
 return /^[a-z][a-z0-9_]+$/.test(reason)?'Die Aktion konnte nicht abgeschlossen werden. Bitte erneut versuchen.':reason;
};

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
 email:{label:'E-Mail-Adresse',required:true,max:320,hint:'Einheitliches Bewerberprofil für ImmoScout24, Immowelt, Immomio und Kleinanzeigen. Zusätzliche Formularpflichtfelder werden je Inserat geprüft.'},
 phone:{label:'Telefonnummer',required:true,max:80},
 street:{label:'Straße',required:true,max:160},
 house_number:{label:'Hausnummer',required:true,max:40},
 postcode:{label:'PLZ',required:true,max:10},
 city:{label:'Ort',required:true,max:120},
 household_type:{label:'Haushaltstyp',required:true,type:'choice'},
 employment_status:{label:'Beschäftigungsstatus',required:true,type:'choice',max:160},
 income_range:{label:'Haushalts-Nettoeinkommen',required:true,type:'choice'},
 pets:{label:'Haustiere',required:true,type:'choice',max:160},
 move_in_preference:{label:'Einzugstermin',required:true,type:'choice'},
 move_in_date:{label:'Gewünschtes Einzugsdatum',required:true,type:'date'},
 household_size:{label:'Haushaltsgröße (Legacy)',type:'integer'},
 monthly_net_income:{label:'Monatliches Nettoeinkommen (Legacy)',type:'money'},
 schufa_status:{label:'SCHUFA-Status',required:true,type:'choice'},
 message_apartment:{label:'Bewerbungstext Wohnung',required:false,max:4000},
 message_house:{label:'Bewerbungstext Haus',required:false,max:4000}
};
const DOCUMENT_BUCKET='applicant-documents';
const SETUP_PROMPT='👤 Bewerberprofil · Grundeinrichtung';
const FIELD_PROMPT_PREFIX='👤 Bewerberprofil · ';
const IMMOMIO_CALLBACK_ORIGIN='https://tenant.immomio.com';
const IMMOMIO_CALLBACK_PATH='/de/auth/login';

const IMMO_GQL='https://gql-ps.immomio.com/tenant/graphql';
const IMMO_SSO_QUERY=`query sso($email:String,$redirectUri:String!,$loginMethod:String){sso(input:{email:$email redirectUri:$redirectUri loginMethod:$loginMethod}){baseUrl clientId realm}}`;
const IMMO_REDIRECT='https://tenant.immomio.com/de/auth/login';
const immoRandom=()=>{let s='';for(const b of crypto.getRandomValues(new Uint8Array(32)))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const immoChallenge=async value=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function immoSso(email){const r=await fetch(IMMO_GQL,{method:'POST',headers:{'content-type':'application/json',accept:'application/json',origin:IMMOMIO_CALLBACK_ORIGIN},body:JSON.stringify({query:IMMO_SSO_QUERY,variables:{email,redirectUri:IMMO_REDIRECT,loginMethod:'DEFAULT'}}),signal:AbortSignal.timeout(20000)});const b=await r.json().catch(()=>null);const s=b?.data?.sso;if(!r.ok||b?.errors?.length||!s)throw Error('immomio_sso_failed');return{sso:s,baseUrl:'https://sso.immomio.com/auth',realm:'immomio',clientId:'immomio-oidc-web'};}
async function beginImmomioLogin(userId){const p=await db.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle();const email=String(p.data?.email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('immomio_email_required');const c=await immoSso(email),verifier=immoRandom(),state=immoRandom().slice(0,40),challenge=await immoChallenge(verifier);await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider','immomio').is('consumed_at',null);await db.from('platform_auth_flows').insert({id:crypto.randomUUID(),user_id:userId,provider:'immomio',state,code_verifier:verifier,origin:'telegram',return_target:'telegram',context:{channel:'telegram'},expires_at:new Date(Date.now()+10*60_000).toISOString()});await db.from('platform_connections').upsert({id:crypto.randomUUID(),user_id:userId,provider:'immomio',status:'pending',account_hint:email},{onConflict:'user_id,provider'});const url=new URL(`${c.baseUrl}/realms/${c.realm}/protocol/openid-connect/auth`);for(const[k,v]of Object.entries({client_id:c.clientId,redirect_uri:IMMO_REDIRECT,response_type:'code',scope:'openid profile email',state,code_challenge:challenge,code_challenge_method:'S256',login_hint:email,prompt:'login'}))url.searchParams.set(k,String(v));return{status:'login',url:url.href,expiresInSeconds:600};}
async function completeImmomioLogin(userId,callbackUrl){let u;try{u=new URL(String(callbackUrl||''));}catch{throw Error('invalid_callback_url')}if(u.protocol!=='https:'||u.hostname!=='tenant.immomio.com'||u.pathname!=='/de/auth/login')throw Error('invalid_callback_url');const state=u.searchParams.get('state'),code=u.searchParams.get('code');if(!state||!code)throw Error('invalid_callback_url');const flow=await db.from('platform_auth_flows').select('*').eq('user_id',userId).eq('provider','immomio').eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();if(flow.error||!flow.data)throw Error('auth_flow_expired');const p=await db.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle();const email=String(p.data?.email||'').trim().toLowerCase();const c=await immoSso(email);const response=await fetch(`${c.baseUrl}/realms/${c.realm}/protocol/openid-connect/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:IMMO_REDIRECT,code_verifier:String(flow.data.code_verifier),client_id:c.clientId}),signal:AbortSignal.timeout(20000)});const token=await response.json().catch(()=>null);if(!response.ok||!token?.access_token||!token?.refresh_token)throw Error('token_exchange_failed');const expiresAt=new Date(Date.now()+Math.max(60,Number(token.expires_in||300))*1000).toISOString();const credentials={access_token:String(token.access_token),refresh_token:String(token.refresh_token),expires_at:expiresAt,base_url:c.baseUrl,realm:c.realm,client_id:c.clientId,redirect_uri:IMMO_REDIRECT};const encrypted=await encryptProviderCredentials(runtimeEnv(),credentials,userId,'immomio');await db.from('platform_connections').upsert({id:crypto.randomUUID(),user_id:userId,provider:'immomio',status:'connected',ciphertext:encrypted.ciphertext,iv:encrypted.iv,key_version:encrypted.key_version,expires_at:expiresAt,updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.data.id);return{status:'connected',authenticated:true};}

async function beginCloudflareProviderLogin(userId, provider){
 const p=await db.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle();
 const email=String(p.data?.email||'').trim().toLowerCase();
 const state=immoRandom().slice(0,40),verifier=immoRandom();
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',provider).is('consumed_at',null);
 await db.from('platform_auth_flows').insert({id:crypto.randomUUID(),participant_id:userId,provider,state,code_verifier:verifier,origin:'telegram',return_target:'telegram',context:{channel:'telegram'},expires_at:new Date(Date.now()+30*60_000).toISOString()});
 await db.from('platform_connections').upsert({id:crypto.randomUUID(),user_id:userId,provider,status:'pending',account_hint:email||null},{onConflict:'user_id,provider'});
 return{status:'login',url:`https://login.traumwohnunghamburg.de/connect?ticket=${encodeURIComponent(state)}`,expiresInSeconds:1800};
}

export async function applicationWorker(action,userId,source,extra={}){
 const provider=source===1?'immoscout24':source===3?'immomio':source===4?'immowelt':null;
 if(!provider)throw Error('provider_not_allowlisted');
 if(action==='set_test_mode'){
  const {data,error}=await db.rpc('set_application_test_mode',{
   p_user:userId,
   p_telegram_user_id:Number(extra.telegramUserId||0),
   p_enabled:extra.enabled===true
  });
  if(error)throw error;
  return data||{enabled:extra.enabled===true};
 }
 if(action==='disconnect'){
  const {error}=await db.from('platform_connections').update({status:'disconnected',ciphertext:null,iv:null,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('provider',provider);
  if(error)throw Error('disconnect_failed');
  return {status:'disconnected'};
 }
 if(action==='check'){
  const {data,error}=await db.from('platform_connections').select('provider,status').eq('user_id',userId).eq('provider',provider).maybeSingle();
  if(error)throw Error('connection_read_failed');
  return {authenticated:data?.status==='connected',status:data?.status||'disconnected'};
 }
 if(action==='login' && source===3) return beginImmomioLogin(userId);
 if(action==='login' && (source===1||source===4)) return beginCloudflareProviderLogin(userId,provider);
 if(action==='complete_login' && source===3) return completeImmomioLogin(userId,extra.callbackUrl);
 throw Error('provider_operation_not_supported');
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
 const sourceFor={immoscout24:1,immoscout:1,immomio:3,immowelt:4};
 for(const row of data||[]){const source=sourceFor[row.provider];if(source)await applicationWorker('disconnect',userId,source).catch(()=>{});}
 await db.from('platform_connections').delete().eq('user_id',userId);
 await db.from('platform_auth_flows').delete().eq('user_id',userId);
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
export function immomioCallbackFromMessage(message){
 for(const candidate of callbackCandidates(message,/https:\/\/tenant\.immomio\.com\/de\/auth\/login[^\s<>"']*/gi)){const parsed=normalizeImmomioCallback(candidate);if(parsed)return parsed;}
 return null;
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

// A completion is a successful change to a required profile field that leaves
// the full applicant profile valid. Repeat the celebration on later edits too.
const completedFieldChanged=(previous,patch)=>Object.entries(patch).some(
 ([key,value])=>PROFILE_FIELDS[key]?.required===true&&String(previous?.[key]??'')!==String(value??'')
);

async function offerCompletedApplicantActivation(user,chat,changed){
 if(!changed)return;
 try{
  const {data:missing,error}=await db.rpc('application_profile_missing_fields',{p_user:user.id});
  if(error)throw error;
  if(Array.isArray(missing)&&missing.length===0){
   await sendCelebration(chat.id,
    '🎉 <b>Dein Bewerberprofil ist vollständig!</b>\n\nJetzt die automatische Bewerbung aktivieren und sofort Angebote erhalten?',
    {inline_keyboard:[
      [button('Ja, aktivieren','platforms:completion:yes')],
      [button('Nein, später','platforms:completion:no')]
    ]});
  }
 }catch(error){console.error('applicant_completion_prompt',String(error?.message||error));}
}

function applicantBackButton(user) {
 const fromAutoApply = user.onboarding_state?._applicant_return === 'platforms';
 return button(fromAutoApply ? '← Auto-Bewerbung' : '← Start',
  fromAutoApply ? 'platforms' : 'home');
}

async function rememberApplicantReturn(user, returnTo) {
 const state = { ...(user.onboarding_state || {}), _applicant_return: returnTo };
 const { error } = await db.rpc('save_ui_state', {
  p_user: user.id, p_step: user.onboarding_step || null, p_state: state
 });
 if (error) throw Error('Profilnavigation konnte nicht gespeichert werden.');
 return { ...user, onboarding_state: state };
}

async function renderApplicantProfile(user,chat,messageId,notice=''){
 const p=await ensureApplicantProfile(user.id);
 const {data:missing,error}=await db.rpc('application_profile_missing_fields',{p_user:user.id});
 if(error)throw Error('Profilstatus konnte nicht geladen werden.');
 const pending=Array.isArray(missing)?missing:[],missingSet=new Set(pending);
 const f=(name,label)=>{
  const required=PROFILE_FIELDS[name]?.required===true;
  const missing=required&&(missingSet.has(name)||missingSet.has(PROFILE_FIELDS[name]?.label));
  return button(missing?label+' *':label,'platforms:profile-field:'+name);
 };
 const text='👤 <b>Bewerberprofil</b>\n\n'
  +(notice?esc(notice)+'\n\n':'')
  +'Hinterlege deine Angaben für Vermieter und Bewerbungen. Ein gemeinsames Profil gilt für ImmoScout24, Immowelt, Immomio und Kleinanzeigen. Zusätzliche Pflichtangaben hängen vom jeweiligen Inserat ab. Unter <b>Profilvorschau</b> siehst du alle gespeicherten Daten.';
 const rows=[
  [f('salutation','Anrede'),f('schufa_status','SCHUFA')],
  [f('first_name','Vorname'),f('last_name','Nachname')],
  [f('email','E-Mail'),f('phone','Telefon')],
  [f('street','Straße'),f('house_number','Hausnr.')],
  [f('postcode','PLZ'),f('city','Ort')],
  [f('household_type','Haushalt'),f('employment_status','Beschäftigung')],
  [f('income_range','Einkommen'),f('pets','Haustiere')],
  [f('move_in_preference','Einzugstermin')],
  [button('✍️ Bewerbungstext ändern','platforms:profile-texts')],
  [button('👁 Profilvorschau','platforms:profile-preview')],
  [applicantBackButton(user)]
 ];
 return messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
}

async function renderApplicantProfilePreview(user,chat,messageId){
 const p=await ensureApplicantProfile(user.id);
 const {data:missing,error}=await db.rpc('application_profile_missing_fields',{p_user:user.id});
 if(error)throw Error('Profilstatus konnte nicht geladen werden.');
 const pending=Array.isArray(missing)?missing:[];
 const values=[
  ['Anrede',salutationLabel(p.salutation)],['Vorname',shown(p.first_name)],['Nachname',shown(p.last_name)],
  ['E-Mail',shown(p.email)],['Telefon',shown(p.phone)],['Straße',shown(p.street)],
  ['Hausnummer',shown(p.house_number)],['PLZ',shown(p.postcode)],['Ort',shown(p.city)],
  ['Haushalt',householdLabel(p)],['Beschäftigung',employmentLabel(p.employment_status)],
  ['Nettoeinkommen',incomeLabel(p)],['Haustiere',shown(p.pets)],
  ['Einzug',moveInLabel(p)],['SCHUFA',schufaLabel(p.schufa_status)],
 ];
 const title='👁 <b>Profilvorschau</b>\n\n'
  +(pending.length?'⚠️ '+pending.length+' Angaben fehlen noch.':'✅ Pflichtangaben vollständig.')+'\n\n';
 const body=values.map(([label,value])=>'<b>'+esc(label)+':</b> '+esc(value)).join('\n');
 const markup={inline_keyboard:[
  [button('✍️ Bewerbungstext ändern','platforms:preview-texts')],
  [button('🗑 Angaben löschen','platforms:profile-clear')],
  [button('← Bewerberprofil','platforms:profile-return')]
 ]};
 return messageId?edit(chat.id,messageId,title+body,markup):send(chat.id,title+body,markup);
}

async function renderApplicationTexts(user,chat,messageId,fromPreview=false){
 await ensureApplicantProfile(user.id);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const entry=(name,label)=>button(label,'platforms:'+(fromPreview?'preview-text:':'profile-text:')+name);
 return render('✍️ <b>Bewerbungstext</b>\n\nSchreibe oder passe deinen Bewerbungstext für den Vermieter an.',[
  [entry('message_apartment','🏢 Wohnung'),entry('message_house','🏡 Haus')],
  [button(fromPreview?'← Profilvorschau':'← Bewerberprofil',fromPreview?'platforms:profile-preview':'platforms:profile-return')]
 ]);
}

async function renderApplicationTextDetail(user,chat,messageId,name,fromPreview=false){
 if(!['message_apartment','message_house'].includes(name))return renderApplicationTexts(user,chat,messageId,fromPreview);
 const p=await ensureApplicantProfile(user.id);
 const label=name==='message_house'?'Haus':'Wohnung';
 const raw=String(p[name]??'').trim()||DEFAULT_APPLICATION_TEXT;
 const visible=resolveApplicationText(raw,p.first_name).slice(0,3200);
 const markup={inline_keyboard:[
  [button('✏️ Bewerbungstext bearbeiten','platforms:'+(fromPreview?'preview-edit:':'profile-field:')+name)],
  [button('← Bewerbungstext','platforms:'+(fromPreview?'preview-texts':'profile-texts'))]
 ]};
 return messageId?edit(chat.id,messageId,'✍️ <b>Bewerbungstext · '+label+'</b>\n\n<blockquote>'+esc(visible)+'</blockquote>',markup):
  send(chat.id,'✍️ <b>Bewerbungstext · '+label+'</b>\n\n<blockquote>'+esc(visible)+'</blockquote>',markup);
}

export async function clearPendingField(user,chat){
 const state={...(user.onboarding_state||{})};
 if(!state._applicant_field)return;
 const promptId=Number(state._applicant_prompt_message_id||0);
 delete state._applicant_field;
 delete state._applicant_message_id;
 delete state._applicant_prompt_message_id;
 delete state._applicant_text_origin;
 const {error}=await db.rpc('save_ui_state',{p_user:user.id,p_step:user.onboarding_step||null,p_state:state});
 if(error)throw Error('Profilnavigation konnte nicht gespeichert werden.');
 if(promptId>0&&chat?.id)await telegram('deleteMessage',{chat_id:chat.id,message_id:promptId}).catch(()=>{});
}

async function showFieldInput(user,chat,messageId,name,fromPreview=false){
 const meta=PROFILE_FIELDS[name];
 if(!meta)return renderApplicantProfile(user,chat,messageId);
 const state={...(user.onboarding_state||{}),_applicant_field:name,_applicant_message_id:Number(messageId)};
 if(fromPreview)state._applicant_text_origin='preview';
 else delete state._applicant_text_origin;
 const {error}=await db.rpc('save_ui_state',{p_user:user.id,p_step:user.onboarding_step||null,p_state:state});
 if(error)throw Error('Profileingabe konnte nicht gestartet werden.');
 const text='👤 <b>'+esc(meta.label)+'</b>\n\n'+fieldPrompt(name)
  +'\n\nSende den neuen Wert als nächste Nachricht im Chat.';
 const isText=name==='message_apartment'||name==='message_house';
 const back=[button(isText?'← Bewerbungstext':'← Bewerberprofil',isText?(fromPreview?'platforms:preview-texts':'platforms:profile-texts'):'platforms:profile-return')];
 const rendered=messageId?await edit(chat.id,messageId,text,{inline_keyboard:[back]})
  :await send(chat.id,text,{inline_keyboard:[back]});
 if(isText){
  const saved=await ensureApplicantProfile(user.id),template=String(saved[name]||'').trim()||DEFAULT_APPLICATION_TEXT;
  try{
   const prompt=await telegram('sendMessage',{
    chat_id:chat.id,parse_mode:'HTML',
    text:'✍️ <b>'+esc(meta.label)+' bearbeiten</b>\n\n'
      +'Antworte mit dem vollständigen neuen Text. <code>[[Vorname]]</code> wird in der Vorschau automatisch ersetzt.\n\n'
      +'<b>Aktueller Text:</b>\n<blockquote>'+esc(template.slice(0,2600))+'</blockquote>',
    reply_markup:{force_reply:true,selective:true,input_field_placeholder:'Deinen Bewerbungstext schreiben'}
   });
   if(prompt?.message_id){
    state._applicant_prompt_message_id=Number(prompt.message_id);
    const result=await db.rpc('save_ui_state',{p_user:user.id,p_step:user.onboarding_step||null,p_state:state});
    if(result.error)throw result.error;
   }
  }catch(e){console.error('application_text_force_reply_failed',String(e.message||e));}
 }
 return rendered;
}

function fieldPrompt(name){
 const meta=PROFILE_FIELDS[name];if(!meta)return null;
 const optional=meta.required?'':'\nOptional: Sende nur <code>-</code>, um den Wert zu löschen.';
 const extra=meta.type==='date'?'\nFormat: <code>JJJJ-MM-TT</code>':meta.type==='integer'?'\nZahl von 1 bis 20':meta.type==='money'?'\nNur den Betrag eingeben, z. B. <code>2500</code>':meta.hint?`\n${meta.hint}`:'';
 return `Bitte gib den neuen Wert ein.${extra}${optional}`;
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
 const callbackUrl=immomioCallbackFromMessage(message);
 if(callbackUrl){
  const source=3,name='Immomio';
  await telegram('deleteMessage',{chat_id:chat.id,message_id:message.message_id}).catch(()=>{});
  if(source===3&&!user.is_premium)return send(chat.id,`💎 Die ${name}-Verbindung benötigt Premium.`,{inline_keyboard:[[button('← Automatische Bewerbung','platforms')]]});
  try{
   const action='complete_login';
   const result=await applicationWorker(action,user.id,source,{callbackUrl});
   if(result?.authenticated!==true&&result?.status!=='connected')throw Error(`${name} konnte nicht verbunden werden.`);
   return send(chat.id,`✅ <b>${name} verbunden</b>\n\nDein Konto wurde erfolgreich verbunden.`,{inline_keyboard:[[button('← Automatische Bewerbung','platforms')]]});
  }catch(error){
   return send(chat.id,`⚠️ ${esc(error.message)}`,{inline_keyboard:[[button(`🔐 ${name} erneut verbinden`,`platforms:login:${source}`)],[button('← Automatische Bewerbung','platforms')]]});
  }
 }
 if(replied.startsWith(SETUP_PROMPT)){
  const parts=text.split('|').map(v=>v.trim());
 if(![2,3,5,6].includes(parts.length))return send(chat.id,'Bitte <code>Vorname | Nachname</code> eingeben; optional kannst du die E-Mail als dritten Wert ergänzen. Für ImmoScout24 und Immowelt ist die E-Mail erforderlich.');
  try{
   const previous=await readProfile(user.id);
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
   const result=await send(chat.id,'✅ Bewerberprofil angelegt.',{inline_keyboard:[[button('👤 Profil öffnen','platforms:profile-return')],[button('← Automatische Bewerbung','platforms')]]});
   await offerCompletedApplicantActivation(user,chat,completedFieldChanged(previous,values));
   return result;
  }catch(error){return send(chat.id,`⚠️ ${esc(error.message)}`);}
 }
 const pendingField=String(user.onboarding_state?._applicant_field||'');
 if((pendingField&&PROFILE_FIELDS[pendingField]&&text&&!text.startsWith('/'))||replied.startsWith(FIELD_PROMPT_PREFIX)){
  const label=replied.slice(FIELD_PROMPT_PREFIX.length).split('\n')[0].trim();
  const entry=pendingField&&PROFILE_FIELDS[pendingField]?[pendingField,PROFILE_FIELDS[pendingField]]:Object.entries(PROFILE_FIELDS).find(([,meta])=>meta.label===label);
  if(!entry)return null;
  const [name]=entry;
  try{
   const previous=await ensureApplicantProfile(user.id);
   const value=validateField(name,text),patch=name==='move_in_date'
    ? {[name]:value,move_in_preference:'EXACT_DATE',updated_at:new Date().toISOString()}
    : {[name]:value,updated_at:new Date().toISOString()};
   const {error}=await db.from('applicant_profiles').update(patch).eq('user_id',user.id);if(error)throw Error('Änderung konnte nicht gespeichert werden.');
   await Promise.all([telegram('deleteMessage',{chat_id:chat.id,message_id:message.message_id}).catch(()=>{}),message.reply_to_message?.message_id?telegram('deleteMessage',{chat_id:chat.id,message_id:message.reply_to_message.message_id}).catch(()=>{}):null]);
   const editMessageId=Number(user.onboarding_state?._applicant_message_id||0);
   let response;
   if(pendingField){
     await clearPendingField(user,chat);
     if(editMessageId>0){
       response=name.startsWith('message_')
         ? await renderApplicationTextDetail(user,chat,editMessageId,name,user.onboarding_state?._applicant_text_origin==='preview')
         : await renderApplicantProfile(user,chat,editMessageId,'✅ '+PROFILE_FIELDS[name].label+' gespeichert.');
     }
   }
   if(!response){
    const messageField=name.startsWith('message_');
    response=await send(chat.id,`✅ ${esc(PROFILE_FIELDS[name].label)} gespeichert.`,{inline_keyboard:[[button(messageField?'✍️ Vorschau öffnen':'👤 Bewerberprofil',messageField?`platforms:${user.onboarding_state?._applicant_text_origin==='preview'?'preview-text':'profile-text'}:${name}`:'platforms:profile-return')],[button('← Automatische Bewerbung','platforms')]]});
   }
   await offerCompletedApplicantActivation(user,chat,completedFieldChanged(previous,patch));
   return response;
  }catch(error){return send(chat.id,`⚠️ ${esc(error.message)}`);}
 }
 return null;
}

const AUTO_APPLY_PROVIDERS={
  1:{key:'immoscout24',name:'ImmoScout24',field:'immoscout_enabled'},
  3:{key:'immomio',name:'Immomio',field:'immomio_enabled'},
  4:{key:'immowelt',name:'Immowelt',field:'immowelt_enabled'},
  2:{key:'kleinanzeigen',name:'Kleinanzeigen',field:'kleinanzeigen_enabled'}
};

export async function platformSessions(user,chat,messageId,data='platforms'){
 if(!privateOwner(user,chat))return;
 const parts=data.split(':'),action=parts[1]||'',arg=parts[2]||'',choice=parts.slice(3).join(':'),source=Number(arg);
 const render=(text,rows)=>messageId?edit(chat.id,messageId,text,{inline_keyboard:rows}):send(chat.id,text,{inline_keyboard:rows});
 const back=[[button('← Automatische Bewerbung','platforms')]];

 if(action==='completion'){
  if(!['yes','no'].includes(arg))return platformSessions(user,chat,messageId,'platforms');
  const {data:activation,error}=await db.rpc('set_telegram_auto_apply_sources',{
    p_user:user.id,p_telegram_user_id:user.telegram_user_id,p_update_id:user.request_update_id,
    p_enabled:arg==='yes',p_from_completion:true
  });
  if(error){
   const reason=String(error.message||'');
   return render(reason.includes('profile_incomplete')
    ? 'Bitte zuerst alle Pflichtangaben im Bewerberprofil ausfüllen.'
    : reason.includes('test_mode_active')
    ? 'Bitte zuerst den persönlichen Testmodus deaktivieren.'
    : 'Die Quellen konnten nicht aktualisiert werden.',back);
  }
  const result=await platformSessions(user,chat,messageId,'platforms');
  if(arg==='yes'){
   await sendCelebration(chat.id,activation?.test_mode
     ? '🧪 <b>Testmodus aktiviert!</b>\n\nDie ausgewählten Quellen sind zum Testen gestartet. Auch Testbewerbungen können tatsächlich versendet werden.'
     : '🎉 <b>Automatische Bewerbung aktiviert!</b>\n\nImmoScout24, Immowelt und Immomio sind gestartet.')
    .catch(error=>console.error('auto_apply_activation_celebration',String(error?.message||error)));
  }
  return result;
 }

 if(action==='test'){
  if(!['on','off'].includes(arg)) return platformSessions(user,chat,messageId,'platforms:test-status');
  const enabled=arg==='on';
  try{
   const {error}=await db.rpc('set_telegram_auto_apply_sources',{
    p_user:user.id,p_provider:'immoscout24',p_enabled:enabled,
    p_telegram_user_id:user.telegram_user_id,p_update_id:user.request_update_id
   });
   if(error)throw error;
   return platformSessions(user,chat,messageId,'platforms');
  }catch(error){
   return render('⚠️ <b>Testmodus konnte nicht '+(enabled?'aktiviert':'deaktiviert')+' werden</b>\n\n'+esc(userFacingError(error)),[
    [button(enabled?'Test erneut aktivieren':'Test erneut deaktivieren','platforms:test:'+(enabled?'on':'off'))],
    ...back
   ]);
  }
 }

 if(action==='test-status'){
  const {data:state,error}=await db.from('bot_users')
    .select('test_auto_apply_allowed,test_auto_apply_enabled,test_auto_apply_daily_limit,test_auto_apply_enabled_at,auto_apply_enabled')
    .eq('id',user.id).single();
  if(error)throw Error('Teststatus konnte nicht geladen werden.');
  if(state?.test_auto_apply_allowed!==true)
    return render('Der persönliche ImmoScout24-Testzugang ist für dieses Konto nicht freigegeben.',back);
  let central=null;
  try {
    central=await runtimeEnv().HOUSING_DB.prepare(
      "SELECT status,enabled,last_verified_at FROM central_credentials WHERE singleton='central' LIMIT 1"
    ).first();
  } catch { /* A missing status is shown as unknown, never as connected. */ }
  const testEnabled=state.test_auto_apply_enabled===true&&state.auto_apply_enabled!==true;
  const credentialReady=central?.status==='connected';
  const verifiedAt=central?.last_verified_at?Date.parse(central.last_verified_at):NaN;
  const lastCheck=Number.isFinite(verifiedAt)
    ? new Date(verifiedAt).toLocaleString('de-DE')
    : 'nicht verifiziert';
  return render('🧪 <b>ImmoScout24 · Persönlicher Testzugang</b>\n\n'
    +'Testmodus: <b>'+(testEnabled?'Aktiv':'Deaktiviert')+'</b>\n'
    +'Gespeicherter Zugang: <b>'+(credentialReady?'Verbunden':'Nicht bestätigt')+'</b>\n'
    +'Letzte Prüfung: '+esc(lastCheck)+'\n'
    +'Tageslimit: <b>Keines</b>\n\n'
    +'Der Testzugang nutzt das zentrale NexaLabs-Konto unabhängig von der regulären Freigabe. '
    +'Ob ein Bewerbungsversand erfolgreich war, ist erst nach einer bestätigten Testbewerbung nachgewiesen.',
    [[button('← Auto-Bewerbung','platforms')]]);
 }

 if(user.onboarding_state?._applicant_clear_token && action!=='profile-clear' && action!=='profile-clear-confirm'){
  const state={...user.onboarding_state};
  delete state._applicant_clear_token;
  delete state._applicant_clear_issued_at;
  const result=await db.rpc('save_ui_state',{p_user:user.id,p_step:user.onboarding_step||null,p_state:state});
  if(result.error)throw Error('Profilnavigation konnte nicht gespeichert werden.');
  user={...user,onboarding_state:state};
 }

 if(action==='profile-clear'){
  await clearPendingField(user,chat);
  const token=crypto.randomUUID().replace(/-/g,'').slice(0,12);
  const state={...(user.onboarding_state||{}),_applicant_clear_token:token,_applicant_clear_issued_at:Date.now()};
  delete state._applicant_field;
  delete state._applicant_message_id;
  delete state._applicant_prompt_message_id;
  delete state._applicant_text_origin;
  const {error}=await db.rpc('save_ui_state',{p_user:user.id,p_step:user.onboarding_step||null,p_state:state});
  if(error)throw Error('Löschbestätigung konnte nicht geöffnet werden.');
  return render('🗑 <b>Angaben wirklich löschen?</b>\n\nAlle persönlichen Eingaben im Bewerberprofil einschließlich SCHUFA und Einzugstermin werden gelöscht. Die Auto-Bewerbung und alle drei Quellen werden pausiert. Deine Bewerbungstexte bleiben erhalten.',[
   [button('🗑 Ja, Angaben löschen','platforms:profile-clear-confirm:'+token)],
   [button('← Profilvorschau','platforms:profile-preview')]
  ]);
 }
 if(action==='profile-clear-confirm'){
  const {error}=await db.rpc('reset_applicant_profile_and_pause_auto_apply',{
   p_user:user.id,p_telegram_user_id:user.telegram_user_id,p_confirmation_token:arg
  });
  if(error)return render('⚠️ Diese Löschbestätigung ist ungültig oder abgelaufen. Bitte starte das Löschen erneut.',[
   [button('← Profilvorschau','platforms:profile-preview')]
  ]);
  return renderApplicantProfile(user,chat,messageId,'✅ Angaben gelöscht. Automatische Bewerbung und alle drei Quellen pausiert.');
 }

 if(action==='preview-texts'){
  await clearPendingField(user,chat);
  return renderApplicationTexts(user,chat,messageId,true);
 }
 if(action==='preview-text'){
  return renderApplicationTextDetail(user,chat,messageId,arg,true);
 }
 if(action==='preview-edit'){
  if(!['message_apartment','message_house'].includes(arg))return renderApplicationTexts(user,chat,messageId,true);
  return showFieldInput(user,chat,messageId,arg,true);
 }

 if(action==='profile' || action==='profile-return'){
  await clearPendingField(user,chat);
  if(action==='profile') user=await rememberApplicantReturn(user,'platforms');
  return renderApplicantProfile(user,chat,messageId);
 }
 if(action==='profile-new'){
  await ensureApplicantProfile(user.id);
  user=await rememberApplicantReturn(user,'home');
  return renderApplicantProfile(user,chat,messageId);
 }
 if(action==='profile-preview'){
  return renderApplicantProfilePreview(user,chat,messageId);
 }
 if(action==='profile-texts'){
  await clearPendingField(user,chat);
  return renderApplicationTexts(user,chat,messageId);
 }
 if(action==='profile-text'){
  return renderApplicationTextDetail(user,chat,messageId,arg);
 }
 if(action==='profile-field'){
  const current=await ensureApplicantProfile(user.id);
  const mark=(value,selected,label)=>value===selected?`✅ ${label}`:label;
  if(arg==='salutation'){
   const s=current?.salutation;
   return render('<b>Anrede</b>\n\nWähle eine Option.',[
    [button(mark('MR',s,'Herr'),'platforms:profile-set:salutation:MR'),button(mark('MS',s,'Frau'),'platforms:profile-set:salutation:MS')],
    [button(mark('DIVERSE',s,'Divers'),'platforms:profile-set:salutation:DIVERSE'),button(mark('NEUTRAL',s,'Neutral'),'platforms:profile-set:salutation:NEUTRAL')],
    [button(mark('NOT_SPECIFIED',s,'Keine Angabe'),'platforms:profile-set:salutation:NOT_SPECIFIED'),button(mark('COMPANY',s,'Firma'),'platforms:profile-set:salutation:COMPANY')],
    [button('← Bewerberprofil','platforms:profile-return')]
   ]);
  }
  if(arg==='household_type'){
   return render('<b>Haushaltstyp</b>\n\nWähle eine Option.',[
    [button(mark('SINGLE',current?.household_type,'Einpersonenhaushalt'),'platforms:profile-set:household_type:SINGLE'),button(mark('TWO_ADULTS',current?.household_type,'Zwei Erwachsene'),'platforms:profile-set:household_type:TWO_ADULTS')],
    [button(mark('FAMILY',current?.household_type,'Familie'),'platforms:profile-set:household_type:FAMILY'),button(mark('SHARED_FLAT',current?.household_type,'Wohngemeinschaft'),'platforms:profile-set:household_type:SHARED_FLAT')],
    [button(mark('NOT_SPECIFIED',current?.household_type,'Keine Angabe'),'platforms:profile-set:household_type:NOT_SPECIFIED')],
    [button('← Bewerberprofil','platforms:profile-return')]
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
    [button('← Bewerberprofil','platforms:profile-return')]
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
    [button('← Bewerberprofil','platforms:profile-return')]
   ]);
  }
  if(arg==='pets'){
   const p=current?.pets;
   return render('<b>Haustiere</b>\n\nWähle eine Option.',[
    [button(mark('Keine Angaben',p,'Keine Angaben'),'platforms:profile-set:pets:NONE')],
    [button(mark('Ja',p,'Ja'),'platforms:profile-set:pets:YES'),button(mark('Nein',p,'Nein'),'platforms:profile-set:pets:NO')],
    [button('← Bewerberprofil','platforms:profile-return')]
   ]);
  }
  if(arg==='move_in_preference'){
   const m=current?.move_in_preference;
   return render('<b>Gewünschtes Einzugsdatum</b>\n\nWähle eine Option.',[
    [button(mark('IMMEDIATE',m,'So bald wie möglich'),'platforms:profile-set:move_in_preference:IMMEDIATE'),button(mark('WITHIN_1_MONTH',m,'< 1 Monat'),'platforms:profile-set:move_in_preference:WITHIN_1_MONTH')],
    [button(mark('WITHIN_3_MONTHS',m,'< 3 Monate'),'platforms:profile-set:move_in_preference:WITHIN_3_MONTHS'),button(mark('AFTER_3_MONTHS',m,'> 3 Monate'),'platforms:profile-set:move_in_preference:AFTER_3_MONTHS')],
    [button(mark('FLEXIBLE',m,'Flexibel'),'platforms:profile-set:move_in_preference:FLEXIBLE'),button(mark('EXACT_DATE',m,'Genaues Datum'),'platforms:profile-set:move_in_preference:EXACT_DATE')],
    [button(mark('NOT_SPECIFIED',m,'Keine Angabe'),'platforms:profile-set:move_in_preference:NOT_SPECIFIED')],
    [button('← Bewerberprofil','platforms:profile-return')]
   ]);
  }
  if(arg==='schufa_status'){
   return render('<b>SCHUFA-Status</b>\n\nWähle eine Option.',[
    [button('Keine Angabe','platforms:profile-set:schufa_status:NOT_SPECIFIED')],
    [button('Vorhanden (< 3 Monate)','platforms:profile-set:schufa_status:AVAILABLE')],
    [button('Nicht vorhanden','platforms:profile-set:schufa_status:NOT_AVAILABLE')],
    [button('← Bewerberprofil','platforms:profile-return')]
   ]);
  }
  if(!PROFILE_FIELDS[arg])return renderApplicantProfile(user,chat,messageId);
  return showFieldInput(user,chat,messageId,arg);
 }
 if(action==='profile-set'){
  const previous=await ensureApplicantProfile(user.id);
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
    return showFieldInput(user,chat,messageId,'move_in_date');
   }
   patch={move_in_preference:choice,move_in_date:null};
  }else if(arg==='schufa_status'){
   if(!['NOT_SPECIFIED','AVAILABLE','NOT_AVAILABLE'].includes(choice))return renderApplicantProfile(user,chat,messageId);
   patch={schufa_status:choice};
  }else return renderApplicantProfile(user,chat,messageId);
  const {error}=await db.from('applicant_profiles').update({...patch,updated_at:new Date().toISOString()}).eq('user_id',user.id);
  if(error)throw Error('Änderung konnte nicht gespeichert werden.');
  const result=await renderApplicantProfile(user,chat,messageId);
  await offerCompletedApplicantActivation(user,chat,completedFieldChanged(previous,patch));
  return result;
 }

 if(action==='docs'||action.startsWith('doc-')) return renderApplicantProfile(user,chat,messageId);

 if(action==='provider'){
  if(source===2){
   const {data:missing,error}=await db.rpc('application_profile_missing_fields',{p_user:user.id});
   if(error)throw Error('Bewerberprofil konnte nicht geprüft werden.');
   return render('<b>Kleinanzeigen</b>\n\nDas gemeinsame Bewerberprofil wird auch für Kleinanzeigen verwendet.'
     +'\nProfil: '+(Array.isArray(missing)&&missing.length===0?'Pflichtangaben vollständig':'Bitte fehlende Basisangaben ergänzen')
     +'\nZusätzliche Pflichtfelder werden dynamisch je Kontaktformular geprüft.'
     +'\n\n'+(runtimeEnv().CENTRAL_KLEINANZEIGEN_SEND_ENABLED==='1'?'Versandversuche freigeschaltet. Die Bestätigung wird je Inserat geprüft; Start/Pause über die Plattformliste.':'Automatischer Versand ist noch nicht freigegeben, da die Nachrichten-Schnittstelle nicht verifiziert ist.'),[
      [button('👤 Bewerberprofil','platforms:profile')], ...back
     ]);
  }
  const meta=AUTO_APPLY_PROVIDERS[source];if(!meta)return;
  return render(`<b>${meta.name}</b>\n\nDie Plattform wird zentral von NexaLabs verwaltet. Du musst kein eigenes Plattformkonto verbinden.`,back);
 }

 if(action==='pause'||action==='resume'){
  const meta=AUTO_APPLY_PROVIDERS[source];if(!meta)return;
  if(source===2 && action==='resume' && runtimeEnv().CENTRAL_KLEINANZEIGEN_SEND_ENABLED!=='1') return render('Kleinanzeigen-Versand ist noch nicht verifiziert und kann nicht gestartet werden.',back);
  if(action==='resume'){
   const {data:missing,error:profileError}=await db.rpc('application_profile_missing_fields',{p_user:user.id});
   if(profileError)throw Error('Bewerberprofil konnte nicht geprüft werden.');
   if(Array.isArray(missing)&&missing.length){
    return render('⚠️ <b>Bewerberprofil unvollständig</b>\n\nBitte vervollständige zuerst dein Bewerberprofil, damit Auto-Bewerbungen gestartet werden können.',[
     [button('👤 Bewerberprofil vervollständigen','platforms:profile')],
     ...back
    ]);
   }
  }
  const {error}=await db.rpc('set_telegram_auto_apply_sources',{
   p_user:user.id,
   p_provider:meta.key,
   p_enabled:action==='resume',
   p_update_id:user.request_update_id,
   p_telegram_user_id:user.telegram_user_id
  });
  if(error){
   const reason=String(error.message||'');
   if(reason.includes('profile_incomplete'))return render('⚠️ <b>Bewerberprofil unvollständig</b>\n\nBitte vervollständige zuerst dein Bewerberprofil.',[
    [button('👤 Bewerberprofil vervollständigen','platforms:profile')],
    ...back
   ]);
   return render(reason.includes('test_mode_active')
    ? 'Bitte deaktiviere zuerst den persönlichen Testmodus.'
    : 'Die Quelle konnte nicht aktualisiert werden.',back);
  }
 }

 if(action==='login'||action==='disconnect'||action==='check'){
  return render('Die Plattformzugänge werden zentral verwaltet. Eine persönliche Verknüpfung ist nicht erforderlich.',back);
 }

 if(action==='off'||action==='on'){
  const {error}=await db.rpc('set_telegram_auto_apply_sources',{
    p_user:user.id,p_telegram_user_id:user.telegram_user_id,p_enabled:action==='on',p_update_id:user.request_update_id
  });
  if(error){
   const reason=String(error.message||'');
   return render(reason.includes('profile_incomplete')
    ? '⚠️ Bitte vervollständige zuerst dein Bewerberprofil.'
    : reason.includes('test_mode_active')
    ? '⚠️ Ein vorhandener Testmodus verhindert das Starten. Bitte kontaktiere den Support.'
    : 'Die Auto-Bewerbung konnte nicht aktualisiert werden.',back);
  }
 }

  const [{data:state,error:stateError},{data:preferences,error:preferencesError}]=await Promise.all([
  db.from('bot_users').select('auto_apply_enabled,test_auto_apply_allowed,test_auto_apply_enabled,test_auto_apply_daily_limit,test_auto_apply_enabled_at,test_auto_apply_disabled_at').eq('id',user.id).single(),
  db.from('application_preferences').select('immoscout_enabled,immowelt_enabled,immomio_enabled,kleinanzeigen_enabled').eq('user_id',user.id).maybeSingle()
 ]);
 if(stateError||preferencesError)throw Error('Auto-Bewerbung konnte nicht geladen werden.');
 const isTestAccount=state.test_auto_apply_allowed===true&&Number(user.telegram_user_id)===8538226539;
 const rows=[];
 const statusLines=[];
 let activeCount=0;
 const kaAvailable=runtimeEnv().CENTRAL_KLEINANZEIGEN_SEND_ENABLED==='1';
 const visibleSenders=kaAvailable?[1,4,3,2]:[1,4,3];
 for(const sourceId of visibleSenders){
  const meta=AUTO_APPLY_PROVIDERS[sourceId];
  const running=(isTestAccount?state.test_auto_apply_enabled===true:state.auto_apply_enabled===true)&&preferences?.[meta.field]===true;
  if(running)activeCount++;
  statusLines.push(meta.name+' · '+(running?'Aktiv':'Pausiert'));
  rows.push([button(running?'🟢 '+meta.name+' pausieren':'🔴 '+meta.name+' starten',
   'platforms:'+(running?'pause':'resume')+':'+sourceId)]);
 }

 // Fourth platform shares the same dynamic profile and is always discoverable.
 if(!kaAvailable){
  statusLines.push('Kleinanzeigen · Versand noch nicht freigegeben');
  rows.push([button('⚪ Kleinanzeigen · Profil & Status','platforms:provider:2')]);
 }

 // Confirm the persisted state after each button press. A stale Telegram
 // callback can be safely ignored; never imply that a send was enabled.
 const changedProvider=(action==='resume'||action==='pause')?AUTO_APPLY_PROVIDERS[source]:null;
 const changedAll=action==='on'||action==='off';
 const expectedOn=action==='resume'||action==='on';
 const actualProviderOn=changedProvider
   ? (isTestAccount?state.test_auto_apply_enabled===true:state.auto_apply_enabled===true)
     &&preferences?.[changedProvider.field]===true
   :null;
 const actualAllOn=(isTestAccount?state.test_auto_apply_enabled===true:state.auto_apply_enabled===true)
   &&visibleSenders.every(id=>preferences?.[AUTO_APPLY_PROVIDERS[id].field]===true);
 const actualAllOff=(isTestAccount?state.test_auto_apply_enabled!==true:state.auto_apply_enabled!==true)
   &&visibleSenders.every(id=>preferences?.[AUTO_APPLY_PROVIDERS[id].field]!==true);
 const applied=changedProvider?actualProviderOn===expectedOn
   :changedAll?(expectedOn?actualAllOn:actualAllOff):null;
 const label=changedProvider?.name||'Alle Quellen';
 const controlNotice=applied===null?'':applied
   ?'✅ <b>'+esc(label)+'</b>: '+(expectedOn?'gestartet':'pausiert')
     +(isTestAccount?' (persönlicher Testversand)':'')+'\n\n'
   :'⚠️ Der Schalter wurde nicht geändert. Bitte öffne die Ansicht erneut und versuche es noch einmal.\n\n';

 // Global controls affect the owner's test selections or regular auto-apply, not housing search.
 rows.push([button(activeCount===visibleSenders.length?'Alle pausieren':'Alle starten',
  activeCount===visibleSenders.length?'platforms:off':'platforms:on')]);
 const centralNote=isTestAccount
  ? '\n\n🧪 <b>Persönlicher Testmodus</b>: Start/Pause steuert deinen persönlichen Testversand. Er funktioniert unabhängig von der zentralen Freigabe für andere Nutzer.'
  : runtimeEnv().CENTRAL_AUTO_APPLY_ENABLED==='1'?''
   :'\n\nℹ️ Der automatische Versand ist derzeit zentral noch nicht freigegeben.';
 rows.push([button('← Start','home')]);
 return render('⚡ <b>Automatische Bewerbung</b>\n\n'+controlNotice+'<b>'+activeCount+' von '+visibleSenders.length+' Plattformen aktiv</b>\n'+statusLines.join('\n')+'\n\n'+(isTestAccount
  ? 'Aktiviere oder pausiere den persönlichen Testmodus für einzelne Quellen oder alle Quellen.'
  : 'Starte oder pausiere den automatischen Bewerbungsversand je Quelle oder für alle Quellen.')+' Die Wohnungssuche bleibt davon unberührt. Plattformzugänge werden zentral verwaltet. Kleinanzeigen ist als vierte Plattform aufgeführt und nutzt dasselbe Bewerberprofil. Der Versand richtet sich nach der geprüften Transportfreigabe.'+centralNote,rows);

}
