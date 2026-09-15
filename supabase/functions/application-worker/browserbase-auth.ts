const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function identifier(value:string){
 if(!ID.test(String(value||'')))throw Error('invalid_identifier');
 return String(value);
}

export function browserSocket(value:string){
 const url=new URL(value);
 if(url.protocol!=='wss:'||url.username||url.password||url.port||!(url.hostname==='browserbase.com'||url.hostname.endsWith('.browserbase.com')))throw Error('invalid_browser_url');
 return url.href;
}

function browserPage(value:string){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.port||!(url.hostname==='browserbase.com'||url.hostname.endsWith('.browserbase.com')))throw Error('invalid_browser_url');
 url.searchParams.set('navbar','false');
 return url.href;
}

export function browserbaseAuth(secret:(name:string)=>Promise<string>,request:typeof fetch=fetch){
 async function call(path:string,method='GET',body?:unknown){
  const key=await secret('browserbase_api_key');
  let response:Response;
  try{
   response=await request(`https://api.browserbase.com/v1/${path}`,{
    method,
    headers:{'X-BB-API-Key':key,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(15000),
    redirect:'error'
   });
  }catch{throw Error('browser_network_error');}
  if(!response.ok){
   const code=response.status===429?'browser_capacity_exceeded':response.status>=500?'browser_temporary_error':response.status===401?'browser_auth_rejected':response.status===403?'browser_access_rejected':'browser_request_rejected';
   throw Object.assign(Error(code),{status:response.status});
  }
  if(response.status===204)return null;
  return response.json();
 }
 return {
  start:async(userId:string)=>call('sessions','POST',{
   projectId:identifier(await secret('browserbase_project_id')),
   timeout:180,
   keepAlive:true,
   region:'eu-central-1',
   browserSettings:{
    viewport:{width:390,height:844},
    recordSession:false,
    logSession:false,
    solveCaptchas:false,
    advancedStealth:false,
    ignoreCertificateErrors:false
   },
   userMetadata:{purpose:'kleinanzeigen-login',userId:String(userId)}
  }),
  live:async(id:string)=>{
   const data:any=await call(`sessions/${identifier(id)}/debug`);
   return browserPage(String(data.debuggerFullscreenUrl));
  },
  stop:async(id:string)=>{
   try{return await call(`sessions/${identifier(id)}`,'POST',{status:'REQUEST_RELEASE'});}catch(error:any){
    if(error?.status===400)return null;
    throw error;
   }
  }
 };
}
