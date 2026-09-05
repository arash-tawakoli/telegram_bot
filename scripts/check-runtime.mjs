import {readFile,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const runtime=JSON.parse(await readFile('supabase/runtime-manifest.json','utf8'));
for(const fn of runtime.functions)for(const file of fn.files){if(hash(await readFile(file.path))!==file.sha256)throw new Error(`Runtime drift: ${fn.slug}/${file.path}`);}
const registry=JSON.parse(await readFile('docs/migration-registry.json','utf8'));
const files=await readdir('supabase/migrations');
if(files.filter(x=>x.endsWith('.sql')).length!==registry.migrations.length)throw new Error('Migration registry length mismatch');
for(const m of registry.migrations)if(hash(await readFile(m.file))!==m.export_sql_sha256)throw new Error(`Migration content drift: ${m.file}`);
console.log(`${runtime.functions.length} function snapshots and ${registry.migrations.length} migrations verified`);
