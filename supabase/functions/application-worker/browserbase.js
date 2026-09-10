const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const platformSources = {1:{name:'ImmoScout24',home:'https://www.immobilienscout24.de/',login:'https://www.immobilienscout24.de/geschlossenerbereich/start.html'},2:{name:'Kleinanzeigen',home:'https://www.kleinanzeigen.de/',login:'https://www.kleinanzeigen.de/m-einloggen.html'}};
export function identifier(value){if(!ID.test(value||''))throw Error('invalid_identifier');return value;}
export function browserUrl(value,websocket=false){
 const u=new URL(value);
 if(u.protocol!==(websocket?'wss:':'https:') || u.username || u.password || u.port
  || !(u.hostname==='browserbase.com'||u.hostname.endsWith('.browserbase.com')))throw Error('invalid_browser_url');
 return u.href;
}
export function browserbase(secret,request=fetch){
 async function call(path,method='GET',body){
  const key=await secret('browserbase_api_key');
  let response;try {response=await request('https://api.browserbase.com/v1/'+path,{method,headers:{'X-BB-API-Key':key,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw Error('browser_network_error');}
  if(method==='DELETE'&&response.status===404)return null;
  if(!response.ok)throw Object.assign(Error(response.status===429?'browser_capacity_exceeded':response.status>=500?'browser_temporary_error':response.status===401?'browser_auth_rejected':response.status===403?'browser_access_rejected':'browser_request_rejected'),{status:response.status});
  if(response.status===204)return null;
  return response.json();
 }
 return {
  project:async()=>call('projects/'+identifier(await secret('browserbase_project_id'))),
  context:async name=>call('contexts','POST',{projectId:identifier(await secret('browserbase_project_id')),name}),
  start:async contextId=>call('sessions','POST',{projectId:identifier(await secret('browserbase_project_id')),timeout:120,region:'eu-central-1',
   browserSettings:{context:{id:identifier(contextId),persist:true},recordSession:false,logSession:false,solveCaptchas:false,advancedStealth:false,ignoreCertificateErrors:false}}),
  live:async id=>{const data=await call('sessions/'+identifier(id)+'/debug');return browserUrl(data.debuggerFullscreenUrl);},
  session:async id=>call('sessions/'+identifier(id)),
  stop:async id=>{
   const path='sessions/'+identifier(id);
   try{return await call(path,'POST',{status:'REQUEST_RELEASE'});}catch(error){
    if(error.status===400){const current=await call(path);if(['COMPLETED','TIMED_OUT','ERROR'].includes(current.status))return null;}
    throw error;
   }
  },
  remove:async id=>call('contexts/'+identifier(id),'DELETE'),
 };
}
