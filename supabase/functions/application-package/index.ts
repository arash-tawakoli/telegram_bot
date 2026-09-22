
import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const base=Deno.env.get('SUPABASE_URL')!;
const te=new TextEncoder();
const td=new TextDecoder();

const b64url=(bytes:Uint8Array)=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const unb64url=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
const unb64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,(ch)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' } as any)[ch]||ch);

async function secret(name:string){const{data,error}=await db.rpc('get_bot_secret',{secret_name:name});if(error||!data)throw Error('configuration_unavailable');return String(data)}
async function hmacKey(){const raw=unb64(await secret('application_credential_key_v1'));return crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
async function sign(payload:string){return b64url(new Uint8Array(await crypto.subtle.sign('HMAC',await hmacKey(),te.encode(payload))))}
async function makeToken(userId:string,applicationId:string){const payload=b64url(te.encode(JSON.stringify({u:userId,a:applicationId})));return payload+'.'+await sign(payload)}
async function verifyToken(value:string){
 const parts=String(value||'').split('.'),payload=parts[0],sig=parts[1];
 if(parts.length!==2||!payload||!sig)throw Error('invalid_token');
 const ok=await crypto.subtle.verify('HMAC',await hmacKey(),unb64url(sig),te.encode(payload));
 if(!ok)throw Error('invalid_token');
 let data:any;try{data=JSON.parse(td.decode(unb64url(payload)))}catch{throw Error('invalid_token')}
 if(!/^[0-9a-f-]{36}$/i.test(String(data?.u||''))||!/^[0-9a-f-]{36}$/i.test(String(data?.a||'')))throw Error('invalid_token');
 return{userId:String(data.u),applicationId:String(data.a)};
}
async function createPackage(userId:string,applicationId:string){
 const {data:app,error:ae}=await db.from('applications').select('id,user_id').eq('id',applicationId).eq('user_id',userId).maybeSingle();
 if(ae||!app)throw Error('application_not_found');

 const {data:existing,error:existingError}=await db.from('application_document_packages')
  .select('application_id,user_id,expires_at,revoked_at')
  .eq('application_id',applicationId).eq('user_id',userId).maybeSingle();
 if(existingError)throw Error('package_read_failed');
 if(existing?.revoked_at)throw Error('package_revoked');
 if(existing&&Date.parse(existing.expires_at)>Date.now()){
  const {count,error}=await db.from('application_document_package_items')
   .select('document_id',{count:'exact',head:true}).eq('application_id',applicationId);
  if(error)throw Error('package_snapshot_failed');
  const t=await makeToken(userId,applicationId);
  return{url:base+'/functions/v1/application-package?t='+encodeURIComponent(t),count:Number(count||0),expiresAt:existing.expires_at,reused:true};
 }

 const {data:docs,error:de}=await db.from('applicant_documents')
  .select('id,original_filename,storage_path,mime_type,size_bytes,created_at')
  .eq('user_id',userId).eq('send_with_auto_apply',true).order('created_at',{ascending:true});
 if(de)throw Error('documents_read_failed');
 if(!docs?.length)return{url:null,count:0};

 const expiresAt=new Date(Date.now()+30*24*60*60*1000).toISOString();
 const {error:pe}=await db.from('application_document_packages').insert({
  application_id:applicationId,user_id:userId,expires_at:expiresAt,revoked_at:null,updated_at:new Date().toISOString()
 });
 if(pe)throw Error('package_save_failed');

 const snapshot=docs.map((d:any,i:number)=>({
  application_id:applicationId,document_id:d.id,ordinal:i,
  original_filename:String(d.original_filename),storage_path:String(d.storage_path),
  mime_type:String(d.mime_type),size_bytes:Number(d.size_bytes)
 }));
 const {error:itemError}=await db.from('application_document_package_items').insert(snapshot);
 if(itemError)throw Error('package_snapshot_failed');

 const t=await makeToken(userId,applicationId);
 return{url:base+'/functions/v1/application-package?t='+encodeURIComponent(t),count:docs.length,expiresAt,reused:false};
}
async function packagePage(request:Request){
 const u=new URL(request.url),raw=u.searchParams.get('t')||'',ids=await verifyToken(raw);
 const {data:pkg,error:pe}=await db.from('application_document_packages').select('application_id,user_id,expires_at,revoked_at').eq('application_id',ids.applicationId).eq('user_id',ids.userId).maybeSingle();
 if(pe||!pkg||pkg.revoked_at||Date.parse(pkg.expires_at)<=Date.now())throw Error('package_expired');
 const {data:docs,error:de}=await db.from('application_document_package_items')
  .select('document_id,original_filename,storage_path,mime_type,size_bytes,ordinal')
  .eq('application_id',ids.applicationId).order('ordinal',{ascending:true});
 if(de)throw Error('documents_read_failed');
 const items:any[]=[];
 for(const d of docs||[]){
  const {data,error}=await db.storage.from('applicant-documents').createSignedUrl(String(d.storage_path),15*60);
  if(!error&&data?.signedUrl)items.push({name:String(d.original_filename),url:data.signedUrl,size:Number(d.size_bytes||0)});
 }
 const list=items.length
   ?items.map((x:any)=>'<li><a href="'+esc(x.url)+'" rel="noopener noreferrer">'+esc(x.name)+'</a><span>'+(x.size?' · '+Math.max(1,Math.round(x.size/1024))+' KB':'')+'</span></li>').join('')
   :'<li>Aktuell sind keine Unterlagen freigegeben.</li>';
 const html='<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Bewerbungsunterlagen</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#111}h1{font-size:24px}p{color:#555}ul{padding-left:22px}li{margin:14px 0}a{color:#0563c1;word-break:break-word}span{color:#777;font-size:14px}</style></head><body><h1>Bewerbungsunterlagen</h1><p>Die folgenden Unterlagen wurden für diese Wohnungsbewerbung freigegeben. Downloadlinks sind jeweils 15 Minuten gültig.</p><ul>'+list+'</ul></body></html>';
 return new Response(html,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store, max-age=0','x-robots-tag':'noindex, nofollow','referrer-policy':'no-referrer'}});
}
Deno.serve(async request=>{
 try{
  if(request.method==='GET')return await packagePage(request);
  if(request.method!=='POST')return new Response('method not allowed',{status:405});
  if(request.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
  const b=await request.json().catch(()=>({}));
  if(b.action==='health')return Response.json({ok:true,mode:'private-application-package-v1',packageTtlDays:30,signedFileTtlMinutes:15});
  if(b.action!=='create')throw Error('invalid_action');
  return Response.json(await createPackage(String(b.userId||''),String(b.applicationId||'')));
 }catch(e:any){
  const m=String(e?.message||'package_failed');
  const status=['invalid_token','package_expired'].includes(m)?410:400;
  if(request.method==='GET')return new Response('Dieser Link ist nicht mehr gültig.',{status,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
  return Response.json({error:m.slice(0,120)},{status:400});
 }
});
