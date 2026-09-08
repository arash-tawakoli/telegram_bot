export class TelegramFailure extends Error {
 outcomeUnknown:boolean;allowImageFallback:boolean;retryAfter:number;
 constructor(message:string,outcomeUnknown=false,allowImageFallback=false,retryAfter=0){super(message);this.outcomeUnknown=outcomeUnknown;this.allowImageFallback=allowImageFallback;this.retryAfter=retryAfter;}
}
export async function telegramRequest(url: string, init: RequestInit, request=fetch) {
 let response:Response,body:any;
 try {response=await request(url,{...init,signal:AbortSignal.timeout(20000)});body=await response.json();}
 catch {throw new TelegramFailure('Telegram transport ended without a confirmed outcome',true);}
 if(!response.ok||body?.ok!==true){
  const description=String(body?.description||`Telegram ${response.status}`);
  throw new TelegramFailure(description,false,response.status===400&&/photo|image|media|file|caption|failed to get HTTP URL content|WEBPAGE_CURL_FAILED/i.test(description),Number(body?.parameters?.retry_after||0));
 }
 return body.result;
}
