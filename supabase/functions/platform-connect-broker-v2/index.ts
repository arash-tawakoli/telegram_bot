import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const URL=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(URL,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const KLEIN_AUTHORIZE='https://login.kleinanzeigen.de/authorize';
const KLEIN_CLIENT_ID='uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const KLEIN_REDIRECT='https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const KLEIN_SCOPE='openid email profile offline_access';
const IMMOMIO_GQL='https://gql-ps.immomio.com/tenant/graphql';
const IMMOMIO_TENANT='https://tenant.immomio.com';
const IMMOMIO_REDIRECT='https://tenant.immomio.com/de/auth/login';
const IMMOMIO_CLIENT='immomio-oidc-web';
const IMMOMIO_REALM='immomio';
const IMMOMIO_BASE='https://sso.immomio.com/auth';
const SCOUT_ISSUER='https://login.immobilienscout24.de/oauth2/aus1227au6oBg6hGH417';
const SCOUT_CLIENT='is24-android-de';
const SCOUT_REDIRECT='immobilienscout24.de:/loginCallback';
const SCOUT_SCOPE='openid profile offline_access';
const enc=new TextEncoder();

function ticket(v:any){const s=String(v||'');if(!/^[A-Za-z0-9_-]{20,100}$/.test(s))throw Error('invalid_ticket');return s}
function clean(v:any,max=320){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}
function b64url(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function challenge(v:string){return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(v))))}
function maskEmail(v:any){const s=clean(v,320);const i=s.indexOf('@');if(i<2)return null;return s[0]+'***'+s.slice(i)}
function participantLabel(first:any,last:any){const f=clean(first,80),l=clean(last,80);return [f,l?l[0]+'.':''].filter(Boolean).join(' ')||'Teilnehmer'}

