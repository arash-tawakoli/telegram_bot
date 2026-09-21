
import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const base=Deno.env.get('SUPABASE_URL')!;
async function secret(n:string){const{data,error}=await db.rpc('get_bot_secret',{secret_name:n});if(error||!data)throw Error('configuration');return String(data)}
function testPdf(){return new Blob(['%PDF-1.4\n1 0 obj<<>>endobj\n% TECHNISCHER PACKAGE TRANSFER TEST\n%%EOF\n'],{type:'application/pdf'})}
Deno.serve(async req=>{let path='',docId='';const uid='7cd8650c-5082-4638-98f1-b3e928c57429',appId='6f20673d-da10-4caa-abd3-7502e7a9024e';try{
 if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
 const name='TECHNISCHER-PACKAGE-TEST.pdf';path=uid+'/__package_probe_'+crypto.randomUUID()+'.pdf';const blob=testPdf();
 const up=await db.storage.from('applicant-documents').upload(path,blob,{contentType:'application/pdf',upsert:false});if(up.error)throw Error('upload_failed');
 const ins=await db.from('applicant_documents').insert({user_id:uid,document_type:'other',original_filename:name,storage_path:path,mime_type:'application/pdf',size_bytes:blob.size,send_with_auto_apply:true}).select('id').single();if(ins.error||!ins.data)throw Error('row_failed');docId=String(ins.data.id);
 const internal=await secret('internal_worker_secret'),cr=await fetch(base+'/functions/v1/application-package',{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},body:JSON.stringify({action:'create',userId:uid,applicationId:appId}),signal:AbortSignal.timeout(15000)}),cj=await cr.json().catch(()=>null);
 if(!cr.ok||!cj?.url)throw Error('package_create_failed');
 const {count:snapshotCount}=await db.from('application_document_package_items').select('document_id',{count:'exact',head:true}).eq('application_id',appId);
 await db.from('applicant_documents').update({send_with_auto_apply:false,updated_at:new Date().toISOString()}).eq('id',docId);
 const page=await fetch(String(cj.url),{signal:AbortSignal.timeout(15000)}),html=await page.text();
 const filenameVisible=html.includes(name),snapshotStable=filenameVisible&&snapshotCount===1;
 const ok=page.ok&&filenameVisible&&snapshotStable&&html.includes('Bewerbungsunterlagen');
 return Response.json({ok,packageStatus:page.status,filenameVisible,documentCount:cj.count||null,snapshotCount,snapshotStable});
 }catch(e:any){return Response.json({ok:false,error:String(e?.message||e)},{status:500})}
 finally{
  if(docId)await db.from('applicant_documents').delete().eq('id',docId);
  if(path)await db.storage.from('applicant-documents').remove([path]);
  await db.from('application_document_packages').delete().eq('application_id',appId).eq('user_id',uid);
 }
});