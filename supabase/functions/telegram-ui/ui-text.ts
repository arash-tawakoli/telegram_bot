import { LANGS, msg as baseMsg } from "./ui-text-v2.ts";
export { LANGS };

type Dict=Record<string,string>;

const prs:Dict={
  welcome:"🏠 <b>Traumwohnung Hamburg</b>\n\nخانه مناسب را در سراسر هامبورگ به‌صورت خودکار پیدا کنید و پروفایل جستجوی شخصی خود را در چند مرحله بسازید.",
  draft:"📝 یک پروفایل جستجوی ناتمام ذخیره شده است.",continueDraft:"▶️ ادامه پیش‌نویس",create:"🔎 ایجاد جستجو",profiles:"🔎 پروفایل‌های جستجوی من",saved:"💾 اعلان‌های ذخیره‌شده",settings:"⚙️ تنظیمات",help:"❓ راهنما",back:"⬅️ برگشت",later:"✖️ بعداً ادامه بده",confirm:"بعدی ➡️",selectAll:"انتخاب همه",
  typeStep:"1/8 · <b>دنبال چه نوع خانه هستید؟</b>\n\nیک یا چند نوع خانه را انتخاب کنید.",locationStep:"2/8 · <b>در کجا می‌خواهید جستجو کنید؟</b>",allHamburg:"🌐 تمام هامبورگ",boroughs:"🏙 انتخاب مناطق",neighborhoods:"📍 انتخاب محله‌ها",chooseBPrompt:"یک یا چند منطقه از ۷ منطقه هامبورگ را انتخاب کنید.",chooseN:"محله‌های دلخواه را انتخاب کنید.",clear:"پاک‌کردن انتخاب",
  rentStep:"3/8 · <b>حداکثر کرایه مجموعی</b>",noLimit:"بدون محدودیت",custom:"✏️ مبلغ دلخواه",enterRent:"حداکثر کرایه مجموعی را به‌صورت عدد وارد کنید، مثلاً <code>1250</code>.",roomsStep:"4/8 · <b>حداقل چند اتاق؟</b>",any:"فرقی ندارد",areaStep:"5/8 · <b>حداقل مساحت</b>",enterArea:"حداقل مساحت را به‌صورت عدد وارد کنید، مثلاً <code>55</code>.",
  wbsStep:"6/8 · <b>WBS</b>\n\nآیا جستجو فقط خانه‌های دارای WBS را شامل شود؟",wbsOnly:"🏷 فقط خانه‌های WBS",wbsAll:"🌐 با و بدون WBS",furnStep:"7/8 · <b>مبله بودن</b>",furnYes:"🛋 مبله",furnNo:"🏠 بدون مبلمان",nameStep:"8/8 · <b>نام این جستجو چه باشد؟</b>\n\nنام اختیاری است.",autoName:"✅ استفاده از نام خودکار",customName:"✏️ واردکردن نام دلخواه",enterName:"یک نام کوتاه وارد کنید، مثلاً <code>2 اتاق Altona</code>.",
  review:"✅ <b>بررسی پروفایل جستجو</b>",activate:"✅ فعال‌کردن جستجو",fieldType:"نوع",fieldLocation:"منطقه",fieldRent:"کرایه",fieldRooms:"اتاق",fieldArea:"مساحت",fieldWbs:"WBS",fieldFurn:"مبلمان",fieldName:"نام",onlyWbs:"فقط WBS",withWbs:"با و بدون WBS",furnished:"مبله",unfurnished:"بدون مبلمان",profileBase:"جستجوی من",maxProfiles:"حداکثر ۳ پروفایل جستجو.",created:"✅ جستجوی شما فعال است. اعلان‌های جدید مطابق به‌صورت خودکار ارسال می‌شوند.",noProfiles:"هنوز پروفایل جستجویی وجود ندارد.",
  pause:"⏸ توقف",resume:"▶️ فعال‌کردن",delete:"🗑 حذف",deleteAsk:"این پروفایل جستجو حذف شود؟",yesDelete:"🗑 بله، حذف شود",paused:"⏸ پروفایل‌های جستجوی شما متوقف شدند.",resumed:"▶️ پروفایل‌های جستجوی شما دوباره فعال شدند.",status:"📡 وضعیت",activeProfiles:"پروفایل‌های فعال",activeSources:"منابع فعال",online:"سیستم: آنلاین",
  helpText:"/suche – ایجاد جستجوی جدید\n/profile – مدیریت پروفایل‌های جستجو\n/gespeichert – اعلان‌های ذخیره‌شده\n/einstellungen – زبان\n/pause – توقف همه جستجوها\n/resume – فعال‌کردن همه جستجوها\n/status – وضعیت سیستم",useButtons:"لطفاً از دکمه‌های زیر پیام استفاده کنید.",chooseType:"لطفاً حداقل یک گزینه را انتخاب کنید.",chooseBError:"لطفاً حداقل یک منطقه را انتخاب کنید.",chooseNOne:"لطفاً حداقل یک محله را انتخاب کنید.",invalidArea:"لطفاً مساحتی بین ۸ و ۱۰۰۰ متر مربع وارد کنید.",invalidName:"لطفاً حداقل ۲ حرف وارد کنید.",noSaved:"هنوز اعلان ذخیره‌شده‌ای ندارید.",page:"صفحه",listingUnavailable:"اعلان در دسترس نیست.",
  offer:"🔗 اعلان",maps:"📍 Google Maps",save:"💾 ذخیره",savedState:"✅ ذخیره شد",removed:"حذف شد",warm:"کرایه مجموعی",cold:"کرایه پایه",additional:"مصارف جانبی",operating:"مصارف عملیاتی",heating:"مصارف گرمایش",deposit:"تضمین",area:"مساحت مسکونی",rooms:"اتاق",address:"آدرس",typeApartment:"آپارتمان",typeHouse:"خانه",typeWG:"خانه مشترک",typeSwap:"آپارتمان تبادله‌ای"
};