async function flowFor(raw:any,allowConsumed=false){
 const state=ticket(raw),now=new Date().toISOString();
 let q=db.from('platform_auth_flows').select('id,user_id,provider,state,code_verifier,origin,return_target,context,created_at,expires_at,consumed_at').eq('state',state);
 if(!allowConsumed)q=q.is('consumed_at',null).gt('expires_at',now);
 else q=q.gt('created_at',new Date(Date.now()-2*60*60*1000).toISOString());
 const{data,error}=await q.limit(2);
 if(error||!Array.isArray(data)||data.length!==1)throw Error('auth_flow_expired');
 return data[0];
}
async function profile(flow:any){
 const[{data:p},{data:c}]=await Promise.all([
  db.from('applicant_profiles').select('first_name,last_name,email').eq('user_id',flow.user_id).maybeSingle(),
  db.from('platform_connections').select('account_hint').eq('user_id',flow.user_id).eq('provider',flow.provider).maybeSingle()
 ]);
 return{label:participantLabel(p?.first_name,p?.last_name),accountHint:maskEmail(c?.account_hint||p?.email)};
}
function kleinUrl(flow:any,cc:string){const u=new URL(KLEIN_AUTHORIZE);for(const[k,v]of Object.entries({client_id:KLEIN_CLIENT_ID,response_type:'code',redirect_uri:KLEIN_REDIRECT,scope:KLEIN_SCOPE,code_challenge:cc,code_challenge_method:'S256',state:String(flow.state),prompt:'login'}))u.searchParams.set(k,String(v));return u.href}
async function immomioUrl(flow:any,cc:string){
 const{data:p,error}=await db.from('applicant_profiles').select('email').eq('user_id',flow.user_id).maybeSingle();const email=clean(p?.email,320).toLowerCase();
 if(error||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('profile_email_required');
 const query='query sso($email: String, $redirectUri: String!, $loginMethod: String) { sso(input: { email: $email redirectUri: $redirectUri loginMethod: $loginMethod }) { baseUrl clientId realm } }';
 let response:Response;try{response=await fetch(IMMOMIO_GQL,{method:'POST',headers:{'content-type':'application/json',accept:'application/json',origin:IMMOMIO_TENANT,referer:IMMOMIO_TENANT+'/'},body:JSON.stringify({query,variables:{email,redirectUri:IMMOMIO_REDIRECT,loginMethod:'DEFAULT'}}),signal:AbortSignal.timeout(20000)})}catch{throw Error('temporary_network_error')}
 const body=await response.json().catch(()=>null),sso=body?.data?.sso;
 if(!response.ok||body?.errors?.length||!sso||String(sso.clientId)!==IMMOMIO_CLIENT||String(sso.realm)!==IMMOMIO_REALM)throw Error('provider_contract_unverified');
 const u=new URL(`${IMMOMIO_BASE}/realms/${IMMOMIO_REALM}/protocol/openid-connect/auth`);
 for(const[k,v]of Object.entries({client_id:IMMOMIO_CLIENT,redirect_uri:IMMOMIO_REDIRECT,response_type:'code',response_mode:'query',scope:'openid profile email',state:String(flow.state),code_challenge:cc,code_challenge_method:'S256',login_hint:email,prompt:'login'}))u.searchParams.set(k,String(v));
 return u.href;
}
async function scoutUrl(flow:any,cc:string){
 const{data:p}=await db.from('applicant_profiles').select('email').eq('user_id',flow.user_id).maybeSingle();
 const u=new URL(SCOUT_ISSUER+'/v1/authorize');
 const params:any={source:'myaccount',utm_medium:'app',utm_source:'android',utm_campaign:'sso_entrance',app_name:SCOUT_CLIENT,consent:'true',client_id:SCOUT_CLIENT,response_type:'code',response_mode:'query',redirect_uri:SCOUT_REDIRECT,scope:SCOUT_SCOPE,state:String(flow.state),nonce:crypto.randomUUID(),code_challenge:cc,code_challenge_method:'S256',prompt:'login'};
 const email=clean(p?.email,320);if(email)params.login_hint=email;
 for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
 return u.href;
}
async function resolve(raw:any){
 const flow=await flowFor(raw),provider=String(flow.provider),verifier=String(flow.code_verifier||'');if(!verifier)throw Error('auth_flow_expired');
 const cc=await challenge(verifier),p=await profile(flow);
 if(provider==='kleinanzeigen')return{ok:true,provider,mode:'provider_web',url:kleinUrl(flow,cc),participantLabel:p.label,accountHint:p.accountHint,origin:flow.origin,returnTarget:flow.return_target,requiresManualCallback:true};
 if(provider==='immomio')return{ok:true,provider,mode:'provider_web',url:await immomioUrl(flow,cc),participantLabel:p.label,accountHint:p.accountHint,origin:flow.origin,returnTarget:flow.return_target,requiresManualCallback:true};
 if(provider==='immoscout')return{ok:true,provider,mode:'provider_web',url:await scoutUrl(flow,cc),participantLabel:p.label,accountHint:p.accountHint,origin:flow.origin,returnTarget:flow.return_target,requiresManualCallback:true};
 throw Error('provider_unsupported');
}
async function status(raw:any){
 const flow=await flowFor(raw,true),p=await profile(flow);
 const{data:c,error}=await db.from('platform_connections').select('status,last_verified_at,last_error').eq('user_id',flow.user_id).eq('provider',flow.provider).maybeSingle();
 if(error)throw Error('connection_read_failed');
 return{ok:true,provider:flow.provider,status:c?.status||'disconnected',connected:c?.status==='connected',lastVerifiedAt:c?.last_verified_at||null,participantLabel:p.label,accountHint:p.accountHint,origin:flow.origin,returnTarget:flow.return_target};
}
const H={'content-type':'application/json','cache-control':'no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer','access-control-allow-origin':'https://login.traumwohnunghamburg.de','vary':'Origin'};
function out(body:any,status=200){return new Response(JSON.stringify(body),{status,headers:H})}
function err(e:any){const code=String(e?.message||'connect_failed'),safe=new Set(['invalid_ticket','auth_flow_expired','provider_unsupported','profile_email_required','temporary_network_error','provider_contract_unverified','connection_read_failed']);return out({error:safe.has(code)?code:'connect_failed'},code==='auth_flow_expired'?410:code==='invalid_ticket'?400:503)}
Deno.serve(async req=>{try{if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...H,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type'}});if(req.method!=='POST')return new Response('method not allowed',{status:405,headers:H});const b=await req.json().catch(()=>({}));if(b.action==='resolve')return out(await resolve(b.ticket));if(b.action==='status')return out(await status(b.ticket));throw Error('invalid_action')}catch(e){return err(e)}});
