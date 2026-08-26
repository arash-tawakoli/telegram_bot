import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { LANGS, textFor } from "./i18n.ts";

type TgUser = { id:number; first_name?:string; last_name?:string; username?:string; language_code?:string };
type TgMessage = { message_id:number; from?:TgUser; chat:{ id:number; type:string }; text?:string };
type TgCallback = { id:string; from:TgUser; message?:TgMessage; data?:string };
type TgUpdate = { update_id:number; message?:TgMessage; callback_query?:TgCallback };

const URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const db = createClient(URL, KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth:{ persistSession:false, autoRefreshToken:false } });
const FALLBACK_PHOTO = "https://placehold.co/1200x630/0aa7b8/ffffff/png?text=Traumwohnung+Hamburg";
const TYPE_OPTIONS = ["Wohnung", "Haus", "WG", "Tauschwohnung"];
const NEIGHBORHOODS_PER_PAGE = 15;
const SAVED_PAGE_SIZE = 8;
const START_DEBOUNCE_MS = 8000;

function t(u:any, key:string) { return textFor(u?.ui_language, key); }
function cb(text:string, data:string) { return { text, callback_data:data }; }
function esc(v:unknown) { return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function money(v:any, missing="nicht angegeben") {
  if (v === null || v === undefined || v === "") return missing;
  const n = Number(v);
  return Number.isFinite(n) ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits:2 }).format(n)} €` : String(v);
}
function short(s:unknown, n=45) { const v=String(s ?? "Inserat").replace(/\s+/g," ").trim(); return v.length > n ? `${v.slice(0,n-1)}…` : v; }

async function secret(name:string) {
  const { data, error } = await db.rpc("get_bot_secret", { secret_name:name });
  if (error || !data) throw new Error(`secret ${name} unavailable`);
  return String(data);
}
async function telegram(method:string, body:Record<string,unknown>) {
  const token = await secret("telegram_bot_token_runtime");
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(`Telegram ${method}: ${JSON.stringify(j)}`);
  return j.result;
}
async function send(chatId:number, text:string, reply_markup?:any) {
  return telegram("sendMessage", { chat_id:chatId, text, parse_mode:"HTML", disable_web_page_preview:true, reply_markup });
}
async function edit(chatId:number, messageId:number, text:string, reply_markup?:any) {
  try { return await telegram("editMessageText", { chat_id:chatId, message_id:messageId, text, parse_mode:"HTML", disable_web_page_preview:true, reply_markup }); }
  catch { return send(chatId, text, reply_markup); }
}
async function answerCallback(id:string, text?:string) {
  try { await telegram("answerCallbackQuery", { callback_query_id:id, text:text || undefined, show_alert:false }); } catch {}
}

async function ensureUser(from:TgUser, chatId:number) {
  const payload = { telegram_user_id:from.id, chat_id:chatId, username:from.username || null, first_name:from.first_name || null, last_name:from.last_name || null, language_code:from.language_code || null, is_active:true, updated_at:new Date().toISOString() };
  const { data, error } = await db.from("bot_users").upsert(payload, { onConflict:"telegram_user_id" }).select("*").single();
  if (error) throw error;
  return data;
}
async function freshUser(id:string) {
  const { data, error } = await db.from("bot_users").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function setState(id:string, step:string|null, state:any) {
  const { error } = await db.from("bot_users").update({ onboarding_step:step, onboarding_state:state, updated_at:new Date().toISOString() }).eq("id",id);
  if (error) throw error;
}

function welcomeMarkup(u:any) { return { inline_keyboard:[[cb(t(u,"create"),"home:new")]] }; }
async function showWelcome(u:any, chatId:number, messageId?:number) {
  return messageId ? edit(chatId,messageId,t(u,"welcome"),welcomeMarkup(u)) : send(chatId,t(u,"welcome"),welcomeMarkup(u));
}

function typesMarkup(u:any, state:any) {
  const selected:string[] = state.property_types || [];
  const icons:Record<string,string> = { Wohnung:"🏢", Haus:"🏡", WG:"🛏", Tauschwohnung:"🔄" };
  const rows:any[] = TYPE_OPTIONS.map(x => [cb(`${selected.includes(x)?"✅ ":""}${icons[x]} ${x}`, `type:${x}`)]);
  rows.push([cb(t(u,"all"),"type:all")]);
  rows.push([cb(t(u,"back"),"nav:welcome"), cb(t(u,"confirm"),"type:next")]);
  return { inline_keyboard:rows };
}
async function renderTypes(u:any, chatId:number, messageId:number, state:any) {
  await setState(u.id,"types",state);
  return edit(chatId,messageId,t(u,"types"),typesMarkup(u,state));
}

function locationMarkup(u:any) {
  return { inline_keyboard:[[cb(t(u,"allhh"),"loc:all")],[cb(t(u,"boroughs"),"loc:boroughs")],[cb(t(u,"neighborhoods"),"loc:neighborhoods")],[cb(t(u,"back"),"nav:types")]] };
}
async function renderLocation(u:any, chatId:number, messageId:number, state:any) {
  await setState(u.id,"location",state);
  return edit(chatId,messageId,t(u,"location"),locationMarkup(u));
}

async function boroughMarkup(u:any, state:any) {
  const { data, error } = await db.from("hamburg_boroughs").select("id,name").order("sort_order");
  if (error) throw error;
  const selected:number[] = state.borough_ids || [];
  const rows:any[] = [];
  for (let i=0;i<(data||[]).length;i+=2) rows.push((data||[]).slice(i,i+2).map((b:any)=>cb(`${selected.includes(b.id)?"✅ ":""}${b.name}`,`bor:${b.id}`)));
  rows.push([cb(t(u,"all"),"bor:all")]);
  rows.push([cb(t(u,"back"),"nav:location"), cb(t(u,"confirm"),"bor:done")]);
  return { inline_keyboard:rows };
}
async function renderBoroughs(u:any, chatId:number, messageId:number, state:any) {
  await setState(u.id,"boroughs",state);
  return edit(chatId,messageId,t(u,"chooseB"),await boroughMarkup(u,state));
}

async function neighborhoodMarkup(u:any, state:any) {
  const { data, error } = await db.from("hamburg_neighborhoods").select("id,name").order("id");
  if (error) throw error;
  const all=data||[], selected:number[]=state.neighborhood_ids||[];
  const pages=Math.max(1,Math.ceil(all.length/NEIGHBORHOODS_PER_PAGE));
  const page=Math.max(0,Math.min(Number(state.neighborhood_page||0),pages-1));
  const part=all.slice(page*NEIGHBORHOODS_PER_PAGE,(page+1)*NEIGHBORHOODS_PER_PAGE);
  const rows:any[]=[];
  for(let i=0;i<part.length;i+=3) rows.push(part.slice(i,i+3).map((n:any)=>cb(`${selected.includes(n.id)?"✅ ":""}${n.name}`,`nei:${n.id}`)));
  rows.push([cb(t(u,"all104"),"nei:all"),cb(t(u,"clear"),"nei:clear")]);
  rows.push([cb("◀️","nei:prev"),cb(`${page+1}/${pages}`,"noop"),cb("▶️","nei:next")]);
  rows.push([cb(t(u,"back"),"nav:location"),cb(t(u,"confirm"),"nei:done")]);
  return { markup:{inline_keyboard:rows}, page };
}
async function renderNeighborhoods(u:any, chatId:number, messageId:number, state:any) {
  const { markup, page }=await neighborhoodMarkup(u,state);
  state.neighborhood_page=page;
  await setState(u.id,"neighborhoods",state);
  return edit(chatId,messageId,`${t(u,"chooseN")}\n\n<b>${(state.neighborhood_ids||[]).length}/104</b>`,markup);
}

function rentMarkup(u:any) {
  return { inline_keyboard:[[cb("bis 800 €","rent:800"),cb("bis 1.000 €","rent:1000")],[cb("bis 1.250 €","rent:1250"),cb("bis 1.500 €","rent:1500")],[cb(t(u,"custom"),"rent:custom")],[cb(t(u,"back"),"nav:location")]] };
}
async function renderRent(u:any, chatId:number, messageId:number, state:any) {
  await setState(u.id,"rent",state);
  return edit(chatId,messageId,t(u,"rent"),rentMarkup(u));
}
function areaMarkup(u:any) {
  return { inline_keyboard:[[cb(t(u,"none"),"area:0"),cb("40 m²","area:40")],[cb("60 m²","area:60"),cb("80 m²","area:80")],[cb(t(u,"back"),"nav:rent")]] };
}
async function renderArea(u:any, chatId:number, messageId:number, state:any) {
  await setState(u.id,"area",state);
  return edit(chatId,messageId,t(u,"area"),areaMarkup(u));
}

async function selectedNames(state:any) {
  let location="Ganz Hamburg", districts=["Ganz Hamburg"] as string[], boroughs:string[]=[], neighborhoods:string[]=[];
  if(state.location_mode==="boroughs") {
    const ids:number[]=state.borough_ids||[];
    const { data:b }=await db.from("hamburg_boroughs").select("name").in("id",ids).order("sort_order");
    boroughs=(b||[]).map((x:any)=>x.name);
    const { data:n }=await db.from("hamburg_neighborhoods").select("name").in("borough_id",ids).order("name");
    districts=(n||[]).map((x:any)=>x.name); location=boroughs.join(", ");
  } else if(state.location_mode==="neighborhoods") {
    const { data:n }=await db.from("hamburg_neighborhoods").select("name").in("id",state.neighborhood_ids||[]).order("name");
    neighborhoods=(n||[]).map((x:any)=>x.name); districts=neighborhoods;
    location=neighborhoods.length>12?`${neighborhoods.slice(0,12).join(", ")} … (+${neighborhoods.length-12})`:neighborhoods.join(", ");
  }
  return { location, districts, boroughs, neighborhoods };
}
async function renderReview(u:any, chatId:number, messageId:number, state:any) {
  const names=await selectedNames(state);
  const text=`${t(u,"review")}\n\n🏠 <b>Typ:</b> ${esc((state.property_types||[]).join(", "))}\n📍 <b>Gebiet:</b> ${esc(names.location)}\n💶 <b>${esc(t(u,"warmRent"))}:</b> bis ${money(state.max_warm_rent,t(u,"missing"))}\n📐 <b>${esc(t(u,"areaLabel"))}:</b> ${Number(state.min_area_sqm||0)>0?`${state.min_area_sqm} m²`:t(u,"none")}`;
  await setState(u.id,"review",state);
  return edit(chatId,messageId,text,{inline_keyboard:[[cb(t(u,"activate"),"review:save")],[cb(t(u,"back"),"nav:area")]]});
}

function listingAddress(l:any) {
  if(l.address&&String(l.address).trim()) return String(l.address).trim().replace(/^Geschoss\s+/i,"").replace(/^EG\s+/i,"");
  return [l.district,l.postal_code,l.city||"Hamburg"].filter(Boolean).join(", ") || "Vom Anbieter nicht veröffentlicht";
}
function mapUrl(l:any) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listingAddress(l))}`; }
function listingCaption(u:any,l:any) {
  const missing=t(u,"missing");
  return `🏠 <b>${esc(short(l.title,180))}</b>\n\n📍 <b>${esc(t(u,"address"))}:</b> ${esc(listingAddress(l))}\n💶 <b>${esc(t(u,"warmRent"))}:</b> ${money(l.warm_rent,missing)}\n❄️ <b>${esc(t(u,"coldRent"))}:</b> ${money(l.cold_rent,missing)}\n🔥 <b>${esc(t(u,"heating"))}:</b> ${money(l.heating_costs,missing)}\n🧾 <b>${esc(t(u,"additional"))}:</b> ${money(l.additional_costs,missing)}\n🔐 <b>${esc(t(u,"deposit"))}:</b> ${l.deposit_text?esc(l.deposit_text):money(l.deposit,missing)}\n🚪 <b>${esc(t(u,"rooms"))}:</b> ${l.rooms??missing}\n📐 <b>${esc(t(u,"areaLabel"))}:</b> ${l.area_sqm!=null?`${esc(l.area_sqm)} m²`:missing}`;
}
function listingKeyboard(u:any,l:any,source:any,saved=false) {
  const label=source?.button_label||source?.name||"Angebot";
  return { inline_keyboard:[[{text:`🔗 ${label}`,url:l.canonical_url}],[cb(saved?t(u,"savedState"):t(u,"save"),`save:${l.id}`),{text:t(u,"maps"),url:mapUrl(l)}]] };
}
async function sendListingCard(u:any,chatId:number,l:any,source:any,saved=false) {
  for(const photo of [l.image_url,FALLBACK_PHOTO].filter(Boolean)) {
    try { return await telegram("sendPhoto",{chat_id:chatId,photo,caption:listingCaption(u,l),parse_mode:"HTML",reply_markup:listingKeyboard(u,l,source,saved)}); } catch {}
  }
  throw new Error("sendPhoto failed");
}

