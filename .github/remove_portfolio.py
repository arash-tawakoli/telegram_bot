from pathlib import Path
import json, hashlib, re

def read(path):
    return Path(path).read_text()

def write(path, text):
    Path(path).write_text(text)

def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, got {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))

for path in [
    "supabase/functions/telegram-ui/dossier.js",
    "supabase/functions/telegram-ui/dossier-rules.js",
]:
    p = Path(path)
    if not p.exists():
        raise SystemExit(f"missing {path}")
    p.unlink()

replace_once(
    "supabase/functions/telegram-ui/admin.js",
    "import { purgeApplicantDocuments } from './dossier.js';\n",
    "",
)
replace_once(
    "supabase/functions/telegram-ui/admin.js",
    "    await purgeApplicantDocuments(userId);\n",
    "",
)

replace_once(
    "supabase/functions/telegram-ui/navigation.js",
    '            [button("📂 Bewerbermappe", "dossier")],\n',
    '            [button("🔐 Plattformkonten / Auto-Bewerbung", "platforms")],\n',
)

replace_once(
    "supabase/functions/telegram-ui/handlers.js",
    "import { dossier, dossierMessage, clearDossierInput } from './dossier.js';\n",
    "",
)
replace_once(
    "supabase/functions/telegram-ui/handlers.js",
    "    if (user.onboarding_state?.dossier_input && await dossierMessage(message,user)) return;\n",
    "",
)
replace_once(
    "supabase/functions/telegram-ui/handlers.js",
    '    if (command === "/mappe") return dossier(user,message.chat);\n',
    "",
)
replace_once(
    "supabase/functions/telegram-ui/handlers.js",
    "    if (user.onboarding_state?.dossier_input) await clearDossierInput(user);\n",
    "",
)
replace_once(
    "supabase/functions/telegram-ui/handlers.js",
    "    if (data === 'dossier' || data.startsWith('dossier:')) return dossier(user,query.message.chat,query.message?.photo?undefined:messageId,data);\n",
    "",
)

path = "supabase/functions/telegram-ui/platform-sessions.js"
text = read(path)
old = "import {privateApplicant} from './dossier-rules.js';\n"
if text.count(old) != 1:
    raise SystemExit("platform-sessions import mismatch")
text = text.replace(old, "", 1)
anchor = "import {db,SUPABASE_URL,secret,send,edit,button} from './runtime.js';\n"
helper = """import {db,SUPABASE_URL,secret,send,edit,button} from './runtime.js';

const privateSessionOwner=(user,chat)=>chat?.type==='private'&&user.is_active
 && Number(chat.id)===Number(user.telegram_user_id)&&Number(chat.id)===Number(user.chat_id);
"""
if text.count(anchor) != 1:
    raise SystemExit("platform-sessions anchor mismatch")
text = text.replace(anchor, helper, 1)
text = text.replace("privateApplicant(user,chat)", "privateSessionOwner(user,chat)")
old = "[button('← Bewerbermappe','dossier')]])"
if text.count(old) != 1:
    raise SystemExit("platform-sessions back mismatch")
text = text.replace(old, "[button('← Einstellungen','settings')]])", 1)
write(path, text)

replace_once(
    "supabase/functions/telegram-ui/application.js",
    "    const message = generateApplicationMessage(user.is_premium ? {...user, ...user.applicant_profile} : user, listing);\n",
    "    const message = generateApplicationMessage(user, listing);\n",
)

path = "supabase/functions/telegram-ui/application-message.js"
text = read(path)
pattern = r"export function generateApplicationMessage\(user, listing\) \{\n.*?\n\}\n?$"
replacement = """export function generateApplicationMessage(user, listing) {
    const title = singleLine(listing.title, 50) || 'Ihre Wohnung';
    const name = singleLine([user.first_name, user.last_name].filter(Boolean).join(' '), 40) || '[Dein Name]';
    return `Guten Tag,\\n\\nich interessiere mich für „${title}“ und würde die Wohnung gerne besichtigen. Über eine Rückmeldung freue ich mich.\\n\\nFreundliche Grüße\\n${name}`;
}
"""
text2, n = re.subn(pattern, replacement, text, flags=re.S)
if n != 1:
    raise SystemExit(f"application-message function mismatch {n}")
write(path, text2)

path = "supabase/functions/application-worker/index.ts"
text = read(path)
for old in [
    "import {detectDocument,FILE_LIMIT} from '../telegram-ui/dossier-rules.js';\n",
    "import {Buffer} from 'node:buffer';\n",
]:
    if text.count(old) != 1:
        raise SystemExit(f"application-worker import mismatch: {old}")
    text = text.replace(old, "", 1)
old = """  const [{data:user,error:userError},{data:listing,error:listingError},{data:documents,error:documentError}]=await Promise.all([
   db.from('bot_users').select('id,is_active,auto_apply_enabled,applicant_profile,first_name,last_name').eq('id',application.user_id).single(),
   db.from('listings').select('id,source_id,canonical_url,title,is_active').eq('id',application.listing_id).single(),
   db.from('application_documents').select('id,mime_type,bytes,filename').eq('user_id',application.user_id).eq('ready',true).eq('share_enabled',true)]);
  if(userError||listingError||documentError)throw Error('application_read_failed');
"""
new = """  const [{data:user,error:userError},{data:listing,error:listingError}]=await Promise.all([
   db.from('bot_users').select('id,is_active,auto_apply_enabled,first_name,last_name').eq('id',application.user_id).single(),
   db.from('listings').select('id,source_id,canonical_url,title,is_active').eq('id',application.listing_id).single()]);
  if(userError||listingError)throw Error('application_read_failed');
"""
if text.count(old) != 1:
    raise SystemExit("application-worker read block mismatch")
