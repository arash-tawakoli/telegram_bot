import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const facade=readFileSync(new URL('../supabase/functions/auth-facade-broker/index.ts',import.meta.url),'utf8');
const immomio=readFileSync(new URL('../supabase/functions/immomio-auth-bridge/index.ts',import.meta.url),'utf8');

test('embedded auth edge functions parse as TypeScript',()=>{
 assert.doesNotThrow(()=>stripTypeScriptTypes(facade));
 assert.doesNotThrow(()=>stripTypeScriptTypes(immomio));
});

test('Immomio resolves to the Traumwohnung credential form',()=>{
 assert.ok(facade.includes("provider==='immoscout'||provider==='immomio'"));
 assert.ok(facade.includes("mode:'credentials'"));
 assert.ok(facade.includes("provider==='immomio')return internalCall(IMMOMIO_AUTH,{action:'password_login'"));
});

test('Immomio direct login is one-time and stores tokens, not the password',()=>{
 assert.ok(immomio.includes("grant_type:'password'"));
 assert.ok(immomio.includes("scope:'openid profile email offline_access'"));
 assert.ok(immomio.includes("access_token:String(token.access_token),refresh_token:String(token.refresh_token)"));
 assert.ok(immomio.includes("passwordStored:false"));
 assert.ok(immomio.includes(".update({consumed_at:now})"));
 assert.ok(!immomio.includes('passwordStored:true'));
});

test('starting an Immomio relogin does not downgrade an existing connected session',()=>{
 assert.ok(immomio.includes("if(existing?.status==='connected')"));
 assert.ok(immomio.includes("update({account_hint:email,last_error:null,updated_at:now})"));
});

test('Kleinanzeigen stays fail-closed when embedded authorization is unavailable',()=>{
 assert.ok(facade.includes("reason:'provider_embedded_auth_not_authorized'"));
 assert.ok(facade.includes("if(provider==='kleinanzeigen')throw Error('provider_web_required')"));
});