const bad:Dict={
  welcome:"🏠 <b>Traumwohnung Hamburg</b>\n\nLi hemû Hamburgê malên guncaw bixweber bibîne û di çend gavên de profîla lêgerîna xwe çêke.",
  draft:"📝 Profîleke lêgerînê ya neqediyayî hatiye tomarkirin.",continueDraft:"▶️ Berdewamî bi pêşnivîsê",create:"🔎 Lêgerîn çêke",profiles:"🔎 Profîlên lêgerîna min",saved:"💾 Îlanên tomarkirî",settings:"⚙️ Mîheng",help:"❓ Alîkarî",back:"⬅️ Paş",later:"✖️ Paşê berdewam bike",confirm:"Pêş ➡️",selectAll:"Hemû hilbijêre",
  typeStep:"1/8 · <b>Tu li çi digerî?</b>\n\nYek an çend cureyên malê hilbijêre.",locationStep:"2/8 · <b>Li ku derê dixwazî bigerî?</b>",allHamburg:"🌐 Hemû Hamburg",boroughs:"🏙 Herêman hilbijêre",neighborhoods:"📍 Taxan hilbijêre",chooseBPrompt:"Ji 7 herêmên Hamburgê yek an çend hilbijêre.",chooseN:"Taxên ku dixwazî hilbijêre.",clear:"Hilbijartin paqij bike",
  rentStep:"3/8 · <b>Kirêya giştî ya herî zêde</b>",noLimit:"Bê sînor",custom:"✏️ Meblağa taybet",enterRent:"Kirêya giştî ya herî zêde wek hejmar binivîse, mînak <code>1250</code>.",roomsStep:"4/8 · <b>Kêmî çend ode?</b>",any:"Her çi",areaStep:"5/8 · <b>Rûbera herî kêm</b>",enterArea:"Rûbera herî kêm wek hejmar binivîse, mînak <code>55</code>.",
  wbsStep:"6/8 · <b>WBS</b>\n\nLêgerîn tenê malên WBS bigire nav xwe?",wbsOnly:"🏷 Tenê malên WBS",wbsAll:"🌐 Bi û bê WBS",furnStep:"7/8 · <b>Mobîlya</b>",furnYes:"🛋 Mobîlyedar",furnNo:"🏠 Bê mobîlya",nameStep:"8/8 · <b>Navê vê lêgerînê çi be?</b>\n\nNav ne mecbûrî ye.",autoName:"✅ Navê bixweber bikar bîne",customName:"✏️ Navek taybet binivîse",enterName:"Navek kurt binivîse, mînak <code>2 ode Altona</code>.",
  review:"✅ <b>Profîla lêgerînê kontrol bike</b>",activate:"✅ Lêgerînê çalak bike",fieldType:"Cure",fieldLocation:"Herêm",fieldRent:"Kirê",fieldRooms:"Ode",fieldArea:"Rûber",fieldWbs:"WBS",fieldFurn:"Mobîlya",fieldName:"Nav",onlyWbs:"tenê WBS",withWbs:"bi û bê WBS",furnished:"mobîlyedar",unfurnished:"bê mobîlya",profileBase:"Lêgerîna min",maxProfiles:"Herî zêde 3 profîlên lêgerînê.",created:"✅ Lêgerîna te çalak e. Îlanên nû yên guncaw bixweber tên şandin.",noProfiles:"Hêj profîleke lêgerînê tune.",
  pause:"⏸ Rawestîne",resume:"▶️ Çalak bike",delete:"🗑 Jê bibe",deleteAsk:"Ev profîla lêgerînê were jêbirin?",yesDelete:"🗑 Erê, jê bibe",paused:"⏸ Profîlên lêgerîna te hatin rawestandin.",resumed:"▶️ Profîlên lêgerîna te dîsa çalak in.",status:"📡 Rewş",activeProfiles:"Profîlên çalak",activeSources:"Çavkaniyên çalak",online:"Pergal: serhêl",
  helpText:"/suche – lêgerînek nû çêke\n/profile – profîlên lêgerînê birêve bibe\n/gespeichert – îlanên tomarkirî\n/einstellungen – ziman\n/pause – hemû lêgerînan rawestîne\n/resume – hemû lêgerînan çalak bike\n/status – rewşa pergalê",useButtons:"Ji kerema xwe bişkokên bin peyamê bikar bîne.",chooseType:"Ji kerema xwe kêmî yek vebijêre.",chooseBError:"Ji kerema xwe kêmî herêmek hilbijêre.",chooseNOne:"Ji kerema xwe kêmî taxek hilbijêre.",invalidArea:"Rûberek di navbera 8 û 1000 m² de binivîse.",invalidName:"Kêmî 2 tîp binivîse.",noSaved:"Hêj îlanek tomarkirî tune.",page:"Rûpel",listingUnavailable:"Îlan ne berdest e.",
  offer:"🔗 Îlan",maps:"📍 Google Maps",save:"💾 Tomar bike",savedState:"✅ Hat tomarkirin",removed:"Hat rakirin",warm:"Kirêya giştî",cold:"Kirêya bingehîn",additional:"Mesrefên din",operating:"Mesrefên xebitandinê",heating:"Mesrefên germkirinê",deposit:"Depozîto",area:"Rûbera jiyanê",rooms:"Ode",address:"Navnîşan",typeApartment:"Apartman",typeHouse:"Mal",typeWG:"Mala hevpar",typeSwap:"Apartmana guherandinê"
};

const OVERRIDES:Record<string,Dict>={prs,bad};
const FAMILY_FALLBACK:Record<string,string>={prs:"fa",bad:"ku"};

export function msg(lang:string|null|undefined,key:string){
  const normalizedKey=key==="chooseB"?"chooseBPrompt":key;
  const code=lang&&LANGS[lang]?lang:"de";
  const exact=OVERRIDES[code]?.[normalizedKey];
  if(exact)return exact;
  const value=baseMsg(code,normalizedKey);
  if(code!=="en"&&normalizedKey!=="maps"&&value===baseMsg("en",normalizedKey)&&FAMILY_FALLBACK[code]){
    return baseMsg(FAMILY_FALLBACK[code],normalizedKey);
  }
  return value;
}

export function typeLabel(lang:string|null|undefined,value:string){
  return msg(lang,value==="Wohnung"?"typeApartment":value==="Haus"?"typeHouse":value==="WG"?"typeWG":"typeSwap");
}
