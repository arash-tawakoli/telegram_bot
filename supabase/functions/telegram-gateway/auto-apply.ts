const URL=Deno.env.get('SUPABASE_URL')!;
const PREMIUM_LINK='https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01';
const KEYS=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const KEY=KEYS.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WORKER=`${URL}/functions/v1/application-worker`;
const IMMOMIO_WORKER=`${URL}/functions/v1/immomio-account`;
const DISPATCHER=`${URL}/functions/v1/notification-dispatcher?forceFunctionRegion=eu-west-1`;
const REQUIRED=['first_name','last_name','email','phone','city','household_size'];
const SETUP_PROMPT='👤 Bewerberprofil · Grundeinrichtung';
const FIELD_PROMPT_PREFIX='👤 Bewerberprofil · ';
const PROFILE_FIELDS:Record<string,any>={
 salutation:{label:'Anrede',hint:'z. B. Herr, Frau oder Divers',max:40},
 first_name:{label:'Vorname',required:true,max:120},last_name:{label:'Nachname',required:true,max:120},
 email:{label:'E-Mail',required:true,max:320},phone:{label:'Telefon',required:true,max:80},
 street:{label:'Straße',max:160},house_number:{label:'Hausnummer',max:40},postcode:{label:'PLZ',max:10},city:{label:'Ort',required:true,max:120},
 household_size:{label:'Haushaltsgröße',required:true,type:'integer'},employment_status:{label:'Beschäftigung',max:160},monthly_net_income:{label:'Nettoeinkommen / Monat',type:'money'},
 pets:{label:'Haustiere',max:160},wbs_status:{label:'WBS-Status',max:160},move_in_date:{label:'Einzugsdatum',type:'date'},default_message:{label:'Standard-Bewerbungstext',max:4000}
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
async function previewKeyboard(user:any,listingId:string,enabled:boolean){
 const internal=await secret('internal_worker_secret');
 const r=await fetch(DISPATCHER,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},body:JSON.stringify({dry_run:true,listing_id:listingId,premium:user.is_premium===true,user_id:user.id,auto_apply_enabled:enabled}),signal:AbortSignal.timeout(20000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok||!data?.keyboard)throw Error('preview_keyboard_unavailable');
 return data.keyboard;
}
async function refreshPreviewAutoApply(user:any,chatId:number,listingId:string,enabled:boolean){
 if(!/^[0-9a-f-]{36}$/i.test(listingId))return;
 try{
  const events=await rows('delivery_events',{recipient_user_id:`eq.${user.id}`,listing_id:`eq.${listingId}`,status:'eq.sent',select:'telegram_message_id',order:'sent_at.desc',limit:'1'});
  const messageId=Number(events?.[0]?.telegram_message_id||0);
  if(!messageId)return;
  const reply_markup=await previewKeyboard(user,listingId,enabled);
  await telegram('editMessageReplyMarkup',{chat_id:chatId,message_id:messageId,reply_markup});
 }catch(error){console.error('preview_auto_apply_refresh',String(error));}
}
const ready=(p:any)=>!!p&&REQUIRED.every(k=>String(p[k]??'').trim());
const shown=(v:any,fallback='–')=>v==null||String(v).trim()===''?fallback:esc(v);
async function profile(userId:string){return (await rows('applicant_profiles',{user_id:`eq.${userId}`,select:'*',limit:'1'}))[0]||null;}
function connectionLabel(c:any){const s=c?.status;return s==='connected'?'🟢 verbunden':s==='pending'?'🟡 Anmeldung offen':s==='needs_login'?'🟠 erneut anmelden':s?'🔴 Fehler':'⚪ nicht verbunden';}

export function isAutoApplyCallback(data:string){
 if(data==='platforms:profile'||data==='platforms:profile-new'||data.startsWith('platforms:profile-field:')||data==='platforms:docs'||data.startsWith('platforms:doc-'))return false;
 return data==='platforms'||data.startsWith('platforms:');
}
export function isAutoApplyMessage(update:any){const m=update?.message;if(!m?.text)return false;const text=String(m.text),reply=String(m.reply_to_message?.text||'');return /https:\/\/login\.kleinanzeigen\.de\/android\/com\.ebay\.kleinanzeigen\/callback/i.test(text)||/https:\/\/tenant\.immomio\.com\/de\/auth\/login/i.test(text)||reply.startsWith(SETUP_PROMPT)||reply.startsWith(FIELD_PROMPT_PREFIX);}

async function profilePage(user:any,chatId:number,messageId:number,notice=''){
 const p=await profile(user.id);
 if(!p)return edit(chatId,messageId,`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Noch kein Bewerberprofil angelegt. Die Eingabe erfolgt direkt in Telegram.`,[[button('➕ Bewerberprofil anlegen','platforms:profile-new')],[button('← Automatische Bewerbung','platforms')]]);
 const address=[p.street,p.house_number].filter(Boolean).join(' ');
 const text=`👤 <b>Bewerberprofil</b>\n\n${notice?`${notice}\n\n`:''}Status: ${ready(p)?'✅ vollständig':'⚠️ unvollständig'}\n\nAnrede: ${shown(p.salutation)}\nVorname: ${shown(p.first_name)}\nNachname: ${shown(p.last_name)}\nE-Mail: ${shown(p.email)}\nTelefon: ${shown(p.phone)}\nAdresse: ${shown(address)}\nPLZ / Ort: ${shown([p.postcode,p.city].filter(Boolean).join(' '))}\nHaushalt: ${shown(p.household_size)}\nBeschäftigung: ${shown(p.employment_status)}\nNettoeinkommen: ${p.monthly_net_income==null?'–':`${shown(p.monthly_net_income)} €`}\nHaustiere: ${shown(p.pets)}\nWBS: ${shown(p.wbs_status)}\nEinzug: ${shown(p.move_in_date)}\nBewerbungstext: ${p.default_message?'✅ hinterlegt':'–'}`;
 const f=(n:string,l:string)=>button(l,`platforms:profile-field:${n}`);
 return edit(chatId,messageId,text,[[f('first_name','Vorname'),f('last_name','Nachname')],[f('email','E-Mail'),f('phone','Telefon')],[f('salutation','Anrede'),f('household_size','Haushalt')],[f('street','Straße'),f('house_number','Hausnr.')],[f('postcode','PLZ'),f('city','Ort')],[f('employment_status','Beschäftigung'),f('monthly_net_income','Einkommen')],[f('pets','Haustiere'),f('wbs_status','WBS')],[f('move_in_date','Einzugsdatum')],[f('default_message','✍️ Bewerbungstext')],[button('← Automatische Bewerbung','platforms')]]);
}

async function platformPage(user:any,chatId:number,messageId:number,notice='',previewListingId='',openAsNew=false){
 if(!user.is_premium){
  const checkout=`${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}`;
  const text='🔒 <b>Auto-Bewerbung ist ein Premium-Feature.</b>\n\nMit Premium kannst du Bewerberprofil und Plattform-Verbindungen für automatische Bewerbungen nutzen.';
  const buttons=[[{text:'💎 Jetzt abonnieren',url:checkout}],[button('← Start','home')]];
  return openAsNew?send(chatId,text,buttons):edit(chatId,messageId,text,buttons);
 }
 const [connections,p]=await Promise.all([rows('platform_connections',{user_id:`eq.${user.id}`,select:'provider,status,account_hint,last_verified_at,last_error'}),profile(user.id)]);
 const conn=(provider:string)=>connections.find((c:any)=>c.provider===provider),klein=conn('kleinanzeigen'),scout=conn('immoscout'),immomio=conn('immomio');
 const buttons:any[]=[
  [button('👤 Bewerberprofil','platforms:profile')],
  [button(user.auto_apply_enabled?'⏸ Auto-Bewerbung pausieren':'⚡ Auto-Bewerbung aktivieren',user.auto_apply_enabled?`platforms:off${previewListingId?':'+previewListingId:''}`:`platforms:on${previewListingId?':'+previewListingId:''}`)]
 ];
 if(user.is_premium){
  buttons.push(
   [button(klein?.status==='connected'?'🟢 Kleinanzeigen':'🔐 Kleinanzeigen verbinden','platforms:login:2'),button('Prüfen','platforms:check:2')],
   [button(scout?.status==='connected'?'🟢 ImmoScout24':'🔐 ImmoScout24 verbinden','platforms:login:1'),button('Prüfen','platforms:check:1')],
   [button(immomio?.status==='connected'?'🟢 Immomio':'🔐 Immomio verbinden','platforms:login:3'),button('Prüfen','platforms:check:3')]
  );
 }
 if(klein)buttons.push([button('Kleinanzeigen trennen','platforms:disconnect:2')]);
 if(scout)buttons.push([button('ImmoScout trennen','platforms:disconnect:1')]);
 if(immomio)buttons.push([button('Immomio trennen','platforms:disconnect:3')]);
 buttons.push([button('← Start','home')]);
 const text=`⚡ <b>Automatische Bewerbung</b>\n\n${notice?`${notice}\n\n`:''}👤 Bewerberprofil: ${ready(p)?'✅ vollständig':p?'⚠️ unvollständig':'⚠️ fehlt'}\n\n<b>Plattformen</b>\nKleinanzeigen: ${connectionLabel(klein)}\nImmoScout24: ${connectionLabel(scout)}\nImmomio: ${connectionLabel(immomio)} · 🧪 Sendetest ausstehend\n\nAuto-Bewerbung: ${prefs.enabled?'✅ aktiv':'aus'}\nFreigaben: ${prefs.immoscout_enabled?'ImmoScout24 ✓':'ImmoScout24 –'} · ${prefs.kleinanzeigen_enabled?'Kleinanzeigen ✓':'Kleinanzeigen –'} · ${prefs.immomio_enabled?'Immomio ✓':'Immomio –'}\n\nNach der einmaligen Einrichtung läuft die Bewerbung nur auf ausdrücklich freigegebenen Plattformen automatisch.`;
 return openAsNew?send(chatId,text,buttons):edit(chatId,messageId,text,buttons);
}

function fieldPrompt(name:string){const m=PROFILE_FIELDS[name];if(!m)return null;const extra=m.type==='date'?'\nFormat: <code>JJJJ-MM-TT</code>':m.type==='integer'?'\nZahl von 1 bis 20':m.type==='money'?'\nNur den Betrag eingeben, z. B. <code>2500</code>':m.hint?`\n${m.hint}`:'';const optional=m.required?'':'\nOptional: Sende <code>-</code>, um den Wert zu löschen.';return `${FIELD_PROMPT_PREFIX}${m.label}\n\nBitte antworte auf diese Nachricht mit dem neuen Wert.${extra}${optional}`;}
function validateField(name:string,input:any){const m=PROFILE_FIELDS[name];if(!m)throw Error('Unbekanntes Profilfeld.');const raw=String(input??'').trim();if(raw==='-'&&!m.required)return null;if(!raw&&m.required)throw Error(`${m.label} darf nicht leer sein.`);if(!raw)return null;if(name==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))throw Error('Bitte eine gültige E-Mail-Adresse ein.');if(name==='phone'&&(raw.length<3||raw.length>80))throw Error('Bitte eine gültige Telefonnummer eingeben.');if(name==='postcode'&&!/^\d{5}$/.test(raw))throw Error('Bitte eine fünfstellige PLZ eingeben.');if(m.type==='integer'){const n=Number(raw);if(!Number.isInteger(n)||n<1||n>20)throw Error('Haushaltsgröße muss zwischen 1 und 20 liegen.');return n;}if(m.type==='money'){const n=Number(raw.replace(/\./g,'').replace(',','.'));if(!Number.isFinite(n)||n<0||n>1000000)throw Error('Bitte ein gültiges monatliches Nettoeinkommen eingeben.');return n;}if(m.type==='date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||Number.isNaN(Date.parse(`${raw}T00:00:00Z`)))throw Error('Bitte das Datum als JJJJ-MM-TT eingeben.');return raw;}if(raw.length>(m.max||4000))throw Error(`${m.label} ist zu lang.`);return raw;}
function kleinCallbackUrl(text:string){const match=String(text||'').match(/https:\/\/login\.kleinanzeigen\.de\/android\/com\.ebay\.kleinanzeigen\/callback[^\s<>]*/i);if(!match)return null;try{const u=new globalThis.URL(match[0].replace(/&amp;/g,'&').replace(/[\])},.;!?]+$/g,''));return u.hostname==='login.kleinanzeigen.de'&&u.pathname==='/android/com.ebay.kleinanzeigen/callback'&&u.searchParams.get('state')&&(u.searchParams.get('code')||u.searchParams.get('error'))?u.href:null;}catch{return null;}}
function immomioCallbackUrl(text:string){const match=String(text||'').match(/https:\/\/tenant\.immomio\.com\/de\/auth\/login[^\s<>]*/i);if(!match)return null;try{const u=new globalThis.URL(match[0].replace(/&amp;/g,'&').replace(/[\])},.;!?]+$/g,''));return u.hostname==='tenant.immomio.com'&&u.pathname==='/de/auth/login'&&u.searchParams.get('state')&&u.searchParams.get('code')?u.href:null;}catch{return null;}}

