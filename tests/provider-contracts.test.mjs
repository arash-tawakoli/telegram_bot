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

test('Immowelt contract retains Hamburg area URLs, room sitemaps and expose GUID parsing',async()=>{
 const source=await read('supabase/functions/source-worker/generic.ts');
 assert.match(source,/const IMMOWELT_HAMBURG_AREAS/);
 assert.match(source,/https:\/\/www\.immowelt\.de\/suche\/mieten\/wohnung\/hamburg/);
 assert.match(source,/IMMOWELT_ROOM_SITEMAPS/);
 assert.match(source,/RENT_APARTMENT_ROOMS-MIN/);
 assert.ok(source.includes('immowelt\\.de%2fexpose%2f([a-f0-9-]{36})'));
 assert.match(source,/source\.id === 3/);
});

test('retired providers are absent from live source and application runtimes',async()=>{
 const [source,application,telegram,profileAdapters]=await Promise.all([
  read('supabase/functions/source-worker/index.ts'),
  read('supabase/functions/application-worker/index.ts'),
  read('supabase/functions/telegram-gateway/auto-apply.ts'),
  read('supabase/functions/_shared/application-profile-adapters.ts')
 ]);
 for(const code of [source,application,telegram,profileAdapters]){
  assert.doesNotMatch(code,/kleinanzeigen|Kleinanzeigen|wg-gesucht|WG-Gesucht|wg_gesucht/i);
 }
});
