import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchProvider} from '../supabase/functions/source-worker/provider-fetch.ts';
const project='https://project.supabase.co';
async function mocked(fetcher, run) {
 const original=globalThis.fetch;
 globalThis.fetch=fetcher;
 try {await run();} finally {globalThis.fetch=original;}
}
await test('foreign origins, unknown functions and POST requests preserve native fetch',async()=>{
 const calls=[];await mocked(async(...args)=>{calls.push(args);return new Response('native');},async()=>{
  const init={method:'GET',headers:{accept:'test'}};
  for(const url of ['https://other.example/functions/v1/meravis-feed',project+'/functions/v1/unknown'])assert.equal(await (await fetchProvider(url,init,project)).text(),'native');
  await fetchProvider(project+'/functions/v1/meravis-feed',{method:'POST'},project);
  assert.equal(calls.length,3);assert.equal(calls[0][1],init);
 });
});
await test('configured provider runs directly and only calls the actual provider',async()=>{
 const urls=[];await mocked(async url=>{urls.push(String(url));return new Response('<html>No current listings</html>');},async()=>{
  const response=await fetchProvider(project+'/functions/v1/meravis-feed',{},project);
  assert.equal(response.status,200);assert.deepEqual((await response.json()).entries,[]);
  assert.equal(urls.length,1);assert.equal(new URL(urls[0]).hostname,'www.meravis.de');
 });
});
await test('nested noncoop feed keeps query parameters without an Edge HTTP hop',async()=>{
 const urls=[];await mocked(async url=>{urls.push(String(url));return new Response('<html>No current listings</html>');},async()=>{
  const response=await fetchProvider(project+'/functions/v1/noncoop-new-feed?source_id=12&floor=999999&lane=primary',{},project);
  assert.equal(response.status,200);assert.deepEqual((await response.json()).entries,[]);
  assert.equal(urls.length,4);assert.ok(urls.every(u=>new URL(u).hostname==='www.ohne-makler.net'));
  assert.deepEqual(urls.map(u=>new URL(u).searchParams.get('page')).sort(),['1','2','3','4']);
 });
});
await test('caller cancellation reaches provider requests and cannot become successful empty inventory',async()=>{
 const controller=new AbortController();let signal;
 await mocked(async(_url,init)=>{
  signal=init.signal;controller.abort(new Error('test deadline'));
  throw signal.reason;
 },async()=>{
  await assert.rejects(fetchProvider(project+'/functions/v1/meravis-feed',{signal:controller.signal},project),/test deadline/);
  assert.equal(signal.aborted,true);
 });
});
await test('meravis preserves absolute listing and image URLs',async()=>{
 const listing='https://www.meravis.de/mieten/wohnungssuche/?apartmentRent%5D=123';
 const photo='https://www.meravis.de/images/wohnung.jpg';
 const html=`<div class="immo-list-teaser"><a href="${listing}"><span class="h3">Wohnung</span><div class="immo-list-teaser-text"><p>Teststraße 1, 20095 Hamburg</p></div><span class="immo-info">1.000,00 € Gesamtmiete 60 m² Wohnfläche 2 Zimmer</span></span><img src="${photo}"></a>`;
 await mocked(async()=>{
  const response=new Response(html);Object.defineProperty(response,'url',{value:'https://www.meravis.de/mieten/wohnungssuche/'});return response;
 },async()=>{
  const result=await (await fetchProvider(project+'/functions/v1/meravis-feed',{},project)).json();
  assert.equal(result.entries.length,1);assert.equal(result.entries[0].url,listing);
  assert.equal(result.entries[0].imageUrl,photo);assert.equal(result.entries[0].warmRent,1000);
 });
});
