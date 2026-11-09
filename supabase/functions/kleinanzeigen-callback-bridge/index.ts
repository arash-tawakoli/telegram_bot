import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const base=Deno.env.get('SUPABASE_URL')!;
const serviceKey=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(base,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

const APPLICATION_WORKER=`${base}/functions/v1/application-worker`;
const CALLBACK_ORIGIN='https://login.kleinanzeigen.de';
const CALLBACK_PATH='/android/com.ebay.kleinanzeigen/callback';
const COACH_RETURN='https://intern.traumwohnunghamburg.de';
const TELEGRAM_CONNECTED='https://t.me/traumwohnunghamburgbot?start=ka_connected';
const TELEGRAM_FAILED='https://t.me/traumwohnunghamburgbot?start=ka_failed';

const HEADERS={
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'POST, OPTIONS',
  'access-control-allow-headers':'content-type',
  'access-control-max-age':'600',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff'
};

function json(body:Record<string,unknown>,status=200){
  return new Response(JSON.stringify(body),{status,headers:HEADERS});
}

async function secret(name:string){
  const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});
  if(error||!data)throw Error('configuration_unavailable');
  return String(data);
}

function callbackUrl(value:unknown){
  const raw=String(value||'').trim();
  if(!raw||raw.length>8000)throw Error('invalid_callback_url');
  let url:URL;
  try{url=new URL(raw)}catch{throw Error('invalid_callback_url')}
  if(url.origin!==CALLBACK_ORIGIN||url.pathname!==CALLBACK_PATH||url.username||url.password||url.port)throw Error('invalid_callback_url');
  if(!url.searchParams.get('state'))throw Error('invalid_callback_url');
  if(!url.searchParams.get('code')&&!url.searchParams.get('error'))throw Error('invalid_callback_url');
  return url;
}

function target(flow:any,ok:boolean){
  const coach=flow?.return_target==='coach'||flow?.origin==='coach';
  return{
    returnTarget:coach?'coach':'telegram',
    redirectUrl:coach?COACH_RETURN:(ok?TELEGRAM_CONNECTED:TELEGRAM_FAILED)
  };
}

async function notifyTelegram(userId:string,text:string){
  try{
    const [{data:user},token]=await Promise.all([
      db.from('bot_users').select('chat_id').eq('id',userId).maybeSingle(),
      secret('telegram_bot_token_runtime')
    ]);
    if(!user?.chat_id)return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:user.chat_id,text}),
      signal:AbortSignal.timeout(10000)
    });
  }catch{}
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
  if(request.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);

  const declared=Number(request.headers.get('content-length')||0);
  if(Number.isFinite(declared)&&declared>12000)return json({ok:false,error:'request_too_large'},413);

  let body:any;
  try{body=await request.json()}catch{return json({ok:false,error:'invalid_request'},400)}

  let url:URL;
  try{url=callbackUrl(body?.callbackUrl)}catch(error:any){return json({ok:false,error:String(error?.message||'invalid_callback_url')},400)}

  const state=String(url.searchParams.get('state')||'');
  const {data:flow,error:flowError}=await db
    .from('platform_auth_flows')
    .select('id,user_id,origin,return_target,expires_at,consumed_at,code_verifier')
    .eq('provider','kleinanzeigen')
    .eq('state',state)
    .is('consumed_at',null)
    .maybeSingle();

  if(flowError||!flow)return json({ok:false,error:'auth_flow_expired',returnTarget:'telegram',redirectUrl:TELEGRAM_FAILED},400);

  const destination=target(flow,false);
  if(!flow.code_verifier||Date.parse(String(flow.expires_at||''))<=Date.now()){
    return json({ok:false,error:'auth_flow_expired',...destination},400);
  }

  if(url.searchParams.get('error')){
    try{
      await db.from('platform_connections').update({
        status:'needs_login',
        last_error:String(url.searchParams.get('error')||'oauth_login_failed').slice(0,120),
        updated_at:new Date().toISOString()
      }).eq('user_id',flow.user_id).eq('provider','kleinanzeigen');
      await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.id).is('consumed_at',null);
    }catch{}
    return json({ok:false,error:'oauth_login_failed',...destination},400);
  }

  try{
    const internalSecret=await secret('internal_worker_secret');
    const response=await fetch(APPLICATION_WORKER,{
      method:'POST',
      headers:{'content-type':'application/json','x-internal-secret':internalSecret},
      body:JSON.stringify({action:'complete_login',userId:String(flow.user_id),source:2,callbackUrl:url.href}),
      signal:AbortSignal.timeout(30000)
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok||result?.authenticated!==true)throw Error(String(result?.error||'token_exchange_failed'));

    const success=target(flow,true);
    if(success.returnTarget==='telegram')await notifyTelegram(String(flow.user_id),'✅ Kleinanzeigen verbunden. Die Anmeldung wurde automatisch abgeschlossen.');
    return json({ok:true,status:'connected',...success});
  }catch(error:any){
    const failure=target(flow,false);
    const code=String(error?.message||'bridge_callback_failed');
    return json({ok:false,error:['invalid_callback_url','auth_flow_expired','token_exchange_failed','oauth_login_failed'].includes(code)?code:'bridge_callback_failed',...failure},400);
  }
});
