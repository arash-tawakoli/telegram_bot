import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL=Deno.env.get('SUPABASE_URL')!;
const KEYS=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const KEY=KEYS.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORE=`${URL}/functions/v1/telegram-gateway`;
const APPLICATION_WORKER=`${URL}/functions/v1/application-worker`;
const IMMOMIO_WORKER=`${URL}/functions/v1/immomio-account`;
const SCOUT_HANDOFF=`${URL}/functions/v1/immoscout-native-handoff`;
let cached:{value:string,expiresAt:number}|null=null;

function headers(extra:Record<string,string>={}){return{apikey:KEY,Authorization:`Bearer ${KEY}`,'content-type':'application/json',...extra}}
async function rpc(name:string,body:Record<string,unknown>){const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}),data=await r.json().catch(()=>null);if(!r.ok)throw Error(`${name}:${r.status}`);return data}
async function secret(name:string){const data=await rpc('get_bot_secret',{secret_name:name});if(!data)throw Error('secret_unavailable');return String(data)}
async function webhookSecret(force=false){if(!force&&cached&&cached.expiresAt>Date.now())return cached.value;const value=await secret('telegram_webhook_secret');cached={value,expiresAt:Date.now()+3600000};return value}
async function telegram(method:string,body:Record<string,unknown>){const token=await secret('telegram_bot_token_runtime');const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)}),data=await r.json().catch(()=>null);if(!r.ok||!data?.ok)throw Error('telegram_failed');return data.result}
async function editOrSend(chatId:number,messageId:number,text:string,inline_keyboard:any[]){const body={chat_id:chatId,message_id:messageId,parse_mode:'HTML',disable_web_page_preview:true,text,reply_markup:{inline_keyboard}};try{return await telegram('editMessageText',body)}catch{return telegram('sendMessage',{chat_id:chatId,parse_mode:'HTML',disable_web_page_preview:true,text,reply_markup:{inline_keyboard}})}}
async function finish(updateId:number,claim:number,ok:boolean,error:string|null=null){await rpc('finish_telegram_update',{p_update_id:updateId,p_attempt:claim,p_success:ok,p_error:error})}
async function prepared(update:any){const p=await rpc('prepare_telegram_update',{p_payload:update}),claim=Number(p?.claim||0);if(claim<=0)return null;return{claim,user:p.user,updateId:Number(update.update_id)}}
async function internal(endpoint:string,payload:Record<string,unknown>){const internalSecret=await secret('internal_worker_secret');const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internalSecret},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)}),data=await r.json().catch(()=>null);if(!r.ok||!data)throw Error(data?.error||`provider:${r.status}`);return data}
function providerName(provider:string){return provider==='kleinanzeigen'?'Kleinanzeigen':provider==='immomio'?'Immomio':'ImmoScout24'}
function providerUrl(provider:string,value:any){let u:any;try{u=new globalThis.URL(String(value||''))}catch{throw Error('provider_url_invalid')}if(u.protocol!=='https:'||u.username||u.password)throw Error('provider_url_invalid');const allowed=provider==='kleinanzeigen'?u.hostname==='login.kleinanzeigen.de':provider==='immomio'?u.hostname==='sso.immomio.com':u.hostname==='login.immobilienscout24.de';if(!allowed)throw Error('provider_url_invalid');return u.href}
async function validateUser(update:any){const ctx=await prepared(update);if(!ctx)return null;const q=update?.callback_query,chatId=Number(q?.message?.chat?.id),fromId=Number(q?.from?.id),messageId=Number(q?.message?.message_id),user=ctx.user;if(!user||!user.is_active||Number(user.telegram_user_id)!==fromId||Number(user.chat_id)!==chatId)throw Error('user_mismatch');const eligible=await rpc('application_user_eligible',{p_user:user.id});if(eligible!==true)throw Error('premium_required');return{ctx,chatId,messageId,user}}

function randomHex(bytes=32){const a=crypto.getRandomValues(new Uint8Array(bytes));return Array.from(a,b=>b.toString(16).padStart(2,'0')).join('')}
async function createConnectTicket(userId:string,provider:'kleinanzeigen'|'immomio'|'immoscout'){
 const deleteUrl=new globalThis.URL(`${URL}/rest/v1/platform_auth_flows`);
 deleteUrl.searchParams.set('user_id',`eq.${userId}`);
 deleteUrl.searchParams.set('provider',`eq.${provider}`);
 deleteUrl.searchParams.set('consumed_at','is.null');
 await fetch(deleteUrl,{method:'DELETE',headers:headers({Prefer:'return=minimal'}),signal:AbortSignal.timeout(15000)});
 const state=randomHex(24),verifier=randomHex(48);
 const r=await fetch(`${URL}/rest/v1/platform_auth_flows`,{
   method:'POST',
   headers:headers({Prefer:'return=minimal'}),
   body:JSON.stringify({user_id:userId,provider,state,code_verifier:verifier,origin:'telegram',return_target:'telegram',context:{channel:'telegram'}}),
   signal:AbortSignal.timeout(15000)
 });
 if(!r.ok)throw Error('auth_flow_create_failed');
 return{state,verifier};
}

