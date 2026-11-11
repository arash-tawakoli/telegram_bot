import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {fetchListingPage} from '../supabase/functions/kleinanzeigen-transport/fetch-page.ts';
async function mocked(fn,run){const old=globalThis.fetch;globalThis.fetch=fn;try{await run();}finally{globalThis.fetch=old;}}
const url='https://www.kleinanzeigen.de/s-wohnung-mieten/hamburg/anzeige:angebote/c203l9409?sortingField=SORTING_DATE';
await test('Kleinanzeigen rejects targets outside the permitted HTTPS listing path',async()=>{
 await mocked(()=>{throw Error('unexpected request');},async()=>{
  for(const target of ['http://www.kleinanzeigen.de/s-wohnung-mieten/x','https://other.example/s-wohnung-mieten/x','https://www.kleinanzeigen.de/account','https://user:pass@www.kleinanzeigen.de/s-wohnung-mieten/x','https://www.kleinanzeigen.de:8443/s-wohnung-mieten/x'])assert.equal((await fetchListingPage(target)).status,400);
 });
});
await test('direct page fetch keeps upstream status/body and never forwards an internal secret',async()=>{
 const calls=[];await mocked(async(...args)=>{calls.push(args);const r=new Response('upstream denied',{status:403});Object.defineProperty(r,'url',{value:url});return r;},async()=>{
  const r=await fetchListingPage(url);assert.equal(r.status,200);assert.equal(r.headers.get('x-upstream-status'),'403');assert.equal(await r.text(),'upstream denied');
  assert.equal(calls.length,1);assert.equal(calls[0][0],url);assert.equal(calls[0][1].headers['x-internal-secret'],undefined);assert.equal(calls[0][1].redirect,'follow');
 });
});
await test('caller cancellation is propagated and becomes a transport failure',async()=>{
 const c=new AbortController();await mocked(async(_url,init)=>{c.abort(Error('deadline'));assert.equal(init.signal.aborted,true);throw init.signal.reason;},async()=>{
  const r=await fetchListingPage(url,c.signal);assert.equal(r.status,502);assert.match(await r.text(),/deadline/);
 });
});
await test('compatibility endpoint authenticates before calling the shared transport',async()=>{
 let handler,calls=0;
 const source=(await readFile(new URL('../supabase/functions/kleinanzeigen-transport/index.ts',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(source),{Response,Request,URL,Deno:{env:{get:()=>undefined},serve:fn=>handler=fn},createClient:()=>({rpc:async()=>({data:'fixture-secret'})}),fetchListingPage:async()=>{calls++;return new Response('ok');}});
 const r=await handler(new Request('https://project.test',{method:'POST',body:'{}'}));assert.equal(r.status,401);assert.equal(calls,0);
 const valid=await handler(new Request('https://project.test',{method:'POST',headers:{'x-internal-secret':'fixture-secret'},body:'{}'}));assert.equal(valid.status,200);assert.equal(calls,1);
});
