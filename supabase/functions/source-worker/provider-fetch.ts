// All retained search connectors use direct external requests. Retired in-process
// transports are intentionally absent so removed providers cannot be reached through
// source-worker dependency imports.
export async function fetchProvider(url:string,init:RequestInit,_projectUrl:string):Promise<Response>{
  return fetch(url,init);
}
