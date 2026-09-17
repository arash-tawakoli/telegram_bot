import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const facade=readFileSync(new URL('../supabase/functions/auth-facade-broker/index.ts',import.meta.url),'utf8');
const immomioIndex=readFileSync(new URL('../supabase/functions/immomio-account/index.ts',import.meta.url),'utf8');
const immomio=readFileSync(new URL('../supabase/functions/immomio-account/providers/immomio.ts',import.meta.url),'utf8');

test('embedded auth edge functions parse as TypeScript',()=>{
 assert.doesNotThrow(()=>stripTypeScriptTypes(facade));
 assert.doesNotThrow(()=>stripTypeScriptTypes(immomioIndex));
 assert.doesNotThrow(()=>stripTypeScriptTypes(immomio));
});

test('Immomio resolves to the Traumwohnung credential form',()=>{
 assert.ok(facade.includes("provider==='immoscout'||provider==='immomio'"));
 assert.ok(facade.includes("mode:'credentials'"));
 assert.ok(facade.includes("provider==='immomio')return internalCall(IMMOMIO_AUTH,{action:'password_login'"));
 assert.ok(facade.includes("functions/v1/immomio-account"));
});

test('Immomio direct login is one-time and stores tokens, not the password',()=>{
 assert.ok(immomio.includes("grant_type:'password'"));
 assert.ok(immomio.includes("scope:'openid profile email offline_access'"));
 assert.ok(immomio.includes("access_token:String(token.access_token),refresh_token:String(token.refresh_token)"));
 assert.ok(immomio.includes(".update({consumed_at:now})"));
 assert.ok(immomio.includes("authMode:'embedded_password',passwordStored:false"));
 assert.ok(immomioIndex.includes("passwordStored:false"));
 assert.ok(!immomio.includes('passwordStored:true'));
});

test('failed embedded Immomio login does not downgrade an existing connection',()=>{
 const start=immomio.indexOf('export async function completeImmomioPasswordLogin');
 const end=immomio.indexOf('async function refresh',start);
 assert.ok(start>=0&&end>start);
 const embedded=immomio.slice(start,end);
 assert.ok(!embedded.includes('markConnection('));
 assert.ok(embedded.indexOf('saveTokenSet(')>embedded.indexOf("if(!response.ok"));
});

test('Kleinanzeigen stays fail-closed when embedded authorization is unavailable',()=>{
 assert.ok(facade.includes("reason:'provider_embedded_auth_not_authorized'"));
 assert.ok(facade.includes("if(provider==='kleinanzeigen')throw Error('provider_web_required')"));
});
