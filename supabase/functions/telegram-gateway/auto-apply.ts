const URL=Deno.env.get('SUPABASE_URL')!;
const PREMIUM_LINK='https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01';
const KEYS=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const KEY=KEYS.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WORKER=`${URL}/functions/v1/application-worker`;
const IMMOMIO_WORKER=`${URL}/functions/v1/immomio-account`;
const SCOUT_HANDOFF=`${URL}/functions/v1/immoscout-native-handoff`;
const REQUIRED=[
 'salutation','first_name','last_name','email','phone','street','house_number','postcode','city',
 'household_type','employment_status','income_range','pets','move_in_preference','schufa_status',
 'message_apartment','message_house','message_temporary_wg','message_swap'
];
const HOUSEHOLD_LABELS:Record<string,string>={SINGLE:'Einpersonenhaushalt',TWO_ADULTS:'Zwei Erwachsene',FAMILY:'Familie',SHARED_FLAT:'Wohngemeinschaft'};
const INCOME_LABELS:Record<string,string>={
 UNDER_500:'Unter 500€','500_1000':'500€ - 1.000€','1000_1500':'1.000€ - 1.500€','1500_2000':'1.500€ - 2.000€',
 '2000_3000':'2.000€ - 3.000€','3000_4000':'3.000€ - 4.000€','4000_5000':'4.000€ - 5.000€',OVER_5000:'Über 5000€'
};
const MOVE_IN_LABELS:Record<string,string>={NOT_SPECIFIED:'Keine Angaben',FLEXIBLE:'Flexibel',IMMEDIATE:'Sofort',EXACT_DATE:'Genaues Datum'};
const SETUP_PROMPT='👤 Bewerberprofil · Grundeinrichtung';
const FIELD_PROMPT_PREFIX='👤 Bewerberprofil · ';
const PROFILE_FIELDS:Record<string,any>={
 salutation:{label:'Anrede',required:true,max:40},
 first_name:{label:'Vorname',required:true,max:120},last_name:{label:'Nachname',required:true,max:120},
 email:{label:'E-Mail-Adresse',required:true,max:320},phone:{label:'Telefonnummer',required:true,max:80},
 street:{label:'Straße',required:true,max:160},house_number:{label:'Hausnummer',required:true,max:40},postcode:{label:'PLZ',required:true,max:10},city:{label:'Ort',required:true,max:120},
 household_type:{label:'Haushaltsgröße',required:true,type:'choice'},employment_status:{label:'Beschäftigungsart',required:true,type:'choice',max:160},income_range:{label:'Netto Haushaltseinkommen',required:true,type:'choice'},
 pets:{label:'Haustiere',required:true,type:'choice',max:160},wbs_status:{label:'WBS-Status',max:160},move_in_preference:{label:'Einzugstermin',required:true,type:'choice'},move_in_date:{label:'Gewünschtes Einzugsdatum',required:true,type:'date'},
 household_size:{label:'Haushaltsgröße (Legacy)',type:'integer'},monthly_net_income:{label:'Monatliches Nettoeinkommen (Legacy)',type:'money'},
 schufa_status:{label:'SCHUFA-Status',required:true,max:40},
 message_apartment:{label:'Bewerbungstext Wohnung',required:true,max:4000},
 message_house:{label:'Bewerbungstext Haus',required:true,max:4000},
 message_temporary_wg:{label:'Bewerbungstext Auf Zeit & WG',required:true,max:4000},
 message_swap:{label:'Bewerbungstext Tauschwohnung',required:true,max:4000}
};
function headers(extra:Record<string,string>={}){return {apikey:KEY,Authorization:`Bearer ${KEY}`,'content-type':'application/json',...extra};}
async function rpc(name:string,body:Record<string,unknown>){const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body)}),data=await r.json().catch(()=>null);if(!r.ok)throw Error(`${name}:${r.status}`);return data;}
async function rows(table:string,params:Record<string,string>){const url=new globalThis.URL(`${URL}/rest/v1/${table}`);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);const r=await fetch(url,{headers:headers()}),data=await r.json().catch(()=>[]);if(!r.ok)throw Error(`${table}:${r.status}`);return Array.isArray(data)?data:[];}
async function patch(table:string,params:Record<string,string>,values:Record<string,unknown>){const url=new globalThis.URL(`${URL}/rest/v1/${table}`);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);const r=await fetch(url,{method:'PATCH',headers:headers({Prefer:'return=minimal'}),body:JSON.stringify(values)});if(!r.ok)throw Error(`${table}:${r.status}`);}
async function upsert(table:string,conflict:string,values:Record<string,unknown>){const url=new globalThis.URL(`${URL}/rest/v1/${table}`);url.searchParams.set('on_conflict',conflict);const r=await fetch(url,{method:'POST',headers:headers({Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify(values)});if(!r.ok)throw Error(`${table}:${r.status}`);}
const secretCache=new Map<string,{value:string,expiresAt:number}>();
async function secret(name:string){const cached=secretCache.get(name);if(cached&&cached.expiresAt>Date.now())return cached.value;const data=await rpc('get_bot_secret',{secret_name:name});if(!data)throw Error('secret_unavailable');const value=String(data);secretCache.set(name,{value,expiresAt:Date.now()+300000});return value;}
async function telegram(method:string,body:Record<string,unknown>){const token=await secret('telegram_bot_token_runtime');const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json().catch(()=>null);if(!r.ok||!data?.ok)throw Error('telegram_failed');return data.result;}
async function worker(action:string,userId:string,source=0,extra:Record<string,unknown>={}){const internal=await secret('internal_worker_secret');const endpoint=source===3?IMMOMIO_WORKER:WORKER;const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},body:JSON.stringify({action,userId,source,...extra}),signal:AbortSignal.timeout(45000)});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.error||`worker:${r.status}`);return data;}
function premium(user:any,subscription:any){const now=Date.now();if(user?.plan_override==='free')return false;if(user?.plan_override==='premium'&&(!user.plan_override_expires_at||Date.parse(user.plan_override_expires_at)>now))return true;if(user?.referral_bonus_until&&Date.parse(user.referral_bonus_until)>now)return true;return !!subscription&&['active','trialing'].includes(String(subscription.status||''))&&(!subscription.current_period_end||Date.parse(subscription.current_period_end)>now);}
function button(text:string,callback_data:string){return {text,callback_data};}
function esc(v:any){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
async function edit(chatId:number,messageId:number,text:string,inline_keyboard:any[]){try{return await telegram('editMessageText',{chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:{inline_keyboard}});}catch(error:any){const message=String(error?.message||error||'');if(/message is not modified/i.test(message))return null;if(/message to edit not found|message can't be edited|message_id_invalid|there is no text in the message to edit/i.test(message))return telegram('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:{inline_keyboard}});throw error;}}
async function send(chatId:number,text:string,inline_keyboard?:any[]){return telegram('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,...(inline_keyboard?{reply_markup:{inline_keyboard}}:{})});}
async function forceReply(chatId:number,text:string,placeholder:string){return telegram('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:{force_reply:true,selective:true,input_field_placeholder:placeholder}});}
const ready=(p:any)=>!!p&&REQUIRED.every(k=>{
 if(k==='household_type')return Object.hasOwn(HOUSEHOLD_LABELS,String(p[k]||''));
 if(k==='income_range')return Object.hasOwn(INCOME_LABELS,String(p[k]||''));
 if(k==='move_in_preference')return Object.hasOwn(MOVE_IN_LABELS,String(p[k]||''))&&(p[k]!=='EXACT_DATE'||!!p.move_in_date);
 return String(p[k]??'').trim();
});
const shown=(v:any,fallback='–')=>v==null||String(v).trim()===''?fallback:esc(v);
const householdLabel=(p:any)=>HOUSEHOLD_LABELS[p?.household_type]||shown(p?.household_size);
const incomeLabel=(p:any)=>INCOME_LABELS[p?.income_range]||(p?.monthly_net_income==null?'–':`${shown(p.monthly_net_income)} €`);
const moveInLabel=(p:any)=>p?.move_in_preference==='EXACT_DATE'?`Genaues Datum · ${shown(p.move_in_date)}`:(MOVE_IN_LABELS[p?.move_in_preference]||shown(p?.move_in_date));
async function profile(userId:string){return (await rows('applicant_profiles',{user_id:`eq.${userId}`,select:'*',limit:'1'}))[0]||null;}
function connectionLabel(c:any){const s=c?.status;return s==='connected'?'🟢 verbunden':s==='pending'?'🟡 Anmeldung offen':s==='needs_login'?'🟠 erneut anmelden':s?'🔴 Fehler':'⚪ nicht verbunden';}

export function isAutoApplyCallback(data:string){
 if(data==='platforms:profile'||data==='platforms:profile-new'||data==='platforms:profile-texts'||data.startsWith('platforms:profile-text:')||data.startsWith('platforms:profile-field:')||data.startsWith('platforms:profile-set:')||data==='platforms:docs'||data.startsWith('platforms:doc-'))return false;
 return data==='platforms'||data.startsWith('platforms:');
}
export function isAutoApplyMessage(update:any){const m=update?.message;if(!m?.text)return false;const text=String(m.text),reply=String(m.reply_to_message?.text||'');return /https:\/\/tenant\.immomio\.com\/de\/auth\/login/i.test(text)||/immobilienscout24\.de:\/loginCallback/i.test(text)||reply.startsWith(SETUP_PROMPT)||reply.startsWith(FIELD_PROMPT_PREFIX);}

async function profilePage(user:any,chatId:number,messageId:number,notice=''){
 const p=await profile(user.id);
 if(!p)return edit(chatId,messageId,`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Noch kein Bewerberprofil angelegt. Die Eingabe erfolgt direkt in Telegram.`,[[button('➕ Bewerberprofil anlegen','platforms:profile-new')],[button('← Automatische Bewerbung','platforms')]]);
 const address=[p.street,p.house_number].filter(Boolean).join(' ');
 const text=`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Status: ${ready(p)?'✅ vollständig':'⚠️ unvollständig'}\n\nAnrede: ${shown(p.salutation)}\nVorname: ${shown(p.first_name)}\nNachname: ${shown(p.last_name)}\nE-Mail: ${shown(p.email)}\nTelefon: ${shown(p.phone)}\nAdresse: ${shown(address)}\nPLZ / Ort: ${shown([p.postcode,p.city].filter(Boolean).join(' '))}\nHaushaltsgröße: ${householdLabel(p)}\nBeschäftigungsart: ${shown(p.employment_status)}\nNetto Haushaltseinkommen: ${incomeLabel(p)}\nHaustiere: ${shown(p.pets)}\nWBS: ${shown(p.wbs_status)}\nEinzugstermin: ${moveInLabel(p)}\nBewerbungstext: ${[p.message_apartment,p.message_house,p.message_temporary_wg,p.message_swap].filter(Boolean).length}/4 hinterlegt`;
 const f=(n:string,l:string)=>button(l,`platforms:profile-field:${n}`);
 return edit(chatId,messageId,text,[[f('first_name','Vorname'),f('last_name','Nachname')],[f('email','E-Mail'),f('phone','Telefon')],[f('salutation','Anrede'),f('household_type','Haushalt')],[f('street','Straße'),f('house_number','Hausnr.')],[f('postcode','PLZ'),f('city','Ort')],[f('employment_status','Beschäftigung'),f('income_range','Einkommen')],[f('pets','Haustiere')],[f('move_in_preference','Einzugstermin')],[button('✍️ Bewerbungstext','platforms:profile-texts')],[button('← Automatische Bewerbung','platforms')]]);
}

async function platformPage(user:any,chatId:number,messageId:number,notice=''){
 if(!user.is_premium){
  const checkout=`${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}`;
  const text='🔒 <b>Automatische Bewerbung</b>\n\nDie automatische Bewerbung ist mit Premium verfügbar.\n\nMit Premium können passende Bewerbungen automatisch über deine verbundenen Plattformen versendet werden.\n\nNach dem Upgrade kannst du die Einrichtung hier fortsetzen.';
  const buttons=[[{text:'💎 Jetzt abonnieren',url:checkout}],[button('← Zurück','home')]];
  return edit(chatId,messageId,text,buttons);
 }
 const [connections,prefsRows]=await Promise.all([
  rows('platform_connections',{user_id:`eq.${user.id}`,select:'provider,status'}),
  rows('application_preferences',{user_id:`eq.${user.id}`,select:'enabled,immoscout_enabled,immomio_enabled,immowelt_enabled',limit:'1'})
 ]);
 const prefs=prefsRows?.[0]||{enabled:user.auto_apply_enabled===true,immoscout_enabled:user.auto_apply_enabled===true,immomio_enabled:user.auto_apply_enabled===true,immowelt_enabled:false};
 const providerMeta=[
  {id:1,key:'immoscout',name:'ImmoScout24',field:'immoscout_enabled'},
  {id:3,key:'immomio',name:'Immomio',field:'immomio_enabled'},
  {id:4,key:'immowelt',name:'Immowelt',field:'immowelt_enabled'}
 ];
 const conn=(provider:string)=>connections.find((item:any)=>item.provider===provider);
 const buttons:any[]=[[button('👤 Bewerberprofil','platforms:profile')]];
 for(const meta of providerMeta){
  const connected=conn(meta.key)?.status==='connected';
  if(!connected){
   buttons.push([button(`🔐 ${meta.name} verbinden`,`platforms:login:${meta.id}`)]);
   continue;
  }
  const enabled=prefs[meta.field]!==false;
  buttons.push([
   button(`✅ ${meta.name}`,`platforms:provider:${meta.id}`),
   button(enabled?'⏸ Pausieren':'▶ Fortsetzen',`platforms:${enabled?'pause':'resume'}:${meta.id}`)
  ]);
 }
 buttons.push([button(prefs.enabled?'⚡ Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',prefs.enabled?'platforms:off':'platforms:on')]);
 buttons.push([button('← Einstellungen','settings')]);
 const text=`⚡ <b>Automatische Bewerbung</b>\n\nVerwalte dein Bewerberprofil und deine Plattformen. Auto-Bewerbungen kannst du jederzeit pro Plattform pausieren.${notice?`\n\n${notice}`:''}`;
 return edit(chatId,messageId,text,buttons);
}

async function providerPage(user:any,chatId:number,messageId:number,source:number){
 const meta=source===1?{key:'immoscout',name:'ImmoScout24'}:source===3?{key:'immomio',name:'Immomio'}:source===4?{key:'immowelt',name:'Immowelt'}:null;
 if(!meta)return platformPage(user,chatId,messageId);
 const connection=(await rows('platform_connections',{user_id:`eq.${user.id}`,provider:`eq.${meta.key}`,select:'provider,status',limit:'1'}))[0]||null;
 if(connection?.status!=='connected'){
  return edit(chatId,messageId,`<b>${meta.name}</b>\n\nKonto nicht verbunden.`,[[button(`🔐 ${meta.name} verbinden`,`platforms:login:${source}`)],[button('← Automatische Bewerbung','platforms')]]);
 }
 return edit(chatId,messageId,`<b>${meta.name}</b>\n\nKonto verbunden.`,[[button('Verbindung prüfen',`platforms:check:${source}`)],[button('Verbindung trennen',`platforms:disconnect:${source}`)],[button('← Automatische Bewerbung','platforms')]]);
}

function fieldPrompt(name:string){const m=PROFILE_FIELDS[name];if(!m)return null;const extra=m.type==='date'?'\nFormat: <code>JJJJ-MM-TT</code>':m.type==='integer'?'\nZahl von 1 bis 20':m.type==='money'?'\nNur den Betrag eingeben, z. B. <code>2500</code>':m.hint?`\n${m.hint}`:'';const optional=m.required?'':'\nOptional: Sende <code>-</code>, um den Wert zu löschen.';return `${FIELD_PROMPT_PREFIX}${m.label}\n\nBitte antworte auf diese Nachricht mit dem neuen Wert.${extra}${optional}`;}
function validateField(name:string,input:any){const m=PROFILE_FIELDS[name];if(!m)throw Error('Unbekanntes Profilfeld.');const raw=String(input??'').trim();if(raw==='-'&&!m.required)return null;if(!raw&&m.required)throw Error(`${m.label} darf nicht leer sein.`);if(!raw)return null;if(name==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))throw Error('Bitte eine gültige E-Mail-Adresse ein.');if(name==='phone'&&(raw.length<3||raw.length>80))throw Error('Bitte eine gültige Telefonnummer eingeben.');if(name==='postcode'&&!/^\d{5}$/.test(raw))throw Error('Bitte eine fünfstellige PLZ eingeben.');if(m.type==='integer'){const n=Number(raw);if(!Number.isInteger(n)||n<1||n>20)throw Error('Haushaltsgröße muss zwischen 1 und 20 liegen.');return n;}if(m.type==='money'){const n=Number(raw.replace(/\./g,'').replace(',','.'));if(!Number.isFinite(n)||n<0||n>1000000)throw Error('Bitte ein gültiges monatliches Nettoeinkommen eingeben.');return n;}if(m.type==='date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||Number.isNaN(Date.parse(`${raw}T00:00:00Z`)))throw Error('Bitte das Datum als JJJJ-MM-TT eingeben.');return raw;}if(raw.length>(m.max||4000))throw Error(`${m.label} ist zu lang.`);return raw;}
function immomioCallbackUrl(text:string){const match=String(text||'').match(/https:\/\/tenant\.immomio\.com\/de\/auth\/login[^\s<>]*/i);if(!match)return null;try{const u=new globalThis.URL(match[0].replace(/&amp;/g,'&').replace(/[\])},.;!?]+$/g,''));return u.hostname==='tenant.immomio.com'&&u.pathname==='/de/auth/login'&&u.searchParams.get('state')&&u.searchParams.get('code')?u.href:null;}catch{return null;}}
function scoutCallbackUrl(text:string){const match=String(text||'').match(/immobilienscout24\.de:\/loginCallback[^\s<>]*/i);if(!match)return null;try{const u=new globalThis.URL(match[0].replace(/&amp;/g,'&').replace(/[\])},.;!?]+$/g,''));const params=new URLSearchParams(u.hash.replace(/^#/,'').replace(/^\?/,''));return u.protocol==='immobilienscout24.de:'&&u.pathname==='/loginCallback'&&(params.get('state')||u.searchParams.get('state'))&&(params.get('code')||u.searchParams.get('code')||params.get('error')||u.searchParams.get('error'))?u.href:null;}catch{return null;}}


async function handlePlatforms(user:any,chatId:number,messageId:number,data:string){
 const parts=data.split(':'),action=parts[1]||'',arg=parts[2]||'',source=Number(arg);
 if(!user.is_premium && action!=='disconnect')return platformPage(user,chatId,messageId);
 if(!action)return platformPage(user,chatId,messageId);
 if(action==='profile')return user.is_premium?profilePage(user,chatId,messageId):platformPage(user,chatId,messageId,'💎 Bewerberprofile benötigen Premium.');
 if(action==='profile-new'){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Bewerberprofile benötigen Premium.');
  if(await profile(user.id))return profilePage(user,chatId,messageId);
  await forceReply(chatId,`${SETUP_PROMPT}\n\nAntworte in <b>einer Nachricht</b> mit diesen 5 Angaben, getrennt durch <code>|</code>:\n\n<code>Vorname | Nachname | E-Mail | Telefon | Ort</code>\n\nBeispiel:\n<code>Max | Mustermann | max@example.de | +49 170 1234567 | Hamburg</code>\n\nDie ImmoScout-Auswahlfelder legst du danach direkt über Buttons fest.`,'Vorname | Nachname | E-Mail | Telefon | Ort');return;
 }
 if(action==='profile-field'){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Bewerberprofile benötigen Premium.');const prompt=fieldPrompt(arg);if(!prompt)return profilePage(user,chatId,messageId);await forceReply(chatId,prompt,PROFILE_FIELDS[arg].label);return;
 }
 if(action==='provider'&&[1,3,4].includes(source))return providerPage(user,chatId,messageId,source);
 if((action==='pause'||action==='resume')&&[1,3,4].includes(source)){
  const provider=source===1?'immoscout':source===3?'immomio':'immowelt';
  try{
   await rpc('set_application_provider_enabled_shared',{p_user:user.id,p_provider:provider,p_enabled:action==='resume'});
   return platformPage(user,chatId,messageId);
  }catch{
   return platformPage(user,chatId,messageId,action==='resume'?'⚠️ Plattform konnte nicht fortgesetzt werden.':'⚠️ Plattform konnte nicht pausiert werden.');
  }
 }
  if(action==='on'){
   if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Auto-Bewerbung benötigt Premium.');
   try{
    const missing=await rpc('application_profile_missing_fields',{p_user:user.id});
    if(Array.isArray(missing)&&missing.length){
     const preview=missing.slice(0,8).map((v:any)=>`• ${esc(v)}`).join('\n'),more=missing.length>8?`\n• … und ${missing.length-8} weitere`:'';
     return platformPage(user,chatId,messageId,`⚠️ <b>Bewerberprofil unvollständig</b>\n\nVervollständige zuerst alle mit * markierten Pflichtfelder.\n\n${preview}${more}`);
    }
    await rpc('set_application_enabled_shared',{p_user:user.id,p_enabled:true});
    user.auto_apply_enabled=true;
    
    return platformPage(user,chatId,messageId,'');
   }catch{
    return platformPage(user,chatId,messageId,'⏳ <b>Immowelt ist verbunden.</b>\n\nDein Bewerberprofil ist vollständig. Die automatische Bewerbung für Immowelt wird freigegeben, sobald der technische Versandtest erfolgreich bestätigt wurde.');
   }
  }
 if(action==='off'){await rpc('set_application_enabled_shared',{p_user:user.id,p_enabled:false});user.auto_apply_enabled=false;return platformPage(user,chatId,messageId,'');}
 if(action==='login'&&source===1)return edit(chatId,messageId,'🔐 <b>ImmoScout24</b>\n\nDie Verbindung wird ohne offizielle ImmoScout-API über eine gespeicherte Web-Session umgesetzt. Der kontrollierte Login-/Sendetest ist noch ausstehend; deshalb wird aktuell noch keine produktive Session angelegt.',[[button('← Automatische Bewerbung','platforms')]]);
 if(action==='login'&&source===3){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Plattform-Verbindungen benötigen Premium.');
  try{const result=await worker('login',user.id,3);return edit(chatId,messageId,'🔐 <b>Immomio verbinden</b>\n\n<b>1.</b> Öffne Immomio und melde dich mit deinem normalen Immomio-Konto an.\n<b>2.</b> Nach erfolgreichem Login bleibst du auf einer normalen Immomio-Seite – es wird keine Datei mehr heruntergeladen.\n<b>3.</b> Tippe dort auf <b>Teilen → Telegram → Traumwohnung – Hamburg → Senden</b>.\n\nDer Bot übernimmt den Rücksprung automatisch, speichert nur die verschlüsselte Sitzung und löscht die geteilte Login-URL wieder. Dein Passwort bleibt ausschließlich bei Immomio.',[[{text:'🌐 Immomio-Login öffnen',url:result.url}],[button('← Automatische Bewerbung','platforms')]]);}catch(error:any){const note=error?.message==='immomio_email_required'?'Im Bewerberprofil fehlt eine gültige E-Mail-Adresse.':'Immomio-Login konnte nicht gestartet werden.';return platformPage(user,chatId,messageId,`⚠️ ${note}`);}
 }
 if(action==='login'&&source===4){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Plattform-Verbindungen benötigen Premium.');
  try{
   const result=await worker('login',user.id,4,{origin:'telegram',returnTarget:'telegram',context:{channel:'telegram'}});
   return edit(chatId,messageId,'🔐 <b>Immowelt verbinden</b>\n\nÖffne den sicheren Login und melde dich einmalig mit deinem Immowelt-Konto an. Das Passwort wird nicht gespeichert; nach erfolgreicher Anmeldung wird nur die verschlüsselte Sitzung übernommen. Zusätzliche Sicherheitsprüfungen werden nicht umgangen.',[[{text:'🌐 Immowelt-Login öffnen',url:result.url}],[button('← Automatische Bewerbung','platforms')]]);
  }catch{return platformPage(user,chatId,messageId,'⚠️ Immowelt-Login konnte nicht gestartet werden.');}
 }
 if(action==='check'&&[1,3,4].includes(source)){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Plattform-Verbindungen benötigen Premium.');
  try{const result=await worker('check',user.id,source);const name=source===1?'ImmoScout24':source===3?'Immomio':'Immowelt';return platformPage(user,chatId,messageId,result.authenticated===true?`✅ ${name}-Verbindung bestätigt.`:result.authenticated===null?`${name}: Verbindung gespeichert; der Sendepfad ist noch nicht freigegeben.`:`⚠️ ${name} bitte erneut verbinden.`);}catch{return platformPage(user,chatId,messageId,'⚠️ Verbindung konnte nicht bestätigt werden.');}
 }
 if(action==='disconnect'&&[1,3,4].includes(source)){
  try{await worker('disconnect',user.id,source);const key=source===1?'immoscout':source===3?'immomio':'immowelt';await patch('application_preferences',{user_id:`eq.${user.id}`},{[key+'_enabled']:false,updated_at:new Date().toISOString()}).catch(()=>{});return platformPage(user,chatId,messageId,'Plattformverbindung gelöscht.');}catch{return platformPage(user,chatId,messageId,'⚠️ Verbindung konnte nicht gelöscht werden.');}
 }
 return platformPage(user,chatId,messageId);
}

async function preparedUser(update:any){const prepared=await rpc('prepare_telegram_update',{p_payload:update}),claim=Number(prepared?.claim??0);if(claim<=0)return null;const user={...(prepared.user||{}),is_premium:premium(prepared.user,prepared.subscription)};return {prepared,claim,user,updateId:Number(update.update_id)};}
async function finish(updateId:number,claim:number,ok:boolean,error:string|null=null){await rpc('finish_telegram_update',{p_update_id:updateId,p_attempt:claim,p_success:ok,p_error:error});}

export async function handleAutoApplyCallback(update:any){const query=update?.callback_query,chat=query?.message?.chat,chatId=Number(chat?.id),messageId=Number(query?.message?.message_id),fromId=Number(query?.from?.id),data=String(query?.data||'');if(!fromId||!chatId||!messageId||chat?.type!=='private'||fromId!==chatId||!isAutoApplyCallback(data))return;let ctx:any=null;try{ctx=await preparedUser(update);if(!ctx)return;const {user,claim,updateId}=ctx,owns=user.is_active&&Number(user.telegram_user_id)===fromId&&Number(user.chat_id)===chatId;if(!owns){await finish(updateId,claim,true);ctx=null;return;}if(data==='platforms'||data.startsWith('platforms:'))await handlePlatforms(user,chatId,messageId,data);await finish(updateId,claim,true);ctx=null;}catch(error){console.error('auto_apply_callback',String(error));if(ctx)await finish(ctx.updateId,ctx.claim,false,String(error)).catch(()=>{});}}

export async function handleAutoApplyMessage(update:any){const message=update?.message,chat=message?.chat,chatId=Number(chat?.id),fromId=Number(message?.from?.id);if(!fromId||!chatId||chat?.type!=='private'||fromId!==chatId||!isAutoApplyMessage(update))return;let ctx:any=null;try{ctx=await preparedUser(update);if(!ctx)return;const {user,claim,updateId}=ctx,owns=user.is_active&&Number(user.telegram_user_id)===fromId&&Number(user.chat_id)===chatId;if(!owns){await finish(updateId,claim,true);ctx=null;return;}const text=String(message.text||'').trim(),immomioUrl=immomioCallbackUrl(text),scoutUrl=scoutCallbackUrl(text);
 if(immomioUrl||scoutUrl){
  const source=scoutUrl?1:3,name=source===1?'ImmoScout24':'Immomio',url=scoutUrl||immomioUrl;
  await telegram('deleteMessage',{chat_id:chatId,message_id:message.message_id}).catch(()=>{});
  try{
   if(!user.is_premium)await send(chatId,`💎 ${name}-Verbindungen benötigen Premium.`);
   else{
    const result=source===1?await (async()=>{const r=await fetch(SCOUT_HANDOFF,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'complete',userId:user.id,callbackUrl:url}),signal:AbortSignal.timeout(45000)}),data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.error||`worker:${r.status}`);return data;})():await worker('complete_login',user.id,source,{callbackUrl:url});
    await send(chatId,result.authenticated===true?`✅ <b>${name} verbunden</b>\n\nDie Anmeldung ist verschlüsselt gespeichert. Du musst dich für künftige Bewerbungen nicht erneut anmelden, solange ${name} die Sitzung nicht widerruft.`:`⚠️ ${name} konnte nicht verbunden werden.`,[[button('⚡ Automatische Bewerbung','platforms')]]);
   }
  }catch(error:any){
   const friendly=error?.message==='auth_flow_expired'?`Die ${name}-Anmeldung ist abgelaufen. Bitte erneut verbinden.`:error?.message==='invalid_callback_url'?`Der ${name}-Rücksprung ist unvollständig. Bitte den Login erneut starten.`:error?.message==='token_exchange_failed'?`${name} konnte die Anmeldung nicht abschließen. Bitte erneut versuchen.`:`${name} konnte nicht verbunden werden.`;
   await send(chatId,`⚠️ ${esc(friendly)}`,[[button(`🔐 ${name} erneut verbinden`,`platforms:login:${source}`)],[button('← Automatische Bewerbung','platforms')]]);
  }
  await finish(updateId,claim,true);ctx=null;return;
 }
 const replied=String(message.reply_to_message?.text||'');
 if(replied.startsWith(SETUP_PROMPT)){const parts=text.split('|').map((v:string)=>v.trim());if(![5,6].includes(parts.length))await send(chatId,'Bitte genau 5 Werte mit <code>|</code> trennen:\nVorname | Nachname | E-Mail | Telefon | Ort');else try{const values:any={user_id:user.id,first_name:validateField('first_name',parts[0]),last_name:validateField('last_name',parts[1]),email:validateField('email',parts[2]),phone:validateField('phone',parts[3]),city:validateField('city',parts[4]),updated_at:new Date().toISOString()};if(parts.length===6){const legacySize=validateField('household_size',parts[5]);values.household_size=legacySize;values.household_type=legacySize===1?'SINGLE':legacySize===2?'TWO_ADULTS':null;}await upsert('applicant_profiles','user_id',values);await Promise.all([telegram('deleteMessage',{chat_id:chatId,message_id:message.message_id}).catch(()=>{}),message.reply_to_message?.message_id?telegram('deleteMessage',{chat_id:chatId,message_id:message.reply_to_message.message_id}).catch(()=>{}):null]);await send(chatId,'✅ Bewerberprofil angelegt.',[[button('👤 Profil öffnen','platforms:profile')],[button('← Automatische Bewerbung','platforms')]]);}catch(error:any){await send(chatId,`⚠️ ${esc(error.message)}`);}await finish(updateId,claim,true);ctx=null;return;}
 if(replied.startsWith(FIELD_PROMPT_PREFIX)){const label=replied.slice(FIELD_PROMPT_PREFIX.length).split('\n')[0].trim(),entry=Object.entries(PROFILE_FIELDS).find(([,m]:any)=>m.label===label);if(entry){const [name]=entry;try{if(!await profile(user.id))await send(chatId,'Bitte zuerst die Grundeinrichtung des Bewerberprofils abschließen.',[[button('➕ Bewerberprofil anlegen','platforms:profile-new')]]);else{const value=validateField(name,text),values=name==='move_in_date'?{[name]:value,move_in_preference:'EXACT_DATE',updated_at:new Date().toISOString()}:{[name]:value,updated_at:new Date().toISOString()};await patch('applicant_profiles',{user_id:`eq.${user.id}`},values);await Promise.all([telegram('deleteMessage',{chat_id:chatId,message_id:message.message_id}).catch(()=>{}),message.reply_to_message?.message_id?telegram('deleteMessage',{chat_id:chatId,message_id:message.reply_to_message.message_id}).catch(()=>{}):null]);await send(chatId,`✅ ${esc(PROFILE_FIELDS[name].label)} gespeichert.`,[[button('👤 Bewerberprofil','platforms:profile')],[button('← Automatische Bewerbung','platforms')]]);}}catch(error:any){await send(chatId,`⚠️ ${esc(error.message)}`);}}await finish(updateId,claim,true);ctx=null;return;}
 await finish(updateId,claim,true);ctx=null;
 }catch(error){console.error('auto_apply_message',String(error));if(ctx)await finish(ctx.updateId,ctx.claim,false,String(error)).catch(()=>{});}}