async function savedMenu(u:any,chatId:number,messageId?:number,page=0) {
  const { count, error:countError }=await db.from("saved_listings").select("id",{count:"exact",head:true}).eq("user_id",u.id);
  if(countError) throw countError;
  const total=count||0;
  if(!total) {
    const markup={inline_keyboard:[[cb(t(u,"back"),"nav:welcome")]]};
    return messageId?edit(chatId,messageId,t(u,"nosaved"),markup):send(chatId,t(u,"nosaved"),markup);
  }
  const pages=Math.max(1,Math.ceil(total/SAVED_PAGE_SIZE));
  page=Math.max(0,Math.min(page,pages-1));
  const from=page*SAVED_PAGE_SIZE,to=from+SAVED_PAGE_SIZE-1;
  const { data,error }=await db.from("saved_listings").select("listing_id,created_at,listings(title,district,postal_code)").eq("user_id",u.id).order("created_at",{ascending:false}).range(from,to);
  if(error) throw error;
  const rows:any[]=(data||[]).map((r:any,i:number)=>[cb(`🏠 ${from+i+1}. ${short(r.listings?.title,42)}`,`savedopen:${r.listing_id}`)]);
  rows.push([cb("◀️",`savedpage:${Math.max(0,page-1)}`),cb(`${page+1}/${pages}`,"noop"),cb("▶️",`savedpage:${Math.min(pages-1,page+1)}`)]);
  rows.push([cb(t(u,"back"),"nav:welcome")]);
  const text=`${t(u,"saved")}\n\n${total} · Seite ${page+1}/${pages}`;
  return messageId?edit(chatId,messageId,text,{inline_keyboard:rows}):send(chatId,text,{inline_keyboard:rows});
}

