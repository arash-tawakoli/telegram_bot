import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const URL=Deno.env.get('SUPABASE_URL')!;
const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
const SECRET=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(URL,SECRET,{auth:{persistSession:false,autoRefreshToken:false}});
const ORIGIN='https://intern.traumwohnunghamburg.de';

function headers(){return {
  'access-control-allow-origin':ORIGIN,
  'access-control-allow-methods':'POST,OPTIONS',
  'access-control-allow-headers':'content-type,apikey',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'vary':'Origin'
};}
function out(body:any,status=200){return Response.json(body,{status,headers:headers()})}
function clean(v:any,max=180){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)}
function token(v:any){const s=String(v||'');if(!/^setup_[a-f0-9]{64}$/.test(s))throw Error('bootstrap_token_invalid');return s}
function email(v:any){const s=clean(v,320).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw Error('invalid_email');return s}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers()});
  if(req.method!=='POST')return new Response('method not allowed',{status:405,headers:headers()});
  try{
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||'status');
    const t=token(body.token);

    const {data:valid,error:validError}=await db.rpc('coach_bootstrap_token_valid',{p_token:t});
    if(validError||valid!==true)return out({valid:false,error:'bootstrap_token_invalid'},410);

    if(action==='status')return out({valid:true});
    if(action!=='complete')return out({error:'invalid_action'},400);

    const name=clean(body.displayName,120);
    const mail=email(body.email);
    const password=String(body.password||'');
    if(name.length<2)return out({error:'display_name_required'},400);
    if(password.length<12)return out({error:'password_too_short'},400);

    const {data:created,error:createError}=await db.auth.admin.createUser({
      email:mail,
      password,
      email_confirm:true
    });
    if(createError||!created.user){
      const message=String(createError?.message||'');
      return out({error:/already|registered|exists/i.test(message)?'email_already_registered':'auth_user_create_failed'},400);
    }

    const {data:member,error:memberError}=await db.rpc('complete_coach_bootstrap',{
      p_token:t,
      p_auth_user:created.user.id,
      p_display_name:name
    });
    if(memberError||!member){
      await db.auth.admin.deleteUser(created.user.id).catch(()=>{});
      return out({error:'bootstrap_complete_failed'},400);
    }

    return out({ok:true});
  }catch(error:any){
    console.error('coach_bootstrap',String(error?.message||error));
    return out({error:'bootstrap_failed'},400);
  }
});
