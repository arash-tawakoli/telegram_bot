import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('ImmoScout MCP contract uses protocol version, JSON-RPC tools and bounded requests',async()=>{
 const source=await read('supabase/functions/source-worker/scout.ts');
 assert.match(source,/app\.chatgpt\.immobilienscout24\.de\/v2\/mcp/);
 assert.match(source,/PROTO='2025-06-18'/);
 assert.match(source,/method:'initialize'/);
 assert.match(source,/tools\/call/);
 assert.match(source,/property_search_de/);
 assert.match(source,/property_map_de/);
 assert.match(source,/AbortSignal\.timeout\(10000\)/);
 assert.match(source,/result\?\.isError/);
});

test('Kleinanzeigen contract checks upstream status, parser acceptance and seven Hamburg districts',async()=>{
 const source=await read('supabase/functions/source-worker/klein.ts');
 assert.match(source,/fetchListingPage\(url\(s,id,p\),AbortSignal\.timeout\(15000\)\)/);
 assert.match(source,/x-upstream-status/);
 assert.match(source,/Kleinanzeigen empty result HTML/);
 assert.match(source,/Kleinanzeigen parser accepted 0/);
 for(const district of ['hamburg-nord','hamburg-mitte','altona','eimsbuettel','wandsbek','harburg','bergedorf'])assert.ok(source.includes("['"+district+"'"),'missing district '+district);
});

test('Immowelt contract retains Hamburg area URLs, room sitemaps and expose GUID parsing',async()=>{
 const source=await read('supabase/functions/source-worker/generic.ts');
 assert.match(source,/const IMMOWELT_HAMBURG_AREAS/);
 assert.match(source,/https:\/\/www\.immowelt\.de\/suche\/mieten\/wohnung\/hamburg/);
 assert.match(source,/IMMOWELT_ROOM_SITEMAPS/);
 assert.match(source,/RENT_APARTMENT_ROOMS-MIN/);
 assert.match(source,/immowelt\.de%2fexpose%2f\(\[a-f0-9-\]\{36\}\)/);
 assert.match(source,/source\.id === 3/);
});

test('WG-Gesucht live connector is enabled and routed through generic HTML discovery',async()=>{
 const snapshot=JSON.parse(await read('docs/runtime-snapshot-2026-10-21/provider-contract-snapshot.json'));
 const wg=snapshot.providers.find(p=>p.source_id===6);
 assert.ok(wg,'WG-Gesucht source missing from live snapshot');
 assert.equal(wg.name,'WG-Gesucht Hamburg');
 assert.equal(wg.enabled,true);
 assert.equal(wg.runtime_mode,'live');
 assert.equal(wg.delivery_mode,'live');
 assert.equal(wg.connectors[0].kind,'html_discovery');
 assert.equal(wg.connectors[0].shadow_only,false);
 const entry=await read('supabase/functions/source-worker/index.ts');
 assert.match(entry,/return runGeneric\(s, connectors\)/);
});
