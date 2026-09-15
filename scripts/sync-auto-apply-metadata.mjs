import {readFile,readdir,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const read=path=>readFile(path,'utf8');

async function exists(path){try{return (await stat(path)).isFile();}catch{return false;}}

async function dependencyClosure(entrypoint){
  const seen=new Set(),queue=[entrypoint];
  while(queue.length){
    const path=queue.shift();
    if(seen.has(path))continue;
    seen.add(path);
    const text=await read(path);
    for(const match of text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+)["']/g)){
      const dependency=posix.normalize(posix.join(posix.dirname(path),match[1]));
      if(await exists(dependency))queue.push(dependency);
    }
  }
  return [...seen];
}

async function syncRuntime(){
  const path='supabase/runtime-manifest.json';
  const runtime=JSON.parse(await read(path));
  for(const slug of ['application-worker','telegram-ui']){
    const fn=runtime.functions.find(item=>item.slug===slug);
    if(!fn)throw new Error(`Missing runtime function ${slug}`);
    const prior=new Map(fn.files.map(file=>[file.path,file]));
    const closure=await dependencyClosure(fn.entrypoint);
    const keep=new Set([...closure,...fn.files.map(file=>file.path)]);
    const files=[];
    for(const filePath of [...keep].sort((a,b)=>a===fn.entrypoint?-1:b===fn.entrypoint?1:a.localeCompare(b))){
      if(!await exists(filePath))continue;
      const hash=sha256(await read(filePath)),old=prior.get(filePath);
      files.push({path:filePath,sha256:hash,deployed_sha256:old?.deployed_sha256??'pending'});
    }
    fn.files=files;
  }
  await writeFile(path,JSON.stringify(runtime,null,2)+'\n');
}

async function syncMigrations(){
  const path='docs/migration-registry.json';
  const registry=JSON.parse(await read(path));
  const known=new Set(registry.migrations.map(item=>item.file));
  const names=(await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
  for(const filename of names){
    const file=`supabase/migrations/${filename}`;
    if(known.has(file))continue;
    const match=filename.match(/^(\d{14})_(.+)\.sql$/);
    if(!match)throw new Error(`Unexpected migration filename: ${filename}`);
    const hash=sha256(await read(file));
    registry.migrations.push({version:match[1],name:match[2],file,registry_sql_sha256:hash,export_sql_sha256:hash,vault_substitution:false});
  }
  registry.migrations.sort((a,b)=>a.version.localeCompare(b.version));
  await writeFile(path,JSON.stringify(registry,null,2)+'\n');
}

await syncRuntime();
await syncMigrations();
