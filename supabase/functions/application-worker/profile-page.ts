import {beginKleinanzeigenLogin,completeKleinanzeigenLogin} from './providers/kleinanzeigen.ts';

const encoder=new TextEncoder();
const decoder=new TextDecoder();
const b64url=(bytes:Uint8Array)=>{let raw='';for(const b of bytes)raw+=String.fromCharCode(b);return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const fromB64url=(value:string)=>{const s=value.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(s+'='.repeat((4-s.length%4)%4));const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;};
const esc=(v:any)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

async function hmacKey(db:any){const {data,error}=await db.rpc('get_bot_secret',{secret_name:'application_credential_key_v1'});if(error||!data)throw Error('credential_key_unavailable');const raw=Uint8Array.from(atob(String(data)),c=>c.charCodeAt(0));return crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function createProfileToken(db:any,userId:string){const payload=encoder.encode(JSON.stringify({u:userId,e:Date.now()+20*60_000})),key=await hmacKey(db),signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,payload));return `${b64url(payload)}.${b64url(signature)}`;}
export async function verifyProfileToken(db:any,token:string){try{const [p,s]=String(token||'').split('.');if(!p||!s)return null;const payload=fromB64url(p),key=await hmacKey(db),ok=await crypto.subtle.verify('HMAC',key,fromB64url(s),payload);if(!ok)return null;const parsed=JSON.parse(decoder.decode(payload));if(!parsed?.u||Number(parsed.e)<=Date.now())return null;return parsed;}catch{return null;}}
export async function profileLink(db:any,userId:string,supabaseUrl:string){const token=await createProfileToken(db,userId);return `${supabaseUrl}/functions/v1/application-worker?action=profile&token=${encodeURIComponent(token)}`;}

