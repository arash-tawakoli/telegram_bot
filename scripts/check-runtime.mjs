import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {posix,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash=s=>createHash('sha256').update(s).digest('hex');
const gitBlobHash=s=>createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');
export async function verifyRuntime(runtime,read=readFile,options={}){
 const strictHashes=options.strictHashes!==false;
 const slugs=new Set();
 let hashWarnings=0;
 const drift=message=>{
  if(strictHashes)throw new Error(message);
  hashWarnings++;
  console.warn(`::warning::${message}`);
 };
 for(const fn of runtime.functions){
  if(slugs.has(fn.slug))throw new Error(`Duplicate function: ${fn.slug}`);
  slugs.add(fn.slug);
  const paths=new Set(fn.files.map(f=>f.path));
  if(paths.size!==fn.files.length||!paths.has(fn.entrypoint))throw new Error(`Invalid bundle: ${fn.slug}`);
  for(const file of fn.files){
   if(!/^supabase\/(functions|deployed-support)\//.test(file.path)||posix.normalize(file.path)!==file.path)throw new Error(`Invalid runtime path: ${file.path}`);
   const text=String(await read(file.path));
   const sourceHash=file.git_blob_sha?gitBlobHash(text):hash(text);
   const recordedHash=file.git_blob_sha||file.sha256;
   const deployedHash=file.deployed_git_blob_sha||file.deployed_sha256;
   if(sourceHash!==recordedHash)drift(`Runtime drift: ${fn.slug}/${file.path}`);
   if(deployedHash!==recordedHash)drift(`Recorded deployment drift: ${fn.slug}/${file.path}`);
   for(const match of text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["'](https?:[^"']+)["']/g)){
    const url=new URL(match[1]);
    if([...url.searchParams.keys()].some(key=>/^(token|access_token|auth|apikey|api_key)$/i.test(key)))throw new Error(`Credential-bearing runtime import: ${fn.slug}/${file.path}`);
   }
   for(const match of text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+)["']/g)){
    const dependency=posix.normalize(posix.join(posix.dirname(file.path),match[1]));
    if(!paths.has(dependency))throw new Error(`Missing bundled dependency: ${fn.slug}/${dependency}`);
   }
  }
 }
 return {hashWarnings};
}
export async function verifyArchivedRuntime(runtime,read=readFile){
 const entries=runtime.archived_functions||[];
 const all=new Set((runtime.functions||[]).map(fn=>fn.slug));
 const archived=new Set();
 for(const fn of entries){
  if(!fn.slug||all.has(fn.slug)||archived.has(fn.slug))throw new Error('Duplicate or invalid archived function: '+fn.slug);
  archived.add(fn.slug);
  if(!fn.archive_file||!/^docs\/runtime-snapshot-[^/]+\/bundles\/batch-[0-9]{2}\.json$/.test(fn.archive_file))throw new Error('Invalid archive path: '+fn.slug);
  const archive=JSON.parse(String(await read(fn.archive_file,'utf8')));
  const bundle=(archive.functions||[]).find(item=>item.slug===fn.slug);
  if(!bundle)throw new Error('Archived bundle missing function: '+fn.slug);
  if(Number(bundle.version)!==Number(fn.version))throw new Error('Archived version drift: '+fn.slug);
  if(Boolean(bundle.verify_jwt)!==Boolean(fn.verify_jwt))throw new Error('Archived verify_jwt drift: '+fn.slug);
  if((bundle.artifact_sha256||null)!==(fn.artifact_sha256||null))throw new Error('Archived artifact hash drift: '+fn.slug);
  if(!Array.isArray(bundle.files)||bundle.files.length!==Number(fn.source_file_count)||bundle.files.length===0)throw new Error('Archived source file count drift: '+fn.slug);
  if(bundle.archive_status!=='full_source'||fn.archive_status!=='full_source')throw new Error('Archived source incomplete or redacted: '+fn.slug);
  if((bundle.security_scan_flags||[]).length)throw new Error('Archived source requires secret review: '+fn.slug);
  for(const file of bundle.files){if(typeof file.path!=='string'||!file.path||typeof file.content!=='string')throw new Error('Invalid archived source file: '+fn.slug);}
 }
 if(runtime.live_inventory){const expected=Number(runtime.live_inventory.live_function_count);if(expected!==all.size+archived.size)throw new Error('Live inventory count mismatch: expected='+expected+' manifest='+(all.size+archived.size));}
 return {archivedFunctions:entries.length,totalFunctions:all.size+archived.size};
}
async function migrationRegistryEntries(){
 const base=JSON.parse(await readFile('docs/migration-registry.json','utf8'));
 let fragments=[];
 try{
  const names=(await readdir('docs/migration-registry.d')).filter(x=>x.endsWith('.json')).sort();
  for(const name of names){
   const fragment=JSON.parse(await readFile(`docs/migration-registry.d/${name}`,'utf8'));
   if(!Array.isArray(fragment.migrations))throw new Error(`Invalid migration registry fragment: ${name}`);
   fragments.push(...fragment.migrations);
  }
 }catch(error){
  if(error?.code!=='ENOENT')throw error;
 }
 const migrations=[...base.migrations,...fragments];
 return validateMigrationEntries(migrations);
}
export function validateMigrationEntries(migrations){
 const versions=new Set(),files=new Set();
 for(const migration of migrations){
  if(!/^[0-9]{14}$/.test(migration.version))throw new Error(`Invalid migration version: ${migration.version}`);
  const expected=`supabase/migrations/${migration.version}_${migration.name}.sql`;
  if(migration.file!==expected)throw new Error(`Migration filename/version mismatch: ${migration.file}; expected ${expected}`);
  if(versions.has(migration.version))throw new Error(`Duplicate migration version: ${migration.version}`);
  if(files.has(migration.file))throw new Error(`Duplicate migration file: ${migration.file}`);
  versions.add(migration.version);files.add(migration.file);
 }
 return migrations;
}
async function main(){
 const runtime=JSON.parse(await readFile('supabase/runtime-manifest.json','utf8'));
 const strictHashes=process.env.RUNTIME_HASH_STRICT==='1';
 const {hashWarnings}=await verifyRuntime(runtime,readFile,{strictHashes});
 await verifyArchivedRuntime(runtime,readFile);
 const migrations=await migrationRegistryEntries();
 const migrationNames=(await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
 const migrationPaths=migrationNames.map(name=>`supabase/migrations/${name}`);
 const registered=new Set(migrations.map(m=>m.file));
 if(migrationPaths.length!==migrations.length){
  const missing=migrationPaths.filter(file=>!registered.has(file));
  const stale=migrations.map(m=>m.file).filter(file=>!migrationPaths.includes(file));
  for(const file of missing)console.error(`Missing migration registry entry: ${file} sha256=${hash(await readFile(file))}`);
  for(const file of stale)console.error(`Stale migration registry entry: ${file}`);
  throw new Error(`Migration registry length mismatch: files=${migrationPaths.length} registry=${migrations.length} missing=${missing.length} stale=${stale.length}`);
 }
 for(const m of migrations)if(hash(await readFile(m.file))!==m.export_sql_sha256)throw new Error(`Migration content drift: ${m.file}`);
 console.log(`${runtime.functions.length} function bundles structurally verified; ${migrations.length} migrations verified${hashWarnings?`; ${hashWarnings} recorded runtime hash drift warning(s)`:''}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
