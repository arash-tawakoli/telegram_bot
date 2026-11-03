import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

function evaluate(path) {
 const source=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8').replace(/^import[^;]+;\\n/gm,''));
 const scope={createClient:()=>({}),Deno:{env:{get:()=>undefined},serve:()=>{}},URL,Response,TextEncoder,TextDecoder,AbortSignal,crypto};
 vm.runInNewContext(source+';globalThis.phoneValue=phoneValue',scope);
 return scope;
}

test('existing production canary normalizes valid phone numbers and omits invalid optional numbers',()=>{
 const scope=evaluate('../supabase/functions/immoscout-send-canary/index.ts');
 for(const value of ['0171 1234567','0049 171 1234567','491711234567','+49 171 1234567'])assert.equal(scope.phoneValue(value),'+491711234567');
 for(const value of ['123','abc','+1234567890123456','1711234567'])assert.equal(scope.phoneValue(value),null);
});