const css=`:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#f5f7f8}*{box-sizing:border-box}body{margin:0;padding:18px}.wrap{max-width:640px;margin:auto}.card{background:#fff;border-radius:16px;padding:18px;margin:0 0 14px;box-shadow:0 1px 8px #00000012}h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:0 0 12px}p{line-height:1.45;color:#4b5563}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.full{grid-column:1/-1}label{display:block;font-size:13px;font-weight:600;margin-bottom:4px}input,select,textarea{width:100%;font:inherit;padding:12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff}textarea{min-height:110px;resize:vertical}.btn{display:inline-block;border:0;border-radius:10px;padding:12px 14px;font:inherit;font-weight:700;background:#111;color:#fff;text-decoration:none;cursor:pointer}.secondary{background:#e5e7eb;color:#111}.ok{color:#067647;font-weight:700}.warn{color:#b54708;font-weight:700}.muted{font-size:13px;color:#667085}.stack{display:flex;gap:8px;flex-wrap:wrap}.msg{padding:10px 12px;border-radius:10px;background:#eef4ff;margin-bottom:12px}@media(max-width:520px){.grid{grid-template-columns:1fr}.full{grid-column:auto}}`;
function pageShell(body:string){return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>Auto-Bewerbung</title><style>${css}</style></head><body><main class="wrap">${body}</main></body></html>`;}
const html=(body:string,status=200)=>new Response(pageShell(body),{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; navigate-to https://login.kleinanzeigen.de https://t.me 'self'"}});

async function dataFor(db:any,userId:string){
 const [{data:profile,error:profileError},{data:connections,error:connectionError}]=await Promise.all([
  db.from('applicant_profiles').select('*').eq('user_id',userId).maybeSingle(),
  db.from('platform_connections').select('provider,status,account_hint,last_error,last_verified_at').eq('user_id',userId)
 ]);
 if(profileError||connectionError)throw Error('profile_read_failed');
 return {profile:profile||{},connections:connections||[]};
}
function connection(connections:any[],provider:string){return connections.find(c=>c.provider===provider);}
function statusLabel(row:any){if(row?.status==='connected')return '<span class="ok">● verbunden</span>';if(row?.status==='pending')return '<span class="warn">● Anmeldung offen</span>';if(row?.status==='needs_login')return '<span class="warn">● erneut anmelden</span>';return '<span class="muted">● nicht verbunden</span>';}
function render(token:string,data:any,message=''){
 const p=data.profile||{},ka=connection(data.connections,'kleinanzeigen'),scout=connection(data.connections,'immoscout');
 return html(`${message?`<div class="msg">${esc(message)}</div>`:''}<section class="card"><h1>⚡ Automatische Bewerbung</h1><p>Diese Angaben werden einmalig gespeichert. Danach füllt der Bot unterstützte Bewerbungen selbst aus und sendet sie automatisch.</p></section>
 <section class="card"><h2>👤 Bewerberprofil</h2><form method="post" action="?action=profile"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="operation" value="save_profile"><div class="grid">
 <div><label>Vorname *</label><input name="first_name" maxlength="120" required value="${esc(p.first_name)}"></div><div><label>Nachname *</label><input name="last_name" maxlength="120" required value="${esc(p.last_name)}"></div>
 <div><label>E-Mail *</label><input type="email" name="email" maxlength="320" required value="${esc(p.email)}"></div><div><label>Telefon *</label><input type="tel" name="phone" maxlength="80" required value="${esc(p.phone)}"></div>
 <div><label>Straße</label><input name="street" maxlength="160" value="${esc(p.street)}"></div><div><label>Hausnummer</label><input name="house_number" maxlength="40" value="${esc(p.house_number)}"></div>
 <div><label>PLZ</label><input name="postcode" maxlength="20" inputmode="numeric" value="${esc(p.postcode)}"></div><div><label>Ort *</label><input name="city" maxlength="120" required value="${esc(p.city||'Hamburg')}"></div>
 <div><label>Personen im Haushalt *</label><input type="number" min="1" max="20" name="household_size" required value="${esc(p.household_size)}"></div><div><label>Beschäftigung</label><input name="employment_status" maxlength="120" value="${esc(p.employment_status)}"></div>
 <div><label>Nettoeinkommen / Monat</label><input type="number" min="0" step="1" name="monthly_net_income" value="${esc(p.monthly_net_income)}"></div><div><label>Haustiere</label><input name="pets" maxlength="160" value="${esc(p.pets)}"></div>
 <div><label>WBS</label><input name="wbs_status" maxlength="120" value="${esc(p.wbs_status)}"></div><div><label>Einzug ab</label><input type="date" name="move_in_date" value="${esc(p.move_in_date)}"></div>
 <div class="full"><label>Standard-Bewerbungstext (optional)</label><textarea name="default_message" maxlength="4000" placeholder="Leer lassen = automatisch passend zur Wohnung erzeugen">${esc(p.default_message)}</textarea></div>
 </div><p><button class="btn" type="submit">Profil speichern</button></p></form></section>
 <section class="card"><h2>🔗 Plattformen</h2><p><b>Kleinanzeigen:</b> ${statusLabel(ka)} ${ka?.account_hint?`<span class="muted">(${esc(ka.account_hint)})</span>`:''}</p>
 <form method="post" action="?action=profile"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="operation" value="kleinanzeigen_begin"><button class="btn secondary" type="submit">Kleinanzeigen verbinden</button></form>
 <p><b>ImmoScout24:</b> ${statusLabel(scout)}</p><p class="muted">Der Web-Session-Sendepfad bleibt gesperrt, bis der kontrollierte Login-/Send-Test den privaten Request eindeutig bestätigt. Es wird keine offizielle ImmoScout-API vorausgesetzt.</p>
 <p><b>Immomio:</b> <span class="ok">● kein Login erforderlich</span></p></section>
 <section class="card"><a class="btn secondary" href="https://t.me/traumwohnunghamburgbot">Zurück zu Telegram</a></section>`);
}

export async function handleProfilePage(request:Request,db:any){
 const url=new URL(request.url),form=request.method==='POST'?await request.formData():null,token=String(form?.get('token')||url.searchParams.get('token')||''),auth=await verifyProfileToken(db,token);
 if(!auth)return html('<section class="card"><h1>Link abgelaufen</h1><p>Öffne „Automatische Bewerbung“ im Telegram-Bot erneut.</p></section>',401);
 const userId=String(auth.u),operation=String(form?.get('operation')||'');
 if(request.method==='POST'&&operation==='save_profile'){
  const text=(name:string,max:number)=>String(form!.get(name)||'').trim().slice(0,max),first=text('first_name',120),last=text('last_name',120),email=text('email',320),phone=text('phone',80),city=text('city',120),household=Number(form!.get('household_size'));
  if(!first||!last||!email.includes('@')||phone.length<3||!city||!Number.isInteger(household)||household<1||household>20)return render(token,await dataFor(db,userId),'Bitte prüfe die Pflichtfelder.');
  const incomeRaw=text('monthly_net_income',30),income=incomeRaw===''?null:Number(incomeRaw);if(income!==null&&(!Number.isFinite(income)||income<0))return render(token,await dataFor(db,userId),'Bitte prüfe das Nettoeinkommen.');
  const row={user_id:userId,first_name:first,last_name:last,email,phone,street:text('street',160)||null,house_number:text('house_number',40)||null,postcode:text('postcode',20)||null,city,household_size:household,employment_status:text('employment_status',120)||null,monthly_net_income:income,pets:text('pets',160)||null,wbs_status:text('wbs_status',120)||null,move_in_date:text('move_in_date',10)||null,default_message:text('default_message',4000)||null,updated_at:new Date().toISOString()};
  const {error}=await db.from('applicant_profiles').upsert(row,{onConflict:'user_id'});if(error)throw Error('profile_write_failed');
  return render(token,await dataFor(db,userId),'✅ Bewerberprofil gespeichert.');
 }
 if(request.method==='POST'&&operation==='kleinanzeigen_begin'){
  const login=await beginKleinanzeigenLogin(db,userId);
  const data=await dataFor(db,userId);
  return html(`<section class="card"><h1>Kleinanzeigen verbinden</h1><p>1. Öffne Kleinanzeigen und melde dich normal an.</p><p><a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(login.url)}">🔐 Kleinanzeigen Login öffnen</a></p><p>2. Nach dem Login landest du auf der Kleinanzeigen-Callback-Seite. Kopiere die <b>vollständige URL aus der Adresszeile</b> und füge sie hier einmal ein.</p><form method="post" action="?action=profile"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="operation" value="kleinanzeigen_complete"><label>Callback-URL</label><textarea name="callback_url" required></textarea><p><button class="btn" type="submit">Verbindung abschließen</button></p></form></section><section class="card"><a class="btn secondary" href="?action=profile&amp;token=${encodeURIComponent(token)}">Zurück</a></section>`);
 }
 if(request.method==='POST'&&operation==='kleinanzeigen_complete'){
  try{await completeKleinanzeigenLogin(db,userId,String(form!.get('callback_url')||''));return render(token,await dataFor(db,userId),'✅ Kleinanzeigen ist verbunden. Der Refresh-Token wird verschlüsselt gespeichert.');}
  catch(error){return render(token,await dataFor(db,userId),`Kleinanzeigen konnte nicht verbunden werden: ${error?.message==='platform_login_expired'?'Anmeldung abgelaufen. Bitte erneut starten.':'Callback konnte nicht bestätigt werden.'}`);}
 }
 return render(token,await dataFor(db,userId));
}
