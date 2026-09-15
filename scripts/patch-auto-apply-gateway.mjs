import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const path='supabase/functions/telegram-gateway/index.ts';
let source=await readFile(path,'utf8');
const importLine='import { handleAutoApplyCallback, isAutoApplyCallback } from "./auto-apply.ts";\n';
if(!source.includes(importLine))source=source.replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";\n','import "jsr:@supabase/functions-js/edge-runtime.d.ts";\n'+importLine);
const oldBlock=`    if (update?.callback_query?.id) {\n      EdgeRuntime.waitUntil(\n        forwardToCore(body, expected, true)\n          .then((response) => { if (!response.ok) console.error("telegram_callback_core", response.status); })\n          .catch((error) => console.error("telegram_callback_core", String(error)))\n      );\n      return direct("answerCallbackQuery", { callback_query_id: String(update.callback_query.id) });\n    }`;
const newBlock=`    if (update?.callback_query?.id) {\n      const callbackData = String(update.callback_query?.data || "");\n      if (isAutoApplyCallback(callbackData)) {\n        EdgeRuntime.waitUntil(\n          handleAutoApplyCallback(update)\n            .catch((error) => console.error("telegram_auto_apply", String(error)))\n        );\n      } else {\n        EdgeRuntime.waitUntil(\n          forwardToCore(body, expected, true)\n            .then((response) => { if (!response.ok) console.error("telegram_callback_core", response.status); })\n            .catch((error) => console.error("telegram_callback_core", String(error)))\n        );\n      }\n      return direct("answerCallbackQuery", { callback_query_id: String(update.callback_query.id) });\n    }`;
if(!source.includes(oldBlock)&&!source.includes(newBlock))throw new Error('gateway callback block not found');
source=source.replace(oldBlock,newBlock);
await writeFile(path,source);

const manifestPath='supabase/runtime-manifest.json';
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const fn=manifest.functions.find(item=>item.slug==='telegram-gateway');
if(!fn)throw new Error('telegram-gateway missing from runtime manifest');
const prior=new Map(fn.files.map(file=>[file.path,file]));
const filePaths=['supabase/functions/telegram-gateway/index.ts','supabase/functions/telegram-gateway/auto-apply.ts'];
fn.files=[];
for(const filePath of filePaths){
  const content=await readFile(filePath,'utf8');
  const hash=createHash('sha256').update(content).digest('hex');
  fn.files.push({path:filePath,sha256:hash,deployed_sha256:prior.get(filePath)?.deployed_sha256??'pending'});
}
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
