import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const BASE=Deno.env.get('SUPABASE_URL')!;
const CALLBACK=`${BASE}/functions/v1/immoscout-auth-bridge`;
const SSO='https://sso.immobilienscout24.de/sso/authenticate';
const PROVIDER='immoscout';
const enc=new TextEncoder(),dec=new TextDecoder();

const b64=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};
const unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const b64url=(bytes:Uint8Array)=>b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const clean=(v:any,max=320)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);

async function secret(name:string){const {data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data)}
async function keyMaterial(version=1){const raw=unb64(await secret(`application_credential_key_v${version}`));if(raw.length!==32)throw Error('credential_key_invalid');return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])}
async function encryptCredentials(userId:string,value:unknown,version=1){const key=await keyMaterial(version),iv=crypto.getRandomValues(new Uint8Array(12)),aad=enc.encode(`${userId}:${PROVIDER}:v${version}`),plain=enc.encode(JSON.stringify(value)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,plain));return{credential_ciphertext:b64(cipher),credential_iv:b64(iv),key_version:version}}
async function decryptCredentials(row:any){if(!row?.credential_ciphertext||!row?.credential_iv)return null;const version=Number(row.key_version)||1,key=await keyMaterial(version),aad=enc.encode(`${row.user_id}:${PROVIDER}:v${version}`);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(row.credential_iv),additionalData:aad},key,unb64(row.credential_ciphertext));return JSON.parse(dec.decode(plain))}
function uuid(v:any){const s=String(v||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw Error('invalid_user');return s}
function validEmail(v:any){const e=clean(v,320).toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?e:null}
async function eligible(userId:string){const {data,error}=await db.rpc('application_user_eligible',{p_user:userId});if(error||data!==true)throw Error('premium_required')}
async function notifyUser(userId:string,text:string){try{const [{data:user},{data:token}]=await Promise.all([db.from('bot_users').select('chat_id').eq('id',userId).maybeSingle(),db.rpc('get_bot_secret',{secret_name:'telegram_bot_token_runtime'})]);if(!user?.chat_id||!token)return;await fetch(`https://api.telegram.org/bot${String(token)}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:user.chat_id,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:{inline_keyboard:[[{text:'⚡ Automatische Bewerbung',callback_data:'platforms'}]]}}),signal:AbortSignal.timeout(15000)})}catch{}}

async function beginLogin(userId:string){
 const {data:profile,error:profileError}=await db.from('applicant_profiles').select('email').eq('user_id',userId).maybeSingle();
 const email=validEmail(profile?.email);if(profileError||!email)throw Error('immoscout_email_required');
 await db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER).is('consumed_at',null);
 const state=random().slice(0,43),{error:flowError}=await db.from('platform_auth_flows').insert({user_id:userId,provider:PROVIDER,state,code_verifier:null});if(flowError)throw Error('auth_flow_create_failed');
 const {error:connError}=await db.from('platform_connections').upsert({user_id:userId,provider:PROVIDER,status:'pending',account_hint:email,credential_ciphertext:null,credential_iv:null,key_version:1,expires_at:null,last_verified_at:null,last_error:null,updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});if(connError)throw Error('connection_update_failed');
 const callback=new URL(CALLBACK);callback.searchParams.set('callback','1');callback.searchParams.set('state',state);
 const url=new URL(SSO);url.searchParams.set('appName','is24-android-app');url.searchParams.set('ncal','false');url.searchParams.set('sso_return',callback.href);
 return{status:'login',url:url.href,requiresCallback:false,automaticCallback:true,transport:'immoscout-sso-direct-return',expiresInSeconds:600};
}

function callbackPage(){return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ImmoScout24 verbinden</title><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#fff;color:#222}.wrap{max-width:560px;margin:12vh auto;padding:24px}.box{border:1px solid #ddd;border-radius:16px;padding:24px}h1{font-size:22px;margin:0 0 12px}p{line-height:1.5}.muted{color:#666}a{color:#065fd4}</style></head><body><div class="wrap"><div class="box"><h1>ImmoScout24-Login angekommen</h1><p id="status">Der Rücksprung wird sicher übernommen …</p><p class="muted">Du kannst danach zu Telegram zurückkehren.</p><p><a href="https://t.me/traumwohnunghamburgbot">Telegram öffnen</a></p></div></div><script>(async()=>{const el=document.getElementById('status');try{const u=new URL(location.href),state=u.searchParams.get('state');const r=await fetch(location.origin+location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'capture_callback',state,href:location.href})});const j=await r.json();el.textContent=j&&j.ok?'Rücksprung erfasst. Die Verbindung wird jetzt geprüft.':'Der Rücksprung konnte nicht übernommen werden. Bitte den Login erneut starten.'}catch{el.textContent='Der Rücksprung konnte nicht übernommen werden. Bitte den Login erneut starten.'}})();</script></body></html>`,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}})}

