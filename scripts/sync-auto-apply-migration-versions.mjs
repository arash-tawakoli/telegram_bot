import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const path='docs/migration-registry.json';
const registry=JSON.parse(await readFile(path,'utf8'));
const replacements=[
 {version:'20260915074142',name:'auto_apply_v2_foundation',file:'supabase/migrations/20260915074142_auto_apply_v2_foundation.sql'},
 {version:'20260915074154',name:'auto_apply_queue_controls',file:'supabase/migrations/20260915074154_auto_apply_queue_controls.sql'}
];
const names=new Set(replacements.map(x=>x.name));
registry.migrations=registry.migrations.filter(item=>!names.has(item.name));
for(const item of replacements){
 const sql=await readFile(item.file,'utf8');
 const hash=createHash('sha256').update(sql).digest('hex');
 registry.migrations.push({...item,registry_sql_sha256:hash,export_sql_sha256:hash,vault_substitution:false});
}
registry.migrations.sort((a,b)=>String(a.version).localeCompare(String(b.version)));
await writeFile(path,JSON.stringify(registry,null,2)+'\n');