async function settings(u:any,chatId:number,messageId?:number) {
  const rows:any[]=Object.entries(LANGS).map(([code,label])=>[cb(`${u.ui_language===code?"✅ ":""}${label}`,`lang:${code}`)]);
  rows.push([cb(t(u,"back"),"nav:welcome")]);
  const text=`${t(u,"settings")}\n\n${t(u,"language")}`;
  return messageId?edit(chatId,messageId,text,{inline_keyboard:rows}):send(chatId,text,{inline_keyboard:rows});
}

async function handleCallback(q:TgCallback,user:any) {
  const chatId=q.message?.chat.id,messageId=q.message?.message_id,data=q.data||"";
  if(!chatId||!messageId) return answerCallback(q.id);
  let u=await freshUser(user.id), state={...(u.onboarding_state||{})};
  if(data==="noop") return answerCallback(q.id);
  if(data.startsWith("lang:")) {
    const code=data.slice(5); if(LANGS[code]) await db.from("bot_users").update({ui_language:code,updated_at:new Date().toISOString()}).eq("id",u.id);
    u=await freshUser(u.id); await answerCallback(q.id); return settings(u,chatId,messageId);
  }
  if(data==="home:new") { state={property_types:[],borough_ids:[],neighborhood_ids:[],location_mode:null,max_warm_rent:null,min_area_sqm:0}; await answerCallback(q.id); return renderTypes(u,chatId,messageId,state); }
  if(data==="nav:welcome") { await setState(u.id,null,{}); await answerCallback(q.id); return showWelcome(u,chatId,messageId); }
  if(data==="nav:types") { await answerCallback(q.id); return renderTypes(u,chatId,messageId,state); }
  if(data==="nav:location") { await answerCallback(q.id); return renderLocation(u,chatId,messageId,state); }
  if(data==="nav:rent") { await answerCallback(q.id); return renderRent(u,chatId,messageId,state); }
  if(data==="nav:area") { await answerCallback(q.id); return renderArea(u,chatId,messageId,state); }
  if(data.startsWith("type:")) {
    const v=data.slice(5); let selected:string[]=state.property_types||[];
    if(v==="all") selected=[...TYPE_OPTIONS];
    else if(v==="next") { if(!selected.length) return answerCallback(q.id,"Bitte mindestens eine Option wählen."); state.property_types=selected; await answerCallback(q.id); return renderLocation(u,chatId,messageId,state); }
    else selected=selected.includes(v)?selected.filter(x=>x!==v):[...selected,v];
    state.property_types=selected; await answerCallback(q.id); return renderTypes(u,chatId,messageId,state);
  }
  if(data.startsWith("loc:")) {
    const v=data.slice(4);
    if(v==="all") { state.location_mode="all_hamburg"; state.borough_ids=[]; state.neighborhood_ids=[]; await answerCallback(q.id); return renderRent(u,chatId,messageId,state); }
    if(v==="boroughs") { state.location_mode="boroughs"; await answerCallback(q.id); return renderBoroughs(u,chatId,messageId,state); }
    if(v==="neighborhoods") { state.location_mode="neighborhoods"; state.neighborhood_page=0; await answerCallback(q.id); return renderNeighborhoods(u,chatId,messageId,state); }
  }
  if(data.startsWith("bor:")) {
    const v=data.slice(4); let ids:number[]=state.borough_ids||[];
    if(v==="all") ids=[1,2,3,4,5,6,7];
    else if(v==="done") { if(!ids.length) return answerCallback(q.id,"Bitte mindestens einen Bezirk wählen."); state.borough_ids=ids; await answerCallback(q.id); return renderRent(u,chatId,messageId,state); }
    else { const id=Number(v); ids=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]; }
    state.borough_ids=ids; await answerCallback(q.id); return renderBoroughs(u,chatId,messageId,state);
  }
  if(data.startsWith("nei:")) {
    const v=data.slice(4); let ids:number[]=state.neighborhood_ids||[];
    if(v==="all") { const {data:ns}=await db.from("hamburg_neighborhoods").select("id"); ids=(ns||[]).map((x:any)=>x.id); }
    else if(v==="clear") ids=[];
    else if(v==="prev") state.neighborhood_page=Math.max(0,Number(state.neighborhood_page||0)-1);
    else if(v==="next") state.neighborhood_page=Number(state.neighborhood_page||0)+1;
    else if(v==="done") { if(!ids.length) return answerCallback(q.id,"Bitte mindestens einen Stadtteil wählen."); state.neighborhood_ids=ids; await answerCallback(q.id); return renderRent(u,chatId,messageId,state); }
    else { const id=Number(v); ids=ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]; }
    state.neighborhood_ids=ids; await answerCallback(q.id); return renderNeighborhoods(u,chatId,messageId,state);
  }
  if(data.startsWith("rent:")) {
    const v=data.slice(5);
    if(v==="custom") { await setState(u.id,"custom_rent",state); await answerCallback(q.id); return edit(chatId,messageId,t(u,"enter"),{inline_keyboard:[[cb(t(u,"back"),"nav:rent")]]}); }
    state.max_warm_rent=Number(v); await answerCallback(q.id); return renderArea(u,chatId,messageId,state);
  }
  if(data.startsWith("area:")) { state.min_area_sqm=Number(data.slice(5)); await answerCallback(q.id); return renderReview(u,chatId,messageId,state); }
  if(data==="review:save") {
    const names=await selectedNames(state);
    const {count}=await db.from("search_profiles").select("id",{count:"exact",head:true}).eq("user_id",u.id);
    if((count||0)>=3) return answerCallback(q.id,"Maximal 3 Suchprofile.");
    const {error}=await db.from("search_profiles").insert({user_id:u.id,name:"Meine Suche",property_types:state.property_types,max_warm_rent:state.max_warm_rent,min_rooms:0,min_area_sqm:state.min_area_sqm||0,districts:names.districts,location_mode:state.location_mode||"all_hamburg",boroughs:names.boroughs,neighborhoods:names.neighborhoods,wbs_only:false,is_active:true});
    if(error) throw error; await setState(u.id,null,{}); await answerCallback(q.id); return edit(chatId,messageId,t(u,"created"),{inline_keyboard:[[cb(t(u,"create"),"home:new")]]});
  }
  if(data.startsWith("save:")) {
    const listingId=data.slice(5); const {data:existing}=await db.from("saved_listings").select("id").eq("user_id",u.id).eq("listing_id",listingId).maybeSingle(); let isSaved=false;
    if(existing) await db.from("saved_listings").delete().eq("id",existing.id);
    else { await db.from("saved_listings").insert({user_id:u.id,listing_id:listingId}); isSaved=true; }
    await answerCallback(q.id,isSaved?t(u,"savedState"):"Entfernt");
    const {data:l}=await db.from("listings").select("*,sources(name,button_label)").eq("id",listingId).single();
    if(l) try { await telegram("editMessageReplyMarkup",{chat_id:chatId,message_id:messageId,reply_markup:listingKeyboard(u,l,l.sources,isSaved)}); } catch {}
    return;
  }
  if(data.startsWith("savedpage:")) { await answerCallback(q.id); return savedMenu(u,chatId,messageId,Number(data.slice(10))||0); }
  if(data.startsWith("savedopen:")) {
    const listingId=data.slice(10); const {data:l,error}=await db.from("listings").select("*,sources(name,button_label)").eq("id",listingId).single();
    if(error||!l) return answerCallback(q.id,"Inserat nicht verfügbar.");
    await answerCallback(q.id); return sendListingCard(u,chatId,l,l.sources,true);
  }
  return answerCallback(q.id);
}

