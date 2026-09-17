import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL=Deno.env.get('SUPABASE_URL')!;
const KEYS=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const KEY=KEYS.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORE=`${URL}/functions/v1/telegram-gateway`;
const FACADE_ORIGIN='https://websitetraumwohnung.vercel.app';
let cached:{value:string,expiresAt:number}|null=null;

function headers(extra:Record<string,string>={}){return{apikey:KEY,Authorization:`Bearer ${KEY}`,'content-type':'application/json',...extra}}
async function rpc(name:string,body:Record<string,unknown>){const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}),data=await r.json().catch(()=>null);if(!r.ok)throw Error(`${name}:${r.status}`);return data}
async function secret(name:string){const data=await rpc('get_bot_secret',{secret_name:name});if(!data)throw Error('secret_unavailable');return String(data)}
async function webhookSecret(force=false){if(!force&&cached&&cached.expiresAt>Date.now())return cached.value;const value=await secret('telegram_webhook_secret');cached={value,expiresAt:Date.now()+3600000};return value}
async function telegram(method:string,body:Record<string,unknown>){const token=await secret('telegram_bot_token_runtime');const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)}),data=await r.json().catch(()=>null);if(!r.ok||!data?.ok)throw Error('telegram_failed');return data.result}
async function editOrSend(chatId:number,messageId:number,text:string,inline_keyboard:any[]){const body={chat_id:chatId,message_id:messageId,parse_mode:'HTML',disable_web_page_preview:true,text,reply_markup:{inline_keyboard}};try{return await telegram('editMessageText',body)}catch{return telegram('sendMessage',{chat_id:chatId,parse_mode:'HTML',disable_web_page_preview:true,text,reply_markup:{inline_keyboard}})}}
async function finish(updateId:number,claim:number,ok:boolean,error:string|null=null){await rpc('finish_telegram_update',{p_update_id:updateId,p_attempt:claim,p_success:ok,p_error:error})}
async function prepared(update:any){const p=await rpc('prepare_telegram_update',{p_payload:update}),claim=Number(p?.claim||0);if(claim<=0)return null;return{claim,user:p.user,updateId:Number(update.update_id)}}

function randomUrlSafe(bytes=32){const b=crypto.getRandomValues(new Uint8Array(bytes));let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function createFlow(userId:string,provider:'kleinanzeigen'|'immoscout'|'immomio'){
 const q=new globalThis.URL(`${URL}/rest/v1/platform_auth_flows`);q.searchParams.set('user_id',`eq.${userId}`);q.searchParams.set('provider',`eq.${provider}`);q.searchParams.set('consumed_at','is.null');
 const d=await fetch(q,{method:'DELETE',headers:headers({Prefer:'return=minimal'}),signal:AbortSignal.timeout(10000)});if(!d.ok)throw Error('auth_flow_cleanup_failed');
 const state=randomUrlSafe(32),code_verifier=randomUrlSafe(64);
 const r=await fetch(`${URL}/rest/v1/platform_auth_flows`,{method:'POST',headers:headers({Prefer:'return=minimal'}),body:JSON.stringify({user_id:userId,provider,state,code_verifier}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('auth_flow_create_failed');
 return state;
}
function providerName(provider:string){return provider==='kleinanzeigen'?'Kleinanzeigen':provider==='immomio'?'Immomio':'ImmoScout24'}

async function validateUser(update:any){const ctx=await prepared(update);if(!ctx)return null;const q=update?.callback_query,chatId=Number(q?.message?.chat?.id),fromId=Number(q?.from?.id),messageId=Number(q?.message?.message_id),user=ctx.user;if(!user||!user.is_active||Number(user.telegram_user_id)!==fromId||Number(user.chat_id)!==chatId)throw Error('user_mismatch');const eligible=await rpc('application_user_eligible',{p_user:user.id});if(eligible!==true)throw Error('premium_required');return{ctx,chatId,messageId,user}}

async function handleProviderLogin(update:any,provider:'kleinanzeigen'|'immomio'|'immoscout'){
 let x:any=null;
 try{
  x=await validateUser(update);if(!x)return;
  const {ctx,chatId,messageId,user}=x,state=await createFlow(String(user.id),provider),name=providerName(provider),url=`${FACADE_ORIGIN}/connect?ticket=${encodeURIComponent(state)}`;
  await editOrSend(chatId,messageId,`🔐 <b>${name} verbinden</b>\n\nÖffne die sichere Traumwohnung-Anmeldeseite. Der Telegram-Link enthält nur ein kurzlebiges, zufälliges Verbindungsticket.`,[[{text:`🌐 ${name} sicher verbinden`,url}],[{text:'← Automatische Bewerbung',callback_data:'platforms'}]]);
  await finish(ctx.updateId,ctx.claim,true);x=null;
 }catch(e){
  console.error(`${provider}_login_bridge`,String(e));
  if(x?.chatId&&x?.messageId)await editOrSend(x.chatId,x.messageId,`⚠️ <b>${providerName(provider)}-Login konnte nicht gestartet werden.</b>\n\nBitte erneut versuchen.`,[[{text:'← Automatische Bewerbung',callback_data:'platforms'}]]).catch(()=>{});
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
