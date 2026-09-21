
import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const db=createClient(Deno.env.get('SUPABASE_URL')!,keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const base=Deno.env.get('SUPABASE_URL')!;
async function secret(n:string){const{data,error}=await db.rpc('get_bot_secret',{secret_name:n});if(error||!data)throw Error('configuration');return String(data)}
function testPdf(){
 const enc=new TextEncoder(),parts=[
  '%PDF-1.4\n',
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
  '4 0 obj\n<< /Length 89 >>\nstream\nBT /F1 12 Tf 25 120 Td (Technischer Dokumenttransfer-Test - keine Bewerbungsunterlage) Tj ET\nendstream\nendobj\n',
  '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
 ];
 let body=parts[0],offsets=[0];
 for(let i=1;i<parts.length;i++){offsets[i]=enc.encode(body).length;body+=parts[i]}
 const xref=enc.encode(body).length;
 body+='xref\n0 6\n0000000000 65535 f \n';
 for(let i=1;i<=5;i++)body+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
 body+=`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return new Blob([enc.encode(body)],{type:'application/pdf'});
}
async function syncImmomio(uid:string){
 const internal=await secret('internal_worker_secret');
 const r=await fetch(base+'/functions/v1/immomio-account',{
  method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},
  body:JSON.stringify({action:'sync_documents',userId:uid}),signal:AbortSignal.timeout(50000)
 });
 const j=await r.json().catch(()=>null);
 if(!r.ok||j?.verified!==true)throw Error(j?.error||'immomio_sync_failed');
 return j;
}
async function cleanupTechnical(uid:string,appId:string){
 const {data:rows}=await db.from('applicant_documents').select('id,storage_path')
  .eq('user_id',uid).eq('original_filename','TECHNISCHER-PACKAGE-TEST.pdf');
 await db.from('applicant_documents').update({send_with_auto_apply:false,updated_at:new Date().toISOString()})
  .eq('user_id',uid).eq('original_filename','TECHNISCHER-PACKAGE-TEST.pdf');
 try{await syncImmomio(uid)}catch{}
 const paths=(rows||[]).map((x:any)=>String(x.storage_path||'')).filter(Boolean);
 if(paths.length)await db.storage.from('applicant-documents').remove(paths);
 await db.from('applicant_documents').delete().eq('user_id',uid).eq('original_filename','TECHNISCHER-PACKAGE-TEST.pdf');
 await db.from('application_document_transfers').delete().eq('user_id',uid).eq('provider','immomio').eq('remote_payload->>title','TECHNISCHER-PACKAGE-TEST.pdf');
 await db.from('application_document_packages').delete().eq('application_id',appId).eq('user_id',uid);
 return{documents:(rows||[]).length,paths:paths.length};
}

Deno.serve(async req=>{let path='',docId='',full=false;const uid='7cd8650c-5082-4638-98f1-b3e928c57429',appId='6f20673d-da10-4caa-abd3-7502e7a9024e';try{
 if(req.headers.get('x-internal-secret')!==await secret('internal_worker_secret'))return new Response('unauthorized',{status:401});
 const body=await req.json().catch(()=>({}));
 if(body?.action==='cleanup')return Response.json({ok:true,cleanup:await cleanupTechnical(uid,appId)});
 full=body?.action==='full';
 const name='TECHNISCHER-PACKAGE-TEST.pdf';path=uid+'/__package_probe_'+crypto.randomUUID()+'.pdf';const blob=testPdf();
 const up=await db.storage.from('applicant-documents').upload(path,blob,{contentType:'application/pdf',upsert:false});if(up.error)throw Error('upload_failed');
 const ins=await db.from('applicant_documents').insert({user_id:uid,document_type:'other',original_filename:name,storage_path:path,mime_type:'application/pdf',size_bytes:blob.size,send_with_auto_apply:true}).select('id').single();if(ins.error||!ins.data)throw Error('row_failed');docId=String(ins.data.id);
 const internal=await secret('internal_worker_secret'),cr=await fetch(base+'/functions/v1/application-package',{method:'POST',headers:{'content-type':'application/json','x-internal-secret':internal},body:JSON.stringify({action:'create',userId:uid,applicationId:appId}),signal:AbortSignal.timeout(15000)}),cj=await cr.json().catch(()=>null);
 if(!cr.ok||!cj?.url)throw Error('package_create_failed');
 const {count:snapshotCount}=await db.from('application_document_package_items').select('document_id',{count:'exact',head:true}).eq('application_id',appId);
 const immomioUpload=full?await syncImmomio(uid):null;
 await db.from('applicant_documents').update({send_with_auto_apply:false,updated_at:new Date().toISOString()}).eq('id',docId);
 const page=await fetch(String(cj.url),{signal:AbortSignal.timeout(15000)}),html=await page.text();
 const filenameVisible=html.includes(name),snapshotStable=filenameVisible&&snapshotCount===1;
 const immomioCleanup=full?await syncImmomio(uid):null;
 const ok=page.ok&&filenameVisible&&snapshotStable&&html.includes('Bewerbungsunterlagen')&&(!full||(immomioUpload?.uploaded===1&&immomioCleanup?.removed===1));
 return Response.json({ok,packageStatus:page.status,filenameVisible,documentCount:cj.count||null,snapshotCount,snapshotStable,immomio:full?{upload:immomioUpload,cleanup:immomioCleanup}:null});
 }catch(e:any){return Response.json({ok:false,error:String(e?.message||e)},{status:500})}
 finally{
  if(docId){
   try{await db.from('applicant_documents').update({send_with_auto_apply:false,updated_at:new Date().toISOString()}).eq('id',docId)}catch{}
   if(full){try{await syncImmomio(uid)}catch{}}
   try{await db.from('applicant_documents').delete().eq('id',docId)}catch{}
  }
  if(path){try{await db.storage.from('applicant-documents').remove([path])}catch{}}
  try{await db.from('application_document_packages').delete().eq('application_id',appId).eq('user_id',uid)}catch{}
 }
});