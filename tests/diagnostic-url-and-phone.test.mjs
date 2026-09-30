import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
async function serveDiagnostic(slug, fetch) {
 const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/deployed-support/'+slug+'/index.ts',import.meta.url),'utf8').replace(/^import[^;]+;\n/gm,''));
 let handler;
 const scope={createClient:()=>({rpc:async()=>({data:'fixture-secret',error:null})}),Deno:{env:{get:()=>undefined},serve:fn=>{handler=fn}},URL,Response,TextEncoder,AbortSignal,fetch};
 vm.runInNewContext(source,scope);
 return handler(new Request('https://fixture.test/',{method:'POST',headers:{'x-internal-secret':'fixture-secret'}}));
}
function evaluate(path) {
 const source=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8').replace(/^import[^;]+;\n/gm,''));
 const scope={createClient:()=>({}),Deno:{env:{get:()=>undefined},serve:()=>{}},URL,Response,TextEncoder,TextDecoder,AbortSignal,crypto};
 vm.runInNewContext(source,scope);
 return scope;
}
test('deployed APK diagnostic resolves relative and escaped download links',()=>{
 const scope=evaluate('../supabase/deployed-support/kleinanzeigen-apk-stage/index.ts');
 assert.equal(scope.abs('/download/?key=a&amp;b=c','https://www.apkmirror.com/apk/example/'),'https://www.apkmirror.com/download/?key=a&b=c');
 assert.equal(scope.dl('<a href="/download/?key=fixture">Download</a>','https://www.apkmirror.com/apk/example/'),'https://www.apkmirror.com/download/?key=fixture');
});
test('existing production canary normalizes valid phone numbers and omits invalid optional numbers',()=>{
 const scope=evaluate('../supabase/functions/immoscout-send-canary/index.ts');
 for (const value of ['0171 1234567','0049 171 1234567','491711234567','+49 171 1234567']) assert.equal(scope.phoneValue(value),'+491711234567');
 for (const value of ['123','abc','+1234567890123456','1711234567']) assert.equal(scope.phoneValue(value),null);
});
test('static analysis preserves absolute script URLs',async()=>{
 const result=await serveDiagnostic('kleinanzeigen-static-analysis',async()=>{
  const r=new Response('<script src="/assets/fixture.js"></script>');
  Object.defineProperty(r,'url',{value:'https://www.kleinanzeigen.de/fixture'});
  return r;
 });
 assert.equal(result.status,200);
 assert.deepEqual((await result.json()).scripts,['https://www.kleinanzeigen.de/assets/fixture.js']);
});
test('direct APK staging reports the binary source host after upload',async()=>{
 let calls=0;
 const result=await serveDiagnostic('kleinanzeigen-apk-direct-stage',async()=>{
  if(calls++===0){const r=new Response(new Uint8Array([1,2]),{headers:{'content-type':'application/octet-stream'}});Object.defineProperty(r,'url',{value:'https://downloadr1.apkmirror.com/fixture.apk'});return r;}
  return new Response(null,{status:201});
 });
 assert.equal(result.status,200);
 assert.equal((await result.json()).sourceUrlHost,'downloadr1.apkmirror.com');
 assert.equal(calls,3);
});
