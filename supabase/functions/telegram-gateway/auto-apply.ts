const URL=Deno.env.get('SUPABASE_URL')!;
const KEYS=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const KEY=KEYS.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WORKER=`${URL}/functions/v1/application-worker`;

function headers(extra:Record<string,string>={}){return {apikey:KEY,Authorization:`Bearer ${KEY}`,'content-type':'application/json',...extra};}
async function rpc(name:string,body:Record<string,unknown>){const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body)}),data=await r.json().catch(()=>null);if(!r.ok)throw Error(`${name}:${r.status}`);return data;}
async function rows(table:string,params:Record<string,string>){const url=new globalThis.URL(`${URL}/rest/v1/${table}`);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);const r=await fetch(url,{headers:headers()}),data=await r.json().catch(()=>[]);if(!r.ok)throw Error(`${table}:${r.status}`);return Array.isArray(data)?data:[];}
async function patch(table:string,params:Record<string,string>,values:Record<string,unknown>){const url=new globalThis.URL(`${URL}/rest/v1/${table}`);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);const r=await fetch(url,{method:'PATCH',headers:headers({Prefer:'return=minimal'}),body:JSON.stringify(values)});if(!r.ok)throw Error(`${table}:${r.status}`);}
async function secret(name:string){const data=await rpc('get_bot_secret',{secret_name:name});if(!data)throw Error('secret_unavailable');return String(data);}
async function telegram(method:string,body:Record<string,unknown>){const token=await secret('telegram_bot_token_runtime');const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await r.json().catch(()=>null);if(!r.ok||!data?.ok)throw Error('telegram_failed');return data.result;}
async function worker(action:string,userId:string,source=0,extra:Record<string,unknown>={}){const internal=await secret('internal_worker_secret');const r=await fetch(WORKER,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},body:JSON.stringify({action,userId,source,...extra}),signal:AbortSignal.timeout(45000)});const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.error||`worker:${r.status}`);return data;}
function premium(user:any,subscription:any){const now=Date.now();if(user?.plan_override==='free')return false;if(user?.plan_override==='premium'&&(!user.plan_override_expires_at||Date.parse(user.plan_override_expires_at)>now))return true;if(user?.referral_bonus_until&&Date.parse(user.referral_bonus_until)>now)return true;return !!subscription&&['active','trialing'].includes(String(subscription.status||''))&&(!subscription.current_period_end||Date.parse(subscription.current_period_end)>now);}
function button(text:string,callback_data:string){return {text,callback_data};}
async function edit(chatId:number,messageId:number,text:string,inline_keyboard:any[]){try{return await telegram('editMessageText',{chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:{inline_keyboard}});}catch{return telegram('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:{inline_keyboard}});}}
async function send(chatId:number,text:string,inline_keyboard?:any[]){return telegram('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,...(inline_keyboard?{reply_markup:{inline_keyboard}}:{})});}

export function isAutoApplyCallback(data:string){return data==='platforms'||data.startsWith('platforms:')||data.startsWith('apply:');}

async function platformPage(user:any,chatId:number,messageId:number,notice=''){
 const [connections,profiles,applicationRows,link]=await Promise.all([
  rows('platform_connections',{user_id:`eq.${user.id}`,select:'provider,status,account_hint,last_verified_at,last_error'}),
  rows('applicant_profiles',{user_id:`eq.${user.id}`,select:'user_id,first_name,last_name,email,phone,city,household_size'}),
  rows('applications',{user_id:`eq.${user.id}`,select:'listing_id,status',order:'created_at.desc',limit:'5'}),
  worker('profile_link',user.id).catch(()=>null)
 ]);
 const p=profiles[0],ready=!!(p?.first_name&&p?.last_name&&p?.email&&p?.phone&&p?.city&&p?.household_size),connection=(provider:string)=>connections.find((c:any)=>c.provider===provider),label=(provider:string)=>{const s=connection(provider)?.status;return s==='connected'?'🟢 verbunden':s==='pending'?'🟡 Anmeldung offen':s==='needs_login'?'🟠 erneut anmelden':'⚪ nicht verbunden';};
 const buttons:any[]=[];
 if(link?.url)buttons.push([{text:ready?'👤 Bewerberprofil & Plattformen':'👤 Bewerberprofil einrichten',url:link.url}]);
 if(connection('kleinanzeigen'))buttons.push([button('Kleinanzeigen prüfen','platforms:check:2')],[button('Kleinanzeigen trennen','platforms:disconnect:2')]);
 if(connection('immoscout'))buttons.push([button('ImmoScout24 prüfen','platforms:check:1')],[button('ImmoScout24 trennen','platforms:disconnect:1')]);
 buttons.push([button(user.auto_apply_enabled?'Auto-Bewerbung deaktivieren':'⚡ Auto-Bewerbung aktivieren',user.auto_apply_enabled?'platforms:off':'platforms:on')]);
 for(const [i,a] of applicationRows.entries())buttons.push([button(`${{sent:'✅ Gesendet',failed:'❌ Fehlgeschlagen',manual_required:'⚠️ Prüfung nötig',pending:'⏳ Vorgemerkt',processing:'⏳ Wird verarbeitet'}[a.status]||a.status} · ${i+1}`,`apply:${a.listing_id}`)]);
 buttons.push([button('← Einstellungen','settings')]);
 const text=`⚡ <b>Automatische Bewerbung</b>\n\n${notice?`${notice}\n\n`:''}Bewerberprofil: ${ready?'✅ vollständig':'⚠️ unvollständig'}\n\nImmoScout24: ${label('immoscout')}\nKleinanzeigen: ${label('kleinanzeigen')}\nImmomio: 🟢 kein Login erforderlich\n\nAuto-Bewerbung: ${user.auto_apply_enabled?'✅ aktiv':'aus'}\n\nNach der einmaligen Einrichtung werden ausschließlich freigegebene Plattformen automatisch ausgefüllt und abgesendet.`;
 return edit(chatId,messageId,text,buttons);
}

async function handlePlatforms(user:any,chatId:number,messageId:number,data:string){
 const [,action,rawSource]=data.split(':'),source=Number(rawSource);
 if(!action)return platformPage(user,chatId,messageId);
 if(action==='on'){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Auto-Bewerbung benötigt Premium.');
  try{await patch('bot_users',{id:`eq.${user.id}`},{auto_apply_enabled:true,updated_at:new Date().toISOString()});user.auto_apply_enabled=true;return platformPage(user,chatId,messageId,'✅ Auto-Bewerbung aktiviert.');}
  catch{return platformPage(user,chatId,messageId,'⚠️ Auto-Bewerbung ist noch nicht freigegeben. Zuerst muss mindestens ein Plattform-Sendetest verifiziert sein.');}
 }
 if(action==='off'){await patch('bot_users',{id:`eq.${user.id}`},{auto_apply_enabled:false,updated_at:new Date().toISOString()});user.auto_apply_enabled=false;return platformPage(user,chatId,messageId,'Auto-Bewerbung deaktiviert.');}
 if(action==='login')return platformPage(user,chatId,messageId,'Bitte „Bewerberprofil & Plattformen“ öffnen. Der einmalige Login läuft dort im normalen Plattformfenster.');
 if(action==='check'&&[1,2].includes(source)){
  if(!user.is_premium)return platformPage(user,chatId,messageId,'💎 Plattform-Verbindungen benötigen Premium.');
  try{const result=await worker('check',user.id,source);return platformPage(user,chatId,messageId,result.authenticated===true?'✅ Verbindung bestätigt.':result.authenticated===null?'Verbindung gespeichert; der Sendepfad ist noch nicht freigegeben.':'⚠️ Bitte Plattform erneut verbinden.');}catch{return platformPage(user,chatId,messageId,'⚠️ Verbindung konnte nicht bestätigt werden.');}
 }
 if(action==='disconnect'&&[1,2].includes(source)){try{await worker('disconnect',user.id,source);return platformPage(user,chatId,messageId,'Plattformverbindung gelöscht.');}catch{return platformPage(user,chatId,messageId,'⚠️ Verbindung konnte nicht gelöscht werden.');}}
 return platformPage(user,chatId,messageId);
}

async function handleApply(user:any,chatId:number,listingId:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listingId))return send(chatId,'Dieses Angebot ist nicht verfügbar.');
 const existing=await rows('applications',{user_id:`eq.${user.id}`,listing_id:`eq.${listingId}`,select:'status,submission_started_at,last_error',limit:'1'}),a=existing[0];
 if(a?.status==='sent')return send(chatId,'✅ Diese Bewerbung wurde bereits automatisch versendet.');
 if(a?.submission_started_at||a?.status==='processing')return send(chatId,'⏳ Diese Bewerbung wird bereits verarbeitet. Ein zweiter Versand ist gesperrt.');
 if(a?.status==='manual_required')return send(chatId,'⚠️ Der Versandstatus ist nicht eindeutig oder die Plattform verlangt eine erneute Verbindung. Die Bewerbung wird nicht automatisch wiederholt.');
 const applicationId=await rpc('enqueue_application_now',{p_user:user.id,p_listing:listingId});
 if(!applicationId)return send(chatId,'⚡ Automatische Bewerbung ist für dieses Angebot noch nicht freigegeben.\n\nPrüfe unter Einstellungen → Plattformkonten dein Bewerberprofil und die Plattform-Verbindung.');
 await send(chatId,'⏳ Bewerbung vorgemerkt. Der Bot füllt sie jetzt automatisch aus und sendet sie über die freigegebene Plattform.');
 await worker('process',user.id).catch(()=>null);
}

export async function handleAutoApplyCallback(update:any){
 const query=update?.callback_query,chatId=Number(query?.message?.chat?.id),messageId=Number(query?.message?.message_id),data=String(query?.data||'');
 if(!query?.from?.id||!chatId||!messageId||!isAutoApplyCallback(data))return;
 let updateId:number|null=null,attempt:number|null=null;
 try{
  const prepared=await rpc('prepare_telegram_update',{p_payload:update}),claim=Number(prepared?.claim??0);
  if(claim<=0)return;
  updateId=Number(update.update_id);attempt=claim;
  const user={...(prepared.user||{}),is_premium:premium(prepared.user,prepared.subscription)};
  if(!user.is_active)return;
  if(data==='platforms'||data.startsWith('platforms:'))await handlePlatforms(user,chatId,messageId,data);
  else if(data.startsWith('apply:'))await handleApply(user,chatId,data.slice(6));
  await rpc('finish_telegram_update',{p_update_id:updateId,p_attempt:attempt,p_success:true,p_error:null});updateId=null;attempt=null;
 }catch(error){console.error('auto_apply_callback',String(error));if(updateId!==null&&attempt!==null)await rpc('finish_telegram_update',{p_update_id:updateId,p_attempt:attempt,p_success:false,p_error:String(error)}).catch(()=>{});}
}