async function handleMessage(msg:TgMessage,user:any) {
  const chatId=msg.chat.id,text=(msg.text||"").trim(),cmd=text.split(/\s+/)[0].toLowerCase().replace(/@traumwohnunghamburgbot$/i,"");
  let u=await freshUser(user.id);
  if(cmd==="/start") {
    const last=u.last_start_at?new Date(u.last_start_at).getTime():0;
    if(last&&Date.now()-last<START_DEBOUNCE_MS) return;
    await db.from("bot_users").update({last_start_at:new Date().toISOString(),onboarding_step:null,onboarding_state:{},updated_at:new Date().toISOString()}).eq("id",u.id);
    return showWelcome(await freshUser(u.id),chatId);
  }
  if(cmd==="/suche") { const state={property_types:[],borough_ids:[],neighborhood_ids:[],location_mode:null,max_warm_rent:null,min_area_sqm:0}; await setState(u.id,"types",state); return send(chatId,t(u,"types"),typesMarkup(u,state)); }
  if(cmd==="/gespeichert"||cmd==="/saved") return savedMenu(u,chatId,undefined,0);
  if(cmd==="/einstellungen"||cmd==="/settings") return settings(u,chatId);
  if(cmd==="/profile") {
    const {data}=await db.from("search_profiles").select("name,property_types,max_warm_rent,min_area_sqm,location_mode,boroughs,neighborhoods,is_active").eq("user_id",u.id).order("created_at");
    if(!data?.length) return send(chatId,"Noch kein Suchprofil vorhanden. Nutze /suche.");
    return send(chatId,data.map((p:any,i:number)=>`<b>${i+1}. ${esc(p.name)}</b> ${p.is_active?"🟢":"⏸"}\n🏠 ${esc((p.property_types||[]).join(", "))}\n💶 bis ${money(p.max_warm_rent,t(u,"missing"))}\n📐 ${Number(p.min_area_sqm||0)>0?`ab ${p.min_area_sqm} m²`:t(u,"none")}\n📍 ${p.location_mode==="all_hamburg"?t(u,"allhh").replace(/^🌐\s*/,""):esc((p.neighborhoods?.length?p.neighborhoods:p.boroughs||[]).join(", "))}`).join("\n\n"));
  }
  if(cmd==="/pause") { await db.from("search_profiles").update({is_active:false,updated_at:new Date().toISOString()}).eq("user_id",u.id); return send(chatId,"⏸ Deine Suchprofile sind pausiert."); }
  if(cmd==="/resume") { await db.from("search_profiles").update({is_active:true,updated_at:new Date().toISOString()}).eq("user_id",u.id); return send(chatId,"▶️ Deine Suchprofile sind wieder aktiv."); }
  if(cmd==="/status") {
    const {count:p}=await db.from("search_profiles").select("id",{count:"exact",head:true}).eq("user_id",u.id).eq("is_active",true);
    const {count:s}=await db.from("sources").select("id",{count:"exact",head:true}).eq("enabled",true);
    return send(chatId,`📡 <b>Status</b>\nAktive Suchprofile: ${p||0}\nAktive Quellen: ${s||0}\nSystem: online`);
  }
  if(cmd==="/hilfe") return send(chatId,"/suche – Suche erstellen\n/profile – Suchprofile\n/gespeichert – Gespeicherte Inserate\n/einstellungen – Sprache\n/pause – pausieren\n/resume – fortsetzen\n/status – Systemstatus");
  if(u.onboarding_step==="custom_rent") {
    const n=Number(text.replace(/\./g,"").replace(",","."));
    if(!Number.isFinite(n)||n<100||n>20000) return send(chatId,t(u,"enter"));
    const state={...(u.onboarding_state||{}),max_warm_rent:n}; await setState(u.id,"area",state); return send(chatId,t(u,"area"),areaMarkup(u));
  }
  return send(chatId,t(u,"use"));
}