async function handleProviderLogin(update:any,provider:'kleinanzeigen'|'immomio'|'immoscout'){
 let x:any=null;
 try{
  x=await validateUser(update);if(!x)return;
  const {ctx,chatId,messageId,user}=x,name=providerName(provider);
  let url:string,note:string;
  if(provider==='kleinanzeigen'){
   const result=await internal(APPLICATION_WORKER,{action:'login_beta_bridge',userId:String(user.id),source:2,origin:'telegram',returnTarget:'telegram',context:{channel:'telegram',remote_browser_handoff:true}});
   if(!result?.ticket)throw Error('auth_flow_create_failed');
   url='https://login.traumwohnunghamburg.de/remote/kleinanzeigen/open?ticket='+encodeURIComponent(String(result.ticket));
   note='Kleinanzeigen öffnet sich in einer temporären sicheren Browser-Sitzung. Du meldest dich direkt bei Kleinanzeigen an und bestätigst gegebenenfalls den Sicherheitscode. Danach wird die Verbindung automatisch abgeschlossen.';
  }else{
   const connect=await createConnectTicket(String(user.id),provider),ticket=connect.state;
   url=`https://login.traumwohnunghamburg.de/connect?ticket=${encodeURIComponent(ticket)}`;
   note='Die Verbindung läuft über die zentrale TraumWohnungHamburg-Anmeldeseite. Dort wird die Zuordnung geprüft und anschließend die originale Anmeldeseite des Anbieters geöffnet. Anbieterpasswörter und MFA-Codes werden nicht im Telegram-Bot gespeichert.';
  }
  await editOrSend(chatId,messageId,`🔐 <b>${name} verbinden</b>\n\n${note}`,[[{text:`🌐 ${name} verbinden`,url}],[{text:'← Automatische Bewerbung',callback_data:'platforms'}]]);
  await finish(ctx.updateId,ctx.claim,true);x=null;
 }catch(e){
  console.error(`${provider}_login_bridge`,String(e));
  const setupMissing=String(e).includes('oauth_client_not_provisioned');
  const detail=setupMissing?'Der direkte Kleinanzeigen-Login ist noch nicht vom Anbieter für unseren Web-Callback freigeschaltet.':'Bitte erneut versuchen.';
  if(x?.chatId&&x?.messageId)await editOrSend(x.chatId,x.messageId,`⚠️ <b>${providerName(provider)}-Login konnte nicht gestartet werden.</b>\n\n${detail}`,[[{text:'← Automatische Bewerbung',callback_data:'platforms'}]]).catch(()=>{});
  if(x?.ctx)await finish(x.ctx.updateId,x.ctx.claim,false,String(e)).catch(()=>{});
 }
}

async function proxy(body:string,secretValue:string){const r=await fetch(CORE,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secretValue},body,signal:AbortSignal.timeout(50000)});return new Response(await r.text(),{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json'}})}

Deno.serve(async req=>{
 try{
  if(req.method!=='POST')return new Response('method not allowed',{status:405});
  const supplied=req.headers.get('x-telegram-bot-api-secret-token')||'';let expected=await webhookSecret();
  if(supplied!==expected){cached=null;expected=await webhookSecret(true);if(supplied!==expected)return new Response('unauthorized',{status:401})}
  const body=await req.text();let update:any=null;try{update=JSON.parse(body)}catch{}
  const data=String(update?.callback_query?.data||'');
  if(update?.callback_query?.id&&['platforms:login:1','platforms:login:2','platforms:login:3'].includes(data)){
   const provider:'kleinanzeigen'|'immomio'|'immoscout'=data.endsWith(':2')?'kleinanzeigen':data.endsWith(':3')?'immomio':'immoscout';
   EdgeRuntime.waitUntil(telegram('answerCallbackQuery',{callback_query_id:String(update.callback_query.id)}).catch(()=>{}));
   EdgeRuntime.waitUntil(handleProviderLogin(update,provider).catch(e=>console.error('provider_login_background',String(e))));
   return Response.json({ok:true});
  }
  return proxy(body,expected);
 }catch(e){console.error('telegram_oauth_bridge',String(e));return Response.json({ok:false,error:'bridge_failure'},{status:502})}
});