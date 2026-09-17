import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {handleAutoApplyCallback,handleAutoApplyMessage,isAutoApplyCallback,isAutoApplyMessage} from './auto-apply.ts';

const URL=Deno.env.get('SUPABASE_URL')!;
const KEYS=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const KEY=KEYS.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORE=`${URL}/functions/v1/telegram-ui`;
const OAUTH_BRIDGE=`${URL}/functions/v1/telegram-oauth-bridge`;
const SECURE_LOGIN_CALLBACKS=new Set(['platforms:login:1','platforms:login:2','platforms:login:3']);
let cachedWebhookSecret:{value:string,expiresAt:number}|null=null;

function headers(){return {apikey:KEY,Authorization:`Bearer ${KEY}`,'content-type':'application/json'};}
async function secret(force=false){
 if(!force&&cachedWebhookSecret&&cachedWebhookSecret.expiresAt>Date.now())return cachedWebhookSecret.value;
 const r=await fetch(`${URL}/rest/v1/rpc/get_bot_secret`,{method:'POST',headers:headers(),body:JSON.stringify({secret_name:'telegram_webhook_secret'})});
 const data=await r.json().catch(()=>null);if(!r.ok||!data)throw Error('telegram_webhook_secret unavailable');
 const value=String(data);cachedWebhookSecret={value,expiresAt:Date.now()+3600000};return value;
}
function parsed(body:string){try{return JSON.parse(body)}catch{return null}}
function direct(method:string,params:Record<string,unknown>){return Response.json({method,...params});}
async function forward(body:string,expected:string,target:string,extraHeaders:Record<string,string>={}){
 const r=await fetch(target,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':expected,...extraHeaders},body,signal:AbortSignal.timeout(50000)});
 return new Response(await r.text(),{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json'}});
}
async function forwardToCore(body:string,expected:string,callbackAcked=false){
 return forward(body,expected,CORE,{'x-region':'eu-west-1','x-callback-acked':callbackAcked?'1':'0'});
}

Deno.serve(async req=>{
 try{
  if(req.method!=='POST')return new Response('method not allowed',{status:405});
  const supplied=req.headers.get('x-telegram-bot-api-secret-token')||'';let expected=await secret();
  if(supplied!==expected){cachedWebhookSecret=null;expected=await secret(true);if(supplied!==expected)return new Response('unauthorized',{status:401});}
  const body=await req.text(),update=parsed(body),callback=String(update?.callback_query?.data||'');

  // Security invariant: provider login callbacks may never reach the legacy
  // auto-apply/UI handlers that can emit provider URLs. Always hand them to
  // telegram-oauth-bridge, which only exposes the Vercel /connect facade.
  if(update?.callback_query?.id&&SECURE_LOGIN_CALLBACKS.has(callback)){
   return forward(body,expected,OAUTH_BRIDGE);
  }

  const autoCallback=typeof isAutoApplyCallback==='function'&&isAutoApplyCallback(callback);
  if(update?.callback_query?.id&&autoCallback){
   EdgeRuntime.waitUntil(handleAutoApplyCallback(update).catch(e=>console.error('telegram_auto_apply_callback',String(e))));
   return direct('answerCallbackQuery',{callback_query_id:String(update.callback_query.id)});
  }
  const autoMessage=typeof isAutoApplyMessage==='function'&&isAutoApplyMessage(update);
  if(autoMessage){
   EdgeRuntime.waitUntil(handleAutoApplyMessage(update).catch(e=>console.error('telegram_auto_apply_message',String(e))));
   return Response.json({ok:true});
  }
  if(update?.callback_query?.id){
   EdgeRuntime.waitUntil(forwardToCore(body,expected,true).then(r=>{if(!r.ok)console.error('telegram_callback_core',r.status)}).catch(e=>console.error('telegram_callback_core',String(e))));
   return direct('answerCallbackQuery',{callback_query_id:String(update.callback_query.id)});
  }
  return forwardToCore(body,expected,false);
 }catch(error){console.error('telegram_gateway',String(error));return Response.json({ok:false,error:'gateway_failure'},{status:502});}
});