async function internalTest(req:Request,body:any) {
  if((req.headers.get("x-internal-secret")||"")!==await secret("internal_worker_secret")) return new Response("unauthorized",{status:401});
  const chatId=Number(body.chat_id); if(!chatId) return Response.json({ok:false,error:"chat_id required"},{status:400});
  let query:any=db.from("listings").select("*,sources(name,button_label)");
  if(body.listing_id) query=query.eq("id",String(body.listing_id));
  else query=query.or("warm_rent.not.is.null,cold_rent.not.is.null").not("rooms","is",null).not("area_sqm","is",null).order("first_seen_at",{ascending:false});
  const {data,error}=await query.limit(1); if(error) throw error;
  const l=(data||[])[0]; if(!l) return Response.json({ok:false,error:"no test listing"},{status:404});
  const {data:user}=await db.from("bot_users").select("*").eq("chat_id",chatId).maybeSingle();
  const result=await sendListingCard(user||{ui_language:"de"},chatId,l,l.sources,false);
  return Response.json({ok:true,message_id:result?.message_id,listing_id:l.id});
}

Deno.serve(async(req:Request)=>{
  try {
    if(req.method!=="POST") return new Response("method not allowed",{status:405});
    const body=await req.json().catch(()=>({}));
    if(body?.action==="test_listing") return internalTest(req,body);
    if((req.headers.get("x-telegram-bot-api-secret-token")||"")!==await secret("telegram_webhook_secret")) return new Response("unauthorized",{status:401});
    const update=body as TgUpdate;
    const {error:eventError}=await db.from("bot_events").insert({telegram_update_id:update.update_id,event_type:update.callback_query?"callback_query":update.message?"message":"other",telegram_user_id:update.callback_query?.from?.id||update.message?.from?.id||null,payload:update});
    if(eventError) {
      if(eventError.code==="23505"||String(eventError.message).toLowerCase().includes("duplicate")) return Response.json({ok:true,duplicate:true});
      console.error(eventError);
    }
    if(update.callback_query?.from&&update.callback_query.message) { const user=await ensureUser(update.callback_query.from,update.callback_query.message.chat.id); await handleCallback(update.callback_query,user); return Response.json({ok:true}); }
    if(update.message?.from&&update.message.chat.type==="private"&&update.message.text) { const user=await ensureUser(update.message.from,update.message.chat.id); await handleMessage(update.message,user); }
    return Response.json({ok:true});
  } catch(e) {
    console.error(e);
    return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500});
  }
});
