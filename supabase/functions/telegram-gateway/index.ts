import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {handleAutoApplyCallback,handleAutoApplyMessage,isAutoApplyCallback,isAutoApplyMessage} from './auto-apply.ts';
import {likelyFastAction,renderFast} from './fast-ui.ts';

const URL=Deno.env.get('SUPABASE_URL')!;
const KEYS=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const KEY=KEYS.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORE=`${URL}/functions/v1/telegram-ui?forceFunctionRegion=eu-west-1`;
const OAUTH_BRIDGE=`${URL}/functions/v1/telegram-oauth-bridge?forceFunctionRegion=eu-west-1`;
const secretCache=new Map<string,{value:string,expiresAt:number}>();
const secretInflight=new Map<string,Promise<string>>();

function headers(){return {apikey:KEY,Authorization:`Bearer ${KEY}`,'content-type':'application/json'};}
async function rpc(name:string,body:Record<string,unknown>){
 const r=await fetch(`${URL}/rest/v1/rpc/${name}`,{method:'POST',headers:headers(),body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await r.json().catch(()=>null);if(!r.ok)throw Error(`${name}:${r.status}`);return data;
}
async function secret(name:string,force=false){
 const cached=secretCache.get(name);if(!force&&cached&&cached.expiresAt>Date.now())return cached.value;
 if(!force&&secretInflight.has(name))return secretInflight.get(name)!;
 const task=(async()=>{const data=await rpc('get_bot_secret',{secret_name:name});if(!data)throw Error(name+' unavailable');const value=String(data);secretCache.set(name,{value,expiresAt:Date.now()+(name==='telegram_webhook_secret'?3600000:300000)});return value;})();
 secretInflight.set(name,task);try{return await task}finally{secretInflight.delete(name)}
}
function parsed(body:string){try{return JSON.parse(body)}catch{return null}}
function direct(method:string,params:Record<string,unknown>){return Response.json({method,...params});}
async function telegram(method:string,params:Record<string,unknown>){
 const token=await secret('telegram_bot_token_runtime');
 const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(15000)});
 const data=await r.json().catch(()=>null);if(!r.ok||!data?.ok)throw Error(String(data?.description||`telegram:${r.status}`));return data.result;
}
async function acknowledge(id:string){const started=Date.now();try{await telegram('answerCallbackQuery',{callback_query_id:id});return Date.now()-started}catch(error){console.error('telegram_fast_ack',String(error));return null}}
async function recordMetric(updateId:number,metrics:Record<string,number>){try{await rpc('record_telegram_fast_metric',{p_update_id:updateId,p_metrics:metrics})}catch(error){console.error('telegram_fast_metric',String(error))}}
async function forward(body:string,expected:string,target:string,extraHeaders:Record<string,string>={}){
 const r=await fetch(target,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':expected,...extraHeaders},body,signal:AbortSignal.timeout(50000)});
 return new Response(await r.text(),{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/json'}});
}
async function forwardToCore(body:string,expected:string,callbackAcked=false){
 return forward(body,expected,CORE,{'x-callback-acked':callbackAcked?'1':'0'});
}
async function fastAction(update:any){return rpc('telegram_fast_action_v2',{p_payload:update})}

Deno.serve(async req=>{
 const requestStarted=Date.now();
 try{
  if(req.method!=='POST')return new Response('method not allowed',{status:405});
  const supplied=req.headers.get('x-telegram-bot-api-secret-token')||'';let expected=await secret('telegram_webhook_secret');
  if(supplied!==expected){secretCache.delete('telegram_webhook_secret');expected=await secret('telegram_webhook_secret',true);if(supplied!==expected)return new Response('unauthorized',{status:401});}
  const body=await req.text(),update=parsed(body),callback=String(update?.callback_query?.data||''),callbackId=String(update?.callback_query?.id||'');

  if(callbackId&&['platforms:login:1','platforms:login:2','platforms:login:3'].includes(callback)){
   EdgeRuntime.waitUntil(forward(body,expected,OAUTH_BRIDGE).then(r=>{if(!r.ok)console.error('telegram_oauth_bridge',r.status)}).catch(e=>console.error('telegram_oauth_bridge',String(e))));
   return direct('answerCallbackQuery',{callback_query_id:callbackId});
  }

  const autoCallback=typeof isAutoApplyCallback==='function'&&isAutoApplyCallback(callback);
  if(callbackId&&autoCallback){
   EdgeRuntime.waitUntil(handleAutoApplyCallback(update).catch(e=>console.error('telegram_auto_apply_callback',String(e))));
   return direct('answerCallbackQuery',{callback_query_id:callbackId});
  }
  const autoMessage=typeof isAutoApplyMessage==='function'&&isAutoApplyMessage(update);
  if(autoMessage){
   EdgeRuntime.waitUntil(handleAutoApplyMessage(update).catch(e=>console.error('telegram_auto_apply_message',String(e))));
   return Response.json({ok:true});
  }

  if(callbackId&&callback==='noop')return direct('answerCallbackQuery',{callback_query_id:callbackId});

  if(callbackId&&likelyFastAction(callback)){
   const ackPromise=acknowledge(callbackId),dbStarted=Date.now();
   try{
    const fast=await fastAction(update),dbMs=Date.now()-dbStarted;
    if(fast?.fast===true&&Number(fast?.claim||0)===0)return direct('answerCallbackQuery',{callback_query_id:callbackId});
    if(fast?.fast===true&&Number(fast?.claim||0)>0&&!fast?.blocked){
      const renderStarted=Date.now(),rendered=renderFast(fast,update),renderMs=Date.now()-renderStarted;
      if(rendered){
       const {method,...params}=rendered as any;
       let telegramMs=0;
       if(fast?.critical===true){
        const tgStarted=Date.now();
        try{await telegram(method,params);telegramMs=Date.now()-tgStarted}
        catch(error){telegramMs=Date.now()-tgStarted;console.error('telegram_fast_critical_edit',String(error));const responseMs=Date.now()-requestStarted;EdgeRuntime.waitUntil((async()=>{const ackMs=await ackPromise;await recordMetric(Number(update.update_id),{db_ms:dbMs,render_ms:renderMs,ack_ms:Number(ackMs||0),response_ms:responseMs,telegram_ms:telegramMs,total_ms:responseMs,rpc_count:1,telegram_count:2,fast_path:1})})());return Response.json(rendered)}
       }
       const responseMs=Date.now()-requestStarted;
       EdgeRuntime.waitUntil((async()=>{const ackMs=await ackPromise;await recordMetric(Number(update.update_id),{db_ms:dbMs,render_ms:renderMs,ack_ms:Number(ackMs||0),response_ms:responseMs,telegram_ms:telegramMs,total_ms:responseMs,rpc_count:1,telegram_count:fast?.critical===true?2:2,fast_path:1})})());
       if(fast?.reward?.status==='rewarded')EdgeRuntime.waitUntil(telegram('sendMessage',{chat_id:Number(update.callback_query.message.chat.id),text:'💎 <b>30 Tage Premium kostenlos aktiviert</b>\n\nDein erstes Suchprofil ist erstellt und dir wurden 30 Tage Premium kostenlos gutgeschrieben.',parse_mode:'HTML'}).catch(e=>console.error('telegram_reward_notice',String(e))));
       return fast?.critical===true?Response.json({ok:true}):Response.json(rendered);
      }
    }
   }catch(error){console.error('telegram_fast_path',String(error))}
   EdgeRuntime.waitUntil((async()=>{const delays=[0,40,80,140,220,320];let last:Response|null=null;for(const delay of delays){if(delay)await new Promise(resolve=>setTimeout(resolve,delay));last=await forwardToCore(body,expected,true);if(![409,503].includes(last.status))break;}if(last&&!last.ok)console.error('telegram_callback_core',last.status)})().catch(e=>console.error('telegram_callback_core',String(e))));
   return direct('answerCallbackQuery',{callback_query_id:callbackId});
  }

  if(callbackId){
   EdgeRuntime.waitUntil((async()=>{const delays=[0,40,80,140,220,320];let last:Response|null=null;for(const delay of delays){if(delay)await new Promise(resolve=>setTimeout(resolve,delay));last=await forwardToCore(body,expected,true);if(![409,503].includes(last.status))break;}if(last&&!last.ok)console.error('telegram_callback_core',last.status)})().catch(e=>console.error('telegram_callback_core',String(e))));
   return direct('answerCallbackQuery',{callback_query_id:callbackId});
  }
  return forwardToCore(body,expected,false);
 }catch(error){console.error('telegram_gateway',String(error));return Response.json({ok:false,error:'gateway_failure'},{status:502});}
});
