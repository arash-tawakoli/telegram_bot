import {readFile} from 'node:fs/promises';

export function compareLiveRuntime(liveFunctions,manifest){
 const expected=new Map();
 for(const fn of manifest.functions||[]){
  expected.set(fn.slug,{version:Number(fn.observed_live_version??fn.version),verify_jwt:Boolean(fn.observed_live_verify_jwt??fn.verify_jwt)});
 }
 for(const fn of manifest.archived_functions||[]){
  if(expected.has(fn.slug))throw new Error('Duplicate manifest function: '+fn.slug);
  expected.set(fn.slug,{version:Number(fn.version),verify_jwt:Boolean(fn.verify_jwt)});
 }
 const actual=new Map((liveFunctions||[]).map(fn=>[fn.slug||fn.name,{version:Number(fn.version),verify_jwt:Boolean(fn.verify_jwt)}]));
 const missing=[...expected.keys()].filter(slug=>!actual.has(slug));
 const extra=[...actual.keys()].filter(slug=>!expected.has(slug));
 const mismatched=[];
 for(const [slug,want] of expected){
  const got=actual.get(slug);
  if(got&&(got.version!==want.version||got.verify_jwt!==want.verify_jwt))mismatched.push({slug,expected:want,actual:got});
 }
 if(missing.length||extra.length||mismatched.length){
  throw new Error('Live runtime drift: missing='+missing.join(',')+' extra='+extra.join(',')+' mismatched='+mismatched.map(x=>x.slug).join(','));
 }
 return {expected:expected.size,actual:actual.size,matched:actual.size};
}

async function main(){
 const token=process.env.SUPABASE_ACCESS_TOKEN;
 if(!token){
  const message='SUPABASE_ACCESS_TOKEN is required for live Supabase runtime verification; configure the GitHub Actions secret.';
  if(process.env.RUNTIME_LIVE_REQUIRED==='1')throw new Error(message);
  console.warn('::warning::Live Supabase runtime comparison skipped: configure the SUPABASE_ACCESS_TOKEN GitHub Actions secret.');
  return;
 }
 const manifest=JSON.parse(await readFile('supabase/runtime-manifest.json','utf8'));
 const project=process.env.SUPABASE_PROJECT_REF||manifest.project_id;
 const response=await fetch('https://api.supabase.com/v1/projects/'+encodeURIComponent(project)+'/functions',{
  headers:{Authorization:'Bearer '+token,Accept:'application/json'}
 });
 if(!response.ok)throw new Error('Supabase Management API returned HTTP '+response.status);
 const body=await response.json();
 const live=Array.isArray(body)?body:(Array.isArray(body.functions)?body.functions:null);
 if(!live)throw new Error('Unexpected Supabase functions inventory response');
 const result=compareLiveRuntime(live,manifest);
 console.log('Live Supabase runtime matched '+result.matched+' functions.');
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])await main();