async function captureCallback(body:any){
 const state=clean(body?.state,120),href=String(body?.href||'');if(!state||!href||href.length>12000)throw Error('invalid_callback_url');
 let url:URL;try{url=new URL(href)}catch{throw Error('invalid_callback_url')}
 const expected=new URL(CALLBACK);if(url.protocol!==expected.protocol||url.hostname!==expected.hostname||url.pathname!==expected.pathname||url.searchParams.get('callback')!=='1'||url.searchParams.get('state')!==state)throw Error('invalid_callback_url');
 const {data:flow,error:flowError}=await db.from('platform_auth_flows').select('*').eq('provider',PROVIDER).eq('state',state).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();if(flowError||!flow)throw Error('auth_flow_expired');
 const query:Record<string,string>={};for(const [k,v] of url.searchParams.entries())if(k!=='callback'&&k!=='state')query[k]=v;
 const hashRaw=url.hash.replace(/^#/,'');const hash:Record<string,string>={};if(hashRaw){for(const [k,v] of new URLSearchParams(hashRaw.replace(/^\?/,'')))hash[k]=v}
 const hasMaterial=Object.keys(query).length>0||Object.keys(hash).length>0;
 const encrypted=await encryptCredentials(String(flow.user_id),{captured_at:new Date().toISOString(),query,hash});
 const {data:profile}=await db.from('applicant_profiles').select('email').eq('user_id',flow.user_id).maybeSingle();
 const {error:saveError}=await db.from('platform_connections').upsert({user_id:flow.user_id,provider:PROVIDER,status:'pending',account_hint:validEmail(profile?.email),...encrypted,expires_at:null,last_verified_at:null,last_error:hasMaterial?'callback_captured_unverified':'callback_no_transferable_credential',updated_at:new Date().toISOString()},{onConflict:'user_id,provider'});if(saveError)throw Error('connection_save_failed');
 await db.from('platform_auth_flows').update({consumed_at:new Date().toISOString()}).eq('id',flow.id);
 await notifyUser(String(flow.user_id),hasMaterial?'✅ <b>ImmoScout24-Login zurückgegeben</b>\n\nDer Login-Rücksprung wurde verschlüsselt übernommen. Die Anmeldedaten werden jetzt technisch verifiziert.':'⚠️ <b>ImmoScout24-Login zurückgegeben</b>\n\nDer Browser-Login war erfolgreich, aber ImmoScout24 hat im Rücksprung keine übertragbaren Anmeldedaten geliefert. Die Verbindung wurde deshalb noch nicht freigegeben.');
 return{ok:true,captured:true,hasTransferableMaterial:hasMaterial,paramNames:Object.keys(query),hashParamNames:Object.keys(hash)};
}

async function checkConnection(userId:string){const {data,error}=await db.from('platform_connections').select('status,last_error,last_verified_at,credential_ciphertext').eq('user_id',userId).eq('provider',PROVIDER).maybeSingle();if(error)throw Error('connection_read_failed');if(!data)return{authenticated:false,status:'disconnected'};return{authenticated:data.status==='connected'?true:data.status==='pending'?null:false,status:data.status,lastError:data.last_error||null,captured:!!data.credential_ciphertext}}
async function inspectCapture(userId:string){const {data,error}=await db.from('platform_connections').select('*').eq('user_id',userId).eq('provider',PROVIDER).maybeSingle();if(error||!data)return{status:'disconnected',captured:false};const payload=await decryptCredentials(data).catch(()=>null),query=payload?.query&&typeof payload.query==='object'?payload.query:{},hash=payload?.hash&&typeof payload.hash==='object'?payload.hash:{};return{status:data.status,lastError:data.last_error||null,captured:!!payload,paramNames:Object.keys(query),paramLengths:Object.fromEntries(Object.entries(query).map(([k,v])=>[k,String(v).length])),hashParamNames:Object.keys(hash),hashParamLengths:Object.fromEntries(Object.entries(hash).map(([k,v])=>[k,String(v).length]))}}
async function disconnect(userId:string){await Promise.all([db.from('platform_connections').delete().eq('user_id',userId).eq('provider',PROVIDER),db.from('platform_auth_flows').delete().eq('user_id',userId).eq('provider',PROVIDER)]);return{status:'disconnected'}}

Deno.serve(async req=>{try{
 const requestUrl=new URL(req.url);
 if(req.method==='GET'&&requestUrl.searchParams.get('callback')==='1')return callbackPage();
 if(req.method!=='POST')return new Response('method not allowed',{status:405});
 const body=await req.json().catch(()=>({}));
 if(body.action==='capture_callback')return Response.json(await captureCallback(body));
 if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
 if(body.action==='health')return Response.json({ok:true,mode:'immoscout-sso-direct-return-discovery',marksConnected:false});
 const userId=uuid(body.userId);if(body.action!=='disconnect')await eligible(userId);
 if(body.action==='login')return Response.json(await beginLogin(userId));
 if(body.action==='check')return Response.json(await checkConnection(userId));
 if(body.action==='inspect')return Response.json(await inspectCapture(userId));
 if(body.action==='disconnect')return Response.json(await disconnect(userId));
 throw Error('invalid_action');
}catch(error:any){const code=String(error?.message||'immoscout_operation_failed'),safe=new Set(['configuration_unavailable','credential_key_invalid','premium_required','invalid_user','invalid_action','immoscout_email_required','auth_flow_create_failed','connection_update_failed','connection_save_failed','connection_read_failed','invalid_callback_url','auth_flow_expired']);return Response.json({error:safe.has(code)?code:'immoscout_operation_failed'},{status:503})}});