text = text.replace(old, new, 1)
old = "  const message=generateApplicationMessage({...user,...user.applicant_profile},listing);\n"
if text.count(old) != 1:
    raise SystemExit("application-worker message mismatch")
text = text.replace(old, "  const message=generateApplicationMessage(user,listing);\n", 1)
start = text.find("  const result=await adapters[Number(listing.source_id)].applyToListing({page,user,listing,message,documents,\n")
end = text.find("  await patch({status:result.status", start)
if start < 0 or end < 0:
    raise SystemExit("application-worker adapter region missing")
replacement = """  const result=await adapters[Number(listing.source_id)].applyToListing({page,user,listing,message,
   authorize:async()=>{
    const {data,error:authorizeError}=await db.rpc('authorize_application_send',{p_id:application.id,p_token:application.lease_token});
    if(authorizeError){started=true;throw Error('authorization_unconfirmed');}
    started=data===true;return started;
   }});
"""
text = text[:start] + replacement + text[end:]
write(path, text)

path = "supabase/functions/application-worker/adapters.js"
text = read(path)
start = text.find("export function documentUploadPlan")
end = text.find("\nasync function visibleText", start)
if start < 0 or end < 0:
    raise SystemExit("adapter planning region missing")
planning = """export function submissionPlan(source,fields){
 const required=source===1?['firstName','lastName','emailAddress','street','houseNumber','postcode','city']:[];
 if(fields.some(f=>(f.required||required.includes(f.name))&&!f.value))return {error:'required_fields_missing'};
 if(fields.some(f=>f.type==='checkbox'&&f.required&&!f.checked))return {error:'platform_consent_required'};
 return {ok:true};
}
"""
text = text[:start] + planning + text[end:]
text = text.replace(
    "async function submit(source,{page,user,listing,message,documents,authorize,loadDocument}){",
    "async function submit(source,{page,listing,message,authorize}){",
)
start = text.find(" const fileInput=await page.$eval(selector,textarea=>{")
end = text.find(" // This is the first operation that may disclose applicant data to the platform.", start)
if start < 0 or end < 0:
    raise SystemExit("adapter file planning block missing")
text = text[:start] + " const plan=submissionPlan(source,fields);\n if(plan.error)return manual(plan.error);\n" + text[end:]
start = text.find(" if(documents.length){")
end = text.find(" const textarea=await page.$(selector);", start)
if start < 0 or end < 0:
    raise SystemExit("adapter disclosure block missing")
text = text[:start] + text[end:]
write(path, text)

for path in [
    "supabase/functions/telegram-fast/index.ts",
    "supabase/functions/telegram-gateway/index.ts",
]:
    text = read(path)
    old = '[button("📂 Bewerbermappe", "dossier")],'
    if text.count(old) != 1:
        raise SystemExit(f"{path}: settings button mismatch {text.count(old)}")
    text = text.replace(old, '[button("🔐 Plattformkonten / Auto-Bewerbung", "platforms")],', 1)
    text = text.replace(" || user.onboarding_state?.dossier_input", "")
    if "dossier_input" in text:
        raise SystemExit(f"{path}: transient state still present")
    write(path, text)

path = "supabase/migrations/20260909223100_premium_applications.sql"
text = read(path)
marker = "create table public.applications ("
idx = text.find(marker)
if idx < 0:
    raise SystemExit("premium applications marker missing")
text = """-- Backend-only automatic application tables.
alter table public.bot_users
  add column auto_apply_enabled boolean not null default false;

""" + text[idx:]
write(path, text)

replace_once(
    "tests/application-worker.test.mjs",
    "   single:async()=>({data:table==='bot_users'?{id:'u',auto_apply_enabled:true,applicant_profile:{}}:{id:'l',source_id:1,is_active:true,title:'Wohnung'}}),\n",
    "   single:async()=>({data:table==='bot_users'?{id:'u',auto_apply_enabled:true,first_name:'Test',last_name:'User'}:{id:'l',source_id:1,is_active:true,title:'Wohnung'}}),\n",
)
replace_once(
    "tests/application-worker.test.mjs",
    "  puppeteer:{connect:async()=>browser},browserUrl:x=>x,identifier:x=>x,generateApplicationMessage:()=> 'Bewerbung',detectDocument:()=> 'application/pdf',FILE_LIMIT:5*1024*1024,Buffer,\n",
    "  puppeteer:{connect:async()=>browser},browserUrl:x=>x,identifier:x=>x,generateApplicationMessage:()=> 'Bewerbung',\n",
)
replace_once(
    "tests/telegram-callback-latency.test.mjs",
    "  const response=await Promise.race([handler(request('dossier')),timeout(80)]);\n",
    "  const response=await Promise.race([handler(request('platforms')),timeout(80)]);\n",
)

manifest_path = Path("supabase/runtime-manifest.json")
manifest = json.loads(manifest_path.read_text())
changed = {"application-worker","telegram-ui","telegram-fast","telegram-gateway"}
for fn in manifest["functions"]:
    fn["files"] = [f for f in fn["files"] if Path(f["path"]).exists()]
    if fn["slug"] in changed:
        for f in fn["files"]:
            data = Path(f["path"]).read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            f["sha256"] = digest
            f["deployed_sha256"] = digest
manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

registry_path = Path("docs/migration-registry.json")
registry = json.loads(registry_path.read_text())
target = "supabase/migrations/20260909223100_premium_applications.sql"
digest = hashlib.sha256(Path(target).read_bytes()).hexdigest()
found = False
for item in registry["migrations"]:
    if item.get("file") == target:
        item["export_sql_sha256"] = digest
        found = True
if not found:
    raise SystemExit("migration registry entry missing")
registry_path.write_text(json.dumps(registry, indent=2, ensure_ascii=False) + "\n")
