import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const KEY = KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PREMIUM_LINK = "https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01";
const IMAGE_URL = `${URL}/functions/v1/telegram-premium-image`;

type Lang = "de" | "en" | "ckb" | "ku" | "prs" | "fa" | "ru" | "tr" | "ar";
const COPY: Record<Lang, { active:string; benefits:string; instant:string; profiles:string; coop:string; saved:string; price:string; term:string; unlock:string; manage:string; back:string }> = {
  de:{active:"Premium ist aktiv.",benefits:"Deine Vorteile:",instant:"Sofortige Zustellung",profiles:"Bis zu 3 Suchprofile",coop:"Baugenossenschafts-Angebote öffnen",saved:"Inserate speichern",price:"0,99 € / Monat",term:"Keine Mindestlaufzeit · jederzeit kündbar",unlock:"Premium freischalten",manage:"Abo verwalten",back:"Zurück"},
  en:{active:"Premium is active.",benefits:"Your benefits:",instant:"Instant delivery",profiles:"Up to 3 search profiles",coop:"Open housing-cooperative listings",saved:"Save listings",price:"€0.99 / month",term:"No minimum term · cancel anytime",unlock:"Unlock Premium",manage:"Manage subscription",back:"Back"},
  ckb:{active:"Premium چالاکە.",benefits:"سوودەکانت:",instant:"گەیاندنی دەستبەجێ",profiles:"تا ٣ پڕۆفایلی گەڕان",coop:"کردنەوەی ڕیکلامەکانی کۆمەڵەی نیشتەجێبوون",saved:"پاشەکەوتکردنی ڕیکلامەکان",price:"0,99 € / مانگ",term:"هیچ ماوەی کەمترین نییە · هەرکات دەتوانیت هەڵبوەشێنیتەوە",unlock:"Premium چالاک بکە",manage:"بەڕێوەبردنی بەشداری",back:"گەڕانەوە"},
  ku:{active:"Premium çalak e.",benefits:"Feydeyên te:",instant:"Şandina yekser",profiles:"Heta 3 profîlên lêgerînê",coop:"Îlanên kooperatîfên xanî veke",saved:"Îlanan tomar bike",price:"0,99 € / meh",term:"Demê herî kêm tune · her dem dikarî betal bikî",unlock:"Premium çalak bike",manage:"Abonetiya birêve bibe",back:"Paş"},
  prs:{active:"Premium فعال است.",benefits:"مزایای شما:",instant:"ارسال فوری",profiles:"تا ۳ پروفایل جستجو",coop:"باز کردن آگهی‌های تعاونی مسکن",saved:"ذخیره آگهی‌ها",price:"۰٫۹۹ یورو / ماه",term:"بدون حداقل مدت · لغو در هر زمان",unlock:"فعال‌سازی Premium",manage:"مدیریت اشتراک",back:"برگشت"},
  fa:{active:"Premium فعال است.",benefits:"مزایای شما:",instant:"ارسال فوری",profiles:"تا ۳ پروفایل جستجو",coop:"باز کردن آگهی‌های تعاونی مسکن",saved:"ذخیره آگهی‌ها",price:"۰٫۹۹ یورو / ماه",term:"بدون حداقل مدت · لغو در هر زمان",unlock:"فعال‌سازی Premium",manage:"مدیریت اشتراک",back:"بازگشت"},
  ru:{active:"Premium активен.",benefits:"Ваши преимущества:",instant:"Мгновенная доставка",profiles:"До 3 профилей поиска",coop:"Открывать объявления жилищных кооперативов",saved:"Сохранять объявления",price:"0,99 € / месяц",term:"Без минимального срока · отмена в любое время",unlock:"Подключить Premium",manage:"Управлять подпиской",back:"Назад"},
  tr:{active:"Premium aktif.",benefits:"Avantajların:",instant:"Anında teslim",profiles:"3 arama profiline kadar",coop:"Konut kooperatifi ilanlarını aç",saved:"İlanları kaydet",price:"0,99 € / ay",term:"Minimum süre yok · istediğin zaman iptal",unlock:"Premium'u aç",manage:"Aboneliği yönet",back:"Geri"},
  ar:{active:"Premium مفعّل.",benefits:"مزاياك:",instant:"إرسال فوري",profiles:"حتى 3 ملفات بحث",coop:"فتح عروض جمعيات الإسكان",saved:"حفظ الإعلانات",price:"0.99 € / شهر",term:"لا توجد مدة دنيا · إلغاء في أي وقت",unlock:"تفعيل Premium",manage:"إدارة الاشتراك",back:"رجوع"},
};

