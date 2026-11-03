import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/platform-connect-broker-v2/index.ts',import.meta.url),'utf8').replace(/^import[^;]+;\n/gm,''));
const db={from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{email:'fixture@example.test'}})};return q}};
const scope={createClient:()=>db,Deno:{env:{get:()=>undefined},serve:()=>{}},TextEncoder,crypto,URL,Response,AbortSignal,fetch:async()=>Response.json({data:{sso:{clientId:'immomio-oidc-web',realm:'immomio'}}}),btoa};
vm.runInNewContext(source,scope);
test('remaining housing provider login links retain their state and PKCE challenge',async()=>{
  for(const make of [scope.scoutUrl,scope.immomioUrl]){const u=new URL(await make({state:'state-fixture',user_id:'u'},'challenge-fixture'));assert.equal(u.protocol,'https:');assert.equal(u.searchParams.get('state'),'state-fixture');assert.equal(u.searchParams.get('code_challenge'),'challenge-fixture');assert.equal(u.searchParams.get('code_challenge_method'),'S256');}
});