async function handlePlatforms(user:any,chatId:number,messageId:number,data:string){
 const parts=data.split(':'),action=parts[1]||'',arg=parts[2]||'',source=Number(arg),previewListingId=['preview','on','off'].includes(action)&&/^[0-9a-f-]{36}$/i.test(arg)?arg:'';
 if(action==='preview')return platformPage(user,chatId,messageId,'',previewListingId,true);
 if(!user.is_premium && action!=='disconnect')return platformPage(user,chatId,messageId);
 if(!action)return platformPage(user,chatId,messageId);
 if(action==='profile')return user.is_premium?profilePage(user,chatId,messageId):platformPage(user,chatId,messageId,'💎 Bewerberprofile benötigen Premium.');
 if(action==='profile-new'){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Bewerberprofile benötigen Premium.');
  if(await profile(user.id))return profilePage(user,chatId,messageId);
  await forceReply(chatId,`${SETUP_PROMPT}\n\nAntworte in <b>einer Nachricht</b> mit diesen 6 Angaben, getrennt durch <code>|</code>:\n\n<code>Vorname | Nachname | E-Mail | Telefon | Ort | Haushaltsgröße</code>\n\nBeispiel:\n<code>Max | Mustermann | max@example.de | +49 170 1234567 | Hamburg | 1</code>`,'Vorname | Nachname | E-Mail | Telefon | Ort | 1');return;
 }
 if(action==='profile-field'){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Bewerberprofile benötigen Premium.');const prompt=fieldPrompt(arg);if(!prompt)return profilePage(user,chatId,messageId);await forceReply(chatId,prompt,PROFILE_FIELDS[arg].label);return;
 }
 if(action==='provider'&&[1,2,3].includes(source)){
   if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Plattformfreigaben benötigen Premium.');
   const key=source===1?'immoscout':source===2?'kleinanzeigen':'immomio',column=key+'_enabled';
   const conns=await rows('platform_connections',{user_id:`eq.${user.id}`,provider:`eq.${key}`,select:'status',limit:'1'});
   if(conns?.[0]?.status!=='connected')return platformPage(user,chatId,messageId,'⚠️ Plattform zuerst verbinden.');
   const pref=await rows('application_preferences',{user_id:`eq.${user.id}`,select:column,limit:'1'}),next=!(pref?.[0]?.[column]===true);
   await patch('application_preferences',{user_id:`eq.${user.id}`},{[column]:next,updated_at:new Date().toISOString()});
   return platformPage(user,chatId,messageId,next?'✅ Plattform für AutoApply freigegeben.':'Plattform für AutoApply pausiert.');
  }
  if(action==='on'){if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Auto-Bewerbung benötigt Premium.');try{await patch('bot_users',{id:`eq.${user.id}`},{auto_apply_enabled:true,updated_at:new Date().toISOString()});user.auto_apply_enabled=true;if(previewListingId)await refreshPreviewAutoApply(user,chatId,previewListingId,true);return platformPage(user,chatId,messageId,'✅ Auto-Bewerbung aktiviert.',previewListingId);}catch{return platformPage(user,chatId,messageId,'⚠️ Auto-Bewerbung ist noch nicht freigegeben. Zuerst muss mindestens ein Plattform-Sendetest verifiziert sein.');}}
 if(action==='off'){await patch('bot_users',{id:`eq.${user.id}`},{auto_apply_enabled:false,updated_at:new Date().toISOString()});user.auto_apply_enabled=false;if(previewListingId)await refreshPreviewAutoApply(user,chatId,previewListingId,false);return platformPage(user,chatId,messageId,'Auto-Bewerbung deaktiviert.',previewListingId);}
 if(action==='login'&&source===1)return edit(chatId,messageId,'🔐 <b>ImmoScout24</b>\n\nDie Verbindung wird ohne offizielle ImmoScout-API über eine gespeicherte Web-Session umgesetzt. Der kontrollierte Login-/Sendetest ist noch ausstehend; deshalb wird aktuell noch keine produktive Session angelegt.',[[button('← Automatische Bewerbung','platforms')]]);
 if(action==='login'&&source===2){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Plattform-Verbindungen benötigen Premium.');
  try{const result=await worker('login',user.id,2);return edit(chatId,messageId,'🔐 <b>Kleinanzeigen verbinden</b>\n\nMelde dich einmalig bei Kleinanzeigen an. Falls die Abschlussseite nicht automatisch zurückspringt: <b>Teilen → Telegram → Traumwohnung – Hamburg → Senden</b>. Der Bot übernimmt den Rücksprung und löscht die sensible URL direkt wieder.',[[{text:'🌐 Kleinanzeigen-Login öffnen',url:result.url}],[button('← Automatische Bewerbung','platforms')]]);}catch{return platformPage(user,chatId,messageId,'⚠️ Kleinanzeigen-Login konnte nicht gestartet werden.');}
 }
 if(action==='login'&&source===3){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Plattform-Verbindungen benötigen Premium.');
  try{const result=await worker('login',user.id,3);return edit(chatId,messageId,'🔐 <b>Immomio verbinden</b>\n\n<b>1.</b> Öffne Immomio und melde dich mit deinem normalen Immomio-Konto an.\n<b>2.</b> Nach erfolgreichem Login bleibst du auf einer normalen Immomio-Seite – es wird keine Datei mehr heruntergeladen.\n<b>3.</b> Tippe dort auf <b>Teilen → Telegram → Traumwohnung – Hamburg → Senden</b>.\n\nDer Bot übernimmt den Rücksprung automatisch, speichert nur die verschlüsselte Sitzung und löscht die geteilte Login-URL wieder. Dein Passwort bleibt ausschließlich bei Immomio.',[[{text:'🌐 Immomio-Login öffnen',url:result.url}],[button('← Automatische Bewerbung','platforms')]]);}catch(error:any){const note=error?.message==='immomio_email_required'?'Im Bewerberprofil fehlt eine gültige E-Mail-Adresse.':'Immomio-Login konnte nicht gestartet werden.';return platformPage(user,chatId,messageId,`⚠️ ${note}`);}
 }
 if(action==='check'&&[1,2,3].includes(source)){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Plattform-Verbindungen benötigen Premium.');
  try{const result=await worker('check',user.id,source);const name=source===1?'ImmoScout24':source===2?'Kleinanzeigen':'Immomio';return platformPage(user,chatId,messageId,result.authenticated===true?`✅ ${name}-Verbindung bestätigt.`:result.authenticated===null?`${name}: Verbindung gespeichert; der Sendepfad ist noch nicht freigegeben.`:`⚠️ ${name} bitte erneut verbinden.`);}catch{return platformPage(user,chatId,messageId,'⚠️ Verbindung konnte nicht bestätigt werden.');}
 }
 if(action==='disconnect'&&[1,2,3].includes(source)){
  try{await worker('disconnect',user.id,source);const key=source===1?'immoscout':source===2?'kleinanzeigen':'immomio';await patch('application_preferences',{user_id:`eq.${user.id}`},{[key+'_enabled']:false,updated_at:new Date().toISOString()}).catch(()=>{});return platformPage(user,chatId,messageId,'Plattformverbindung gelöscht.');}catch{return platformPage(user,chatId,messageId,'⚠️ Verbindung konnte nicht gelöscht werden.');}
 }
 return platformPage(user,chatId,messageId);
}

async function preparedUser(update:any){const prepared=await rpc('prepare_telegram_update',{p_payload:update}),claim=Number(prepared?.claim??0);if(claim<=0)return null;const user={...(prepared.user||{}),is_premium:premium(prepared.user,prepared.subscription)};return {prepared,claim,user,updateId:Number(update.update_id)};}
async function finish(updateId:number,claim:number,ok:boolean,error:string|null=null){await rpc('finish_telegram_update',{p_update_id:updateId,p_attempt:claim,p_success:ok,p_error:error});}

export async function handleAutoApplyCallback(update:any){const query=update?.callback_query,chat=query?.message?.chat,chatId=Number(chat?.id),messageId=Number(query?.message?.message_id),fromId=Number(query?.from?.id),data=String(query?.data||'');if(!fromId||!chatId||!messageId||chat?.type!=='private'||fromId!==chatId||!isAutoApplyCallback(data))return;let ctx:any=null;try{ctx=await preparedUser(update);if(!ctx)return;const {user,claim,updateId}=ctx,owns=user.is_active&&Number(user.telegram_user_id)===fromId&&Number(user.chat_id)===chatId;if(!owns){await finish(updateId,claim,true);ctx=null;return;}let resolvedData=data;if(data==='platforms'){const rows=query?.message?.reply_markup?.inline_keyboard||[];let listingId='';for(const row of rows)for(const button of row||[]){const m=String(button?.callback_data||'').match(/^save:([0-9a-f-]{36})$/i);if(m){listingId=m[1];break;}}if(listingId){await refreshPreviewAutoApply(user,chatId,listingId,user.auto_apply_enabled===true);resolvedData=`platforms:preview:${listingId}`;}}if(resolvedData==='platforms'||resolvedData.startsWith('platforms:'))await handlePlatforms(user,chatId,messageId,resolvedData);await finish(updateId,claim,true);ctx=null;}catch(error){console.error('auto_apply_callback',String(error));if(ctx)await finish(ctx.updateId,ctx.claim,false,String(error)).catch(()=>{});}}

export async function handleAutoApplyMessage(update:any){const message=update?.message,chat=message?.chat,chatId=Number(chat?.id),fromId=Number(message?.from?.id);if(!fromId||!chatId||chat?.type!=='private'||fromId!==chatId||!isAutoApplyMessage(update))return;let ctx:any=null;try{ctx=await preparedUser(update);if(!ctx)return;const {user,claim,updateId}=ctx,owns=user.is_active&&Number(user.telegram_user_id)===fromId&&Number(user.chat_id)===chatId;if(!owns){await finish(updateId,claim,true);ctx=null;return;}const text=String(message.text||'').trim(),kleinUrl=kleinCallbackUrl(text),immomioUrl=immomioCallbackUrl(text);
 if(kleinUrl||immomioUrl){
  const source=immomioUrl?3:2,name=source===3?'Immomio':'Kleinanzeigen',url=immomioUrl||kleinUrl;
  await telegram('deleteMessage',{chat_id:chatId,message_id:message.message_id}).catch(()=>{});
  try{
   if(!user.is_premium)await send(chatId,`💎 ${name}-Verbindungen benötigen Premium.`);
   else{
    const result=await worker('complete_login',user.id,source,{callbackUrl:url});
    await send(chatId,result.authenticated===true?`✅ <b>${name} verbunden</b>\n\nDie Anmeldung ist verschlüsselt gespeichert. Du musst dich für künftige Bewerbungen nicht erneut anmelden, solange ${name} die Sitzung nicht widerruft.`:`⚠️ ${name} konnte nicht verbunden werden.`,[[button('⚡ Automatische Bewerbung','platforms')]]);
   }
  }catch(error:any){
   const friendly=error?.message==='auth_flow_expired'?`Die ${name}-Anmeldung ist abgelaufen. Bitte erneut verbinden.`:error?.message==='invalid_callback_url'?`Der ${name}-Rücksprung ist unvollständig. Bitte den Login erneut starten.`:error?.message==='token_exchange_failed'?`${name} konnte die Anmeldung nicht abschließen. Bitte erneut versuchen.`:`${name} konnte nicht verbunden werden.`;
   await send(chatId,`⚠️ ${esc(friendly)}`,[[button(`🔐 ${name} erneut verbinden`,`platforms:login:${source}`)],[button('← Automatische Bewerbung','platforms')]]);
  }
  await finish(updateId,claim,true);ctx=null;return;
 }
 const replied=String(message.reply_to_message?.text||'');
 if(replied.startsWith(SETUP_PROMPT)){const parts=text.split('|').map((v:string)=>v.trim());if(parts.length!==6)await send(chatId,'Bitte genau 6 Werte mit <code>|</code> trennen:\nVorname | Nachname | E-Mail | Telefon | Ort | Haushaltsgröße');else try{const values={user_id:user.id,first_name:validateField('first_name',parts[0]),last_name:validateField('last_name',parts[1]),email:validateField('email',parts[2]),phone:validateField('phone',parts[3]),city:validateField('city',parts[4]),household_size:validateField('household_size',parts[5]),updated_at:new Date().toISOString()};await upsert('applicant_profiles','user_id',values);await Promise.all([telegram('deleteMessage',{chat_id:chatId,message_id:message.message_id}).catch(()=>{}),message.reply_to_message?.message_id?telegram('deleteMessage',{chat_id:chatId,message_id:message.reply_to_message.message_id}).catch(()=>{}):null]);await send(chatId,'✅ Bewerberprofil angelegt.',[[button('👤 Profil öffnen','platforms:profile')],[button('← Automatische Bewerbung','platforms')]]);}catch(error:any){await send(chatId,`⚠️ ${esc(error.message)}`);}await finish(updateId,claim,true);ctx=null;return;}
 if(replied.startsWith(FIELD_PROMPT_PREFIX)){const label=replied.slice(FIELD_PROMPT_PREFIX.length).split('\n')[0].trim(),entry=Object.entries(PROFILE_FIELDS).find(([,m]:any)=>m.label===label);if(entry){const [name]=entry;try{if(!await profile(user.id))await send(chatId,'Bitte zuerst die Grundeinrichtung des Bewerberprofils abschließen.',[[button('➕ Bewerberprofil anlegen','platforms:profile-new')]]);else{const value=validateField(name,text);await patch('applicant_profiles',{user_id:`eq.${user.id}`},{[name]:value,updated_at:new Date().toISOString()});await Promise.all([telegram('deleteMessage',{chat_id:chatId,message_id:message.message_id}).catch(()=>{}),message.reply_to_message?.message_id?telegram('deleteMessage',{chat_id:chatId,message_id:message.reply_to_message.message_id}).catch(()=>{}):null]);await send(chatId,`✅ ${esc(PROFILE_FIELDS[name].label)} gespeichert.`,[[button('👤 Bewerberprofil','platforms:profile')],[button('← Automatische Bewerbung','platforms')]]);}}catch(error:any){await send(chatId,`⚠️ ${esc(error.message)}`);}}await finish(updateId,claim,true);ctx=null;return;}
 await finish(updateId,claim,true);ctx=null;
 }catch(error){console.error('auto_apply_message',String(error));if(ctx)await finish(ctx.updateId,ctx.claim,false,String(error)).catch(()=>{});}}
