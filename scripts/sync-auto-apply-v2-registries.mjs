import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const hash=text=>createHash('sha256').update(text).digest('hex');
const runtimePath='supabase/runtime-manifest.json';
const registryPath='docs/migration-registry.json';
const runtime=JSON.parse(await readFile(runtimePath,'utf8'));
const worker=runtime.functions.find(fn=>fn.slug==='application-worker');
if(!worker)throw new Error('application-worker missing from runtime manifest');
const workerFiles=[
 'supabase/functions/application-worker/index.ts',
 'supabase/functions/application-worker/credentials.ts',
 'supabase/functions/application-worker/profile-page.ts',
 'supabase/functions/application-worker/providers/kleinanzeigen.ts',
 'supabase/functions/application-worker/providers/immoscout.ts',
 'supabase/functions/application-worker/providers/immomio.ts',
 'supabase/functions/application-worker/providers/router.ts',
];
worker.files=[];
for(const path of workerFiles){const text=await readFile(path,'utf8');const sha256=hash(text);worker.files.push({path,sha256,deployed_sha256:sha256});}
worker.entrypoint=workerFiles[0];
worker.version=39;
worker.verify_jwt=false;
worker.import_map=false;
runtime.observed_at='2026-09-15';
await writeFile(runtimePath,JSON.stringify(runtime,null,2)+'\n');

const registry=JSON.parse(await readFile(registryPath,'utf8'));
const additions=[
 ['20260915074142','auto_apply_v2_foundation','955d344f669a42e1828db90e24f120933cf65fa74baaa8e49294f424a0970c6e'],
 ['20260915074154','auto_apply_queue_controls','13549bcfff00f297780ddc40b6d6fc59093f6fc9162a13a7e08f67b34c19c9ce'],
];
for(const [version,name,registrySql] of additions){
 if(registry.migrations.some(m=>m.version===version))continue;
 const file=`supabase/migrations/${version}_${name}.sql`;
 const exportSql=hash(await readFile(file));
 registry.migrations.push({version,name,file,registry_sql_sha256:registrySql,export_sql_sha256:exportSql,vault_substitution:registrySql!==exportSql});
}
registry.migrations.sort((a,b)=>a.version.localeCompare(b.version));
await writeFile(registryPath,JSON.stringify(registry,null,2)+'\n');
console.log('Auto-Apply v2 runtime and migration registries synchronized.');
