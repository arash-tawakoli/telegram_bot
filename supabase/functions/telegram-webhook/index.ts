import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

type TgUser = { id:number; is_bot?:boolean; first_name?:string; last_name?:string; username?:string; language_code?:string };
type TgChat = { id:number; type:string };
type TgMessage = { message_id:number; from?:TgUser; chat:TgChat; text?:string };
type TgUpdate = { update_id:number; message?:TgMessage };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const ADMIN_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, ADMIN_KEY, { auth: { persistSession:false, autoRefreshToken:false } });

async function secret(name:string):Promise<string> {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name:name });
  if (error || !data) throw new Error(`secret ${name} unavailable: ${error?.message || "missing"}`);
  return String(data);
}
async function telegram(method:string, body:Record<string,unknown>) {
  const token = await secret("telegram_bot_token");
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body) });
  const json = await r.json();
  if (!r.ok || !json.ok) throw new Error(`Telegram ${method}: ${JSON.stringify(json)}`);
  return json.result;
}
function commandOf(text:string) { return (text.trim().split(/\s+/)[0] || "").toLowerCase().replace(/@traumwohnunghamburgbot$/i, ""); }
function num(text:string):number|null { const n = Number(text.trim().replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; }
function yes(text:string) { return /^(ja|j|yes|y|1)$/i.test(text.trim()); }
function no(text:string) { return /^(nein|n|no|0)$/i.test(text.trim()); }
function esc(s:unknown) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
async function send(chatId:number, text:string, extra:Record<string,unknown>={}) { return telegram("sendMessage", { chat_id:chatId, text, parse_mode:"HTML", disable_web_page_preview:true, ...extra }); }
async function ensureUser(message:TgMessage) {
  const from = message.from!;
  const payload = { telegram_user_id:from.id, chat_id:message.chat.id, username:from.username || null, first_name:from.first_name || null, last_name:from.last_name || null, language_code:from.language_code || null, is_active:true, updated_at:new Date().toISOString() };
  const { data, error } = await db.from("bot_users").upsert(payload, { onConflict:"telegram_user_id" }).select("*").single();
  if (error) throw error;
  return data;
}
async function clearOnboarding(userId:string) { await db.from("bot_users").update({ onboarding_step:null, onboarding_state:{}, updated_at:new Date().toISOString() }).eq("id", userId); }
async function startSearch(user:any, chatId:number) {
  const { count } = await db.from("search_profiles").select("id", { count:"exact", head:true }).eq("user_id", user.id);
  if ((count || 0) >= 3) { await send(chatId, "Du hast bereits 3 Suchprofile. Nutze /profile oder lösche zuerst ein Profil mit /delete."); return; }
  await db.from("bot_users").update({ onboarding_step:"max_rent", onboarding_state:{}, updated_at:new Date().toISOString() }).eq("id", user.id);
  await send(chatId, "🏠 <b>Neue Wohnungssuche</b>\n\n1/5: Wie hoch darf die <b>Warmmiete maximal</b> sein?\nBeispiel: <code>1200</code>");
}
async function showProfiles(user:any, chatId:number) {
  const { data, error } = await db.from("search_profiles").select("id,name,max_warm_rent,min_rooms,min_area_sqm,districts,wbs_only,is_active,created_at").eq("user_id",user.id).order("created_at");
  if (error) throw error;
  if (!data?.length) { await send(chatId,"Noch kein Suchprofil vorhanden. Starte mit /suche."); return; }
  const blocks = data.map((p:any,i:number)=>`<b>${i+1}. ${esc(p.name)}</b> — ${p.is_active?"🟢 aktiv":"⏸ pausiert"}\nWarmmiete: bis ${p.max_warm_rent ? esc(p.max_warm_rent)+" €" : "offen"}\nZimmer: ab ${p.min_rooms ?? 0}\nFläche: ab ${p.min_area_sqm ?? 0} m²\nGebiet: ${esc((p.districts||[]).join(", "))}\nWBS: ${p.wbs_only?"nur WBS":"egal"}`);
  await send(chatId,`🔎 <b>Deine Suchprofile</b>\n\n${blocks.join("\n\n")}`);
}
async function handleOnboarding(user:any, chatId:number, text:string) {
  const step = user.onboarding_step, state = user.onboarding_state || {};
  if (!step) return false;
  if (text === "/abbrechen") { await clearOnboarding(user.id); await send(chatId,"Suche abgebrochen."); return true; }
  if (step === "max_rent") {
    const v=num(text); if (!v || v<100 || v>20000) { await send(chatId,"Bitte gib eine gültige maximale Warmmiete ein, z. B. <code>1200</code>."); return true; }
    await db.from("bot_users").update({ onboarding_step:"min_rooms", onboarding_state:{...state,max_warm_rent:v} }).eq("id",user.id); await send(chatId,"2/5: Wie viele <b>Zimmer mindestens</b>?\nBeispiel: <code>2</code> oder <code>2,5</code>"); return true;
  }
  if (step === "min_rooms") {
    const v=num(text); if (v===null || v<0 || v>20) { await send(chatId,"Bitte gib eine gültige Zimmerzahl ein, z. B. <code>2</code>."); return true; }
    await db.from("bot_users").update({ onboarding_step:"min_area", onboarding_state:{...state,min_rooms:v} }).eq("id",user.id); await send(chatId,"3/5: Wie groß soll die Wohnung <b>mindestens</b> sein (m²)?\nBeispiel: <code>50</code>. Für egal: <code>0</code>"); return true;
  }
  if (step === "min_area") {
    const v=num(text); if (v===null || v<0 || v>1000) { await send(chatId,"Bitte gib eine gültige Mindestfläche ein, z. B. <code>50</code> oder <code>0</code>."); return true; }
    await db.from("bot_users").update({ onboarding_step:"districts", onboarding_state:{...state,min_area_sqm:v} }).eq("id",user.id); await send(chatId,"4/5: Welche <b>Stadtteile</b>?\n\nMehrere mit Komma trennen, z. B. <code>Altona, Eimsbüttel, Wandsbek</code>.\nFür ganz Hamburg: <code>Ganz Hamburg</code>"); return true;
  }
  if (step === "districts") {
    const districts = /^ganz\s+hamburg$/i.test(text.trim()) ? ["Ganz Hamburg"] : text.split(",").map(x=>x.trim()).filter(Boolean).slice(0,20);
    if (!districts.length) { await send(chatId,"Bitte nenne mindestens einen Stadtteil oder <code>Ganz Hamburg</code>."); return true; }
    await db.from("bot_users").update({ onboarding_step:"wbs", onboarding_state:{...state,districts} }).eq("id",user.id); await send(chatId,"5/5: Soll ich <b>nur WBS-Wohnungen</b> berücksichtigen?\nAntworte mit <code>Ja</code> oder <code>Nein</code>."); return true;
  }
  if (step === "wbs") {
    if (!yes(text) && !no(text)) { await send(chatId,"Bitte antworte mit <code>Ja</code> oder <code>Nein</code>."); return true; }
    const finalState={...state,wbs_only:yes(text)};
    const { error } = await db.from("search_profiles").insert({ user_id:user.id, name:"Meine Suche", max_warm_rent:finalState.max_warm_rent, min_rooms:finalState.min_rooms, min_area_sqm:finalState.min_area_sqm, districts:finalState.districts, wbs_only:finalState.wbs_only, is_active:true });
    if (error) throw error;
    await clearOnboarding(user.id);
    await send(chatId,`✅ <b>Suchprofil gespeichert</b>\n\nWarmmiete: bis ${esc(finalState.max_warm_rent)} €\nZimmer: ab ${esc(finalState.min_rooms)}\nFläche: ab ${esc(finalState.min_area_sqm)} m²\nGebiet: ${esc(finalState.districts.join(", "))}\nWBS: ${finalState.wbs_only?"nur WBS":"egal"}\n\nSobald eine neue passende Wohnung gefunden wird, bekommst du sie hier.`);
    return true;
  }
  return false;
}
Deno.serve(async (req:Request) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed",{status:405});
    const expected = await secret("telegram_webhook_secret"), supplied = req.headers.get("x-telegram-bot-api-secret-token") || "";
    if (!supplied || supplied !== expected) return new Response("unauthorized",{status:401});
    const update = await req.json() as TgUpdate;
    const { error:eventError } = await db.from("bot_events").insert({ telegram_update_id:update.update_id, event_type:update.message?"message":"other", telegram_user_id:update.message?.from?.id || null, payload:update });
    if (eventError && !String(eventError.message).toLowerCase().includes("duplicate")) console.error("bot event",eventError);
    const message=update.message;
    if (!message?.from || message.chat.type !== "private" || !message.text) return Response.json({ok:true});
    const user=await ensureUser(message), chatId=message.chat.id, text=message.text.trim(), cmd=commandOf(text);
    if (cmd === "/start") { await clearOnboarding(user.id); await send(chatId,"🏠 <b>Traumwohnung Hamburg</b>\n\nIch suche automatisch auf den hinterlegten Hamburger Wohnungsquellen nach passenden neuen Inseraten.\n\n/start – Startseite\n/suche – Suchprofil erstellen\n/profile – Suchprofile anzeigen\n/pause – Suche pausieren\n/resume – Suche fortsetzen\n/delete – Suchprofile löschen\n/status – Bot-Status\n/hilfe – Hilfe"); return Response.json({ok:true}); }
    if (cmd === "/suche") { await startSearch(user,chatId); return Response.json({ok:true}); }
    if (cmd === "/profile") { await showProfiles(user,chatId); return Response.json({ok:true}); }
    if (cmd === "/pause") { await db.from("search_profiles").update({is_active:false,updated_at:new Date().toISOString()}).eq("user_id",user.id); await send(chatId,"⏸ Deine Suchprofile sind pausiert. Mit /resume aktivierst du sie wieder."); return Response.json({ok:true}); }
    if (cmd === "/resume") { await db.from("search_profiles").update({is_active:true,updated_at:new Date().toISOString()}).eq("user_id",user.id); await send(chatId,"▶️ Deine Suchprofile sind wieder aktiv."); return Response.json({ok:true}); }
    if (cmd === "/delete") { await clearOnboarding(user.id); await db.from("bot_users").update({onboarding_step:"confirm_delete",onboarding_state:{}}).eq("id",user.id); await send(chatId,"Zum Löschen <b>aller Suchprofile</b> antworte mit <code>LÖSCHEN</code>. Mit /abbrechen brichst du ab."); return Response.json({ok:true}); }
    if (cmd === "/abbrechen") { await clearOnboarding(user.id); await send(chatId,"Abgebrochen."); return Response.json({ok:true}); }
    if (cmd === "/status") { const { count:profiles }=await db.from("search_profiles").select("id",{count:"exact",head:true}).eq("user_id",user.id).eq("is_active",true); const { count:sources }=await db.from("sources").select("id",{count:"exact",head:true}).eq("enabled",true); await send(chatId,`📡 <b>Status</b>\nAktive Suchprofile: ${profiles||0}\nAktive Quellen: ${sources||0}\nSystem: online`); return Response.json({ok:true}); }
    if (cmd === "/hilfe") { await send(chatId,"Mit /suche erstellst du ein Suchprofil. Neue passende Inserate kommen automatisch per Telegram. Mit /profile siehst du deine Kriterien. Während einer Eingabe kannst du jederzeit /abbrechen verwenden."); return Response.json({ok:true}); }
    const fresh = (await db.from("bot_users").select("*").eq("id",user.id).single()).data;
    if (fresh?.onboarding_step === "confirm_delete") { if (text.toUpperCase() === "LÖSCHEN") { await db.from("search_profiles").delete().eq("user_id",user.id); await clearOnboarding(user.id); await send(chatId,"🗑 Alle Suchprofile wurden gelöscht. Mit /suche kannst du neu starten."); } else await send(chatId,"Wenn du wirklich löschen möchtest, antworte exakt mit <code>LÖSCHEN</code> oder nutze /abbrechen."); return Response.json({ok:true}); }
    if (await handleOnboarding(fresh,chatId,text)) return Response.json({ok:true});
    await send(chatId,"Ich habe das nicht zugeordnet. Nutze /suche für eine neue Suche oder /hilfe für die Befehle.");
    return Response.json({ok:true});
  } catch (e) { console.error(e); return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500}); }
});
