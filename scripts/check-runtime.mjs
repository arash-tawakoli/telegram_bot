import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {posix,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function verifyRuntime(runtime,read=readFile){
 const slugs=new Set();
 for(const fn of runtime.functions){
  if(slugs.has(fn.slug))throw new Error(`Duplicate function: ${fn.slug}`);
  slugs.add(fn.slug);
  const paths=new Set(fn.files.map(f=>f.path));
  if(paths.size!==fn.files.length||!paths.has(fn.entrypoint))throw new Error(`Invalid bundle: ${fn.slug}`);
  for(const file of fn.files){
   if(!/^supabase\/(functions|deployed-support)\//.test(file.path)||posix.normalize(file.path)!==file.path)throw new Error(`Invalid runtime path: ${file.path}`);
   const text=String(await read(file.path));
   if(hash(text)!==file.sha256)throw new Error(`Runtime drift: ${fn.slug}/${file.path}`);
   if(file.deployed_sha256!==file.sha256)throw new Error(`Recorded deployment drift: ${fn.slug}/${file.path}`);
   for(const match of text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+)["']/g)){
    const dependency=posix.normalize(posix.join(posix.dirname(file.path),match[1]));
    if(!paths.has(dependency))throw new Error(`Missing bundled dependency: ${fn.slug}/${dependency}`);
   }
  }
 }
}
async function main(){
 for(const path of [
  'supabase/functions/telegram-fast/index.ts',
  'supabase/functions/telegram-ui/navigation.js',
  'supabase/functions/telegram-ui/runtime.js',
  'supabase/functions/telegram-ui/handlers.js',
 ]) console.log(`PLANNER_REMOVAL_HASH ${path} ${hash(await readFile(path))}`);
 const runtime=JSON.parse(await readFile('supabase/runtime-manifest.json','utf8'));
 await verifyRuntime(runtime);
 const registry=JSON.parse(await readFile('docs/migration-registry.json','utf8'));
 const files=await readdir('supabase/migrations');
 if(files.filter(x=>x.endsWith('.sql')).length!==registry.migrations.length)throw new Error('Migration registry length mismatch');
 for(const m of registry.migrations)if(hash(await readFile(m.file))!==m.export_sql_sha256)throw new Error(`Migration content drift: ${m.file}`);
 console.log(`${runtime.functions.length} function bundles match recorded deployments; ${registry.migrations.length} migrations verified`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