let tokenCache: { value:string; expiresAt:number } | null = null;
let webhookCache: { value:string; expiresAt:number } | null = null;
async function botSecret(name:string){
  const { data, error } = await db.rpc("get_bot_secret", { secret_name:name });
  if(error || !data) throw new Error(`${name} unavailable`);
  return String(data);
}
async function botToken(){
  if(tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const value = await botSecret("telegram_bot_token");
  tokenCache = { value, expiresAt: Date.now()+5*60_000 };
  return value;
}
async function webhookSecret(force=false){
  if(!force && webhookCache && webhookCache.expiresAt>Date.now()) return webhookCache.value;
  const value=await botSecret("telegram_webhook_secret");
  webhookCache={value,expiresAt:Date.now()+5*60_000};
  return value;
}
async function telegram(method:string,payload:any){
  const token=await botToken();
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok || !result.ok) throw new Error(String(result?.description || `Telegram ${response.status}`));
  return result.result;
}
function language(value:unknown):Lang{
  const code=String(value||"de").toLowerCase();
  return code in COPY ? code as Lang : "de";
}
function isPremium(user:any, subscription:any){
  const now=Date.now();
  if(user?.plan_override==="free") return false;
  if(user?.plan_override==="premium" && (!user.plan_override_expires_at || new Date(user.plan_override_expires_at).getTime()>now)) return true;
  if(user?.referral_bonus_until && new Date(user.referral_bonus_until).getTime()>now) return true;
  return !!subscription && ["active","trialing"].includes(String(subscription.status||"")) && (!subscription.current_period_end || new Date(subscription.current_period_end).getTime()>now);
}

Deno.serve(async (req:Request)=>{
  try{
    if(req.method!=="POST") return new Response("method not allowed",{status:405});
    const supplied=req.headers.get("x-telegram-bot-api-secret-token")||"";
    let expected=await webhookSecret();
    if(supplied!==expected){ expected=await webhookSecret(true); if(supplied!==expected) return new Response("unauthorized",{status:401}); }
    const update=await req.json();
    const from=update?.callback_query?.from || update?.message?.from;
    const chatId=Number(update?.callback_query?.message?.chat?.id || update?.message?.chat?.id);
    if(!from?.id || !chatId) return Response.json({ok:true,ignored:true});
    if(update?.callback_query?.id) telegram("answerCallbackQuery",{callback_query_id:update.callback_query.id}).catch(()=>{});

    const { data:user,error:userError }=await db.from("bot_users").select("id,telegram_user_id,ui_language,plan_override,plan_override_expires_at,referral_bonus_until").eq("telegram_user_id",from.id).maybeSingle();
    if(userError) throw userError;
    if(!user) return Response.json({ok:false,error:"user_not_found"},{status:404});
    const { data:subscription,error:subError }=await db.from("user_subscriptions").select("status,current_period_end").eq("user_id",user.id).maybeSingle();
    if(subError) throw subError;
    const premium=isPremium(user,subscription);
    const c=COPY[language(user.ui_language)];
    const caption=premium
      ? `💎 <b>Traumwohnung Premium</b>\n\n✅ <b>${c.active}</b>\n\n<b>${c.benefits}</b>\n⚡ ${c.instant}\n🔎 ${c.profiles}\n🔓 ${c.coop}\n⭐️ ${c.saved}`
      : `💎 <b>Traumwohnung Premium</b>\n\n<b>${c.benefits}</b>\n⚡ ${c.instant}\n🔎 ${c.profiles}\n🔓 ${c.coop}\n⭐️ ${c.saved}\n\n<b>${c.price}</b>\n${c.term}`;
    const rows:any[]=[];
    if(premium) rows.push([{text:`💳 ${c.manage}`,callback_data:"portal"}]);
    else rows.push([{text:`💎 ${c.unlock}`,url:`${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}`}]);
    rows.push([{text:`← ${c.back}`,callback_data:"home"}]);
    await telegram("sendPhoto",{chat_id:chatId,photo:IMAGE_URL,caption,parse_mode:"HTML",reply_markup:{inline_keyboard:rows}});
    return Response.json({ok:true});
  }catch(error){
    console.error("telegram_premium",error);
    return Response.json({ok:false,error:"premium_failure"},{status:500});
  }
});
