import { fetchListingPage } from "./fetch-page.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const KEY=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(SUPABASE_URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function secret(){const{data,error}=await db.rpc('get_bot_secret',{secret_name:'internal_worker_secret'});if(error||!data)throw new Error('internal secret unavailable');return String(data)}
Deno.serve(async req=>{try{if(req.method!=='POST')return new Response('method not allowed',{status:405});if((req.headers.get('x-internal-secret')||'')!==await secret())return new Response('unauthorized',{status:401});const body=await req.json().catch(()=>({}));return fetchListingPage(String(body?.url||''),req.signal)}catch(e){return new Response(e instanceof Error?e.message:String(e),{status:502,headers:{'cache-control':'no-store'}})}});
