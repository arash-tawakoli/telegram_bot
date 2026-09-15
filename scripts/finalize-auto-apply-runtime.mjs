import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const path='supabase/runtime-manifest.json';
const runtime=JSON.parse(await readFile(path,'utf8'));
const hash=content=>createHash('sha256').update(content).digest('hex');
async function setBundle(slug,version,paths){
 const fn=runtime.functions.find(item=>item.slug===slug);if(!fn)throw new Error(`Missing ${slug}`);
 fn.version=version;
 fn.files=[];
 for(const filePath of paths){const content=await readFile(filePath,'utf8');const sha=hash(content);fn.files.push({path:filePath,sha256:sha,deployed_sha256:sha});}
}
await setBundle('application-worker',38,[
 'supabase/functions/application-worker/index.ts',
 'supabase/functions/application-worker/credentials.ts',
 'supabase/functions/application-worker/profile-page.ts',
 'supabase/functions/application-worker/providers/kleinanzeigen.ts',
 'supabase/functions/application-worker/providers/immomio.ts',
 'supabase/functions/application-worker/providers/immoscout.ts',
 'supabase/functions/application-worker/providers/router.ts'
]);
await setBundle('telegram-gateway',29,[
 'supabase/functions/telegram-gateway/index.ts',
 'supabase/functions/telegram-gateway/auto-apply.ts'
]);
runtime.observed_at='2026-09-15';
await writeFile(path,JSON.stringify(runtime,null,2)+'\n');
