import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
export const LANGS: Record<string, string> = {
  de: "🇩🇪 Deutsch",
  en: "🇬🇧 English",
  tr: "🇹🇷 Türkçe",
  ar: "🇸🇦 العربية",
  fa: "🇮🇷 فارسی",
  prs: "🇦🇫 دری",
  ps: "🇦🇫 پښتو / Pashto",
  ckb: "☀️ کوردی (سۆرانی)",
  ku: "☀️ Kurdî (Kurmancî)",
  bad: "☀️ Kurdî (Badînî)",
};

export const TXT: Record<string, Record<string, string>> = {
  de: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nFinde passende Wohnungen automatisiert in ganz Hamburg. Erstelle in wenigen Schritten dein persönliches Suchprofil.",
    create: "🔎 Suche erstellen", back: "⬅️ Zurück", confirm: "Auswahl bestätigen", all: "Alle auswählen",
    types: "1/4 · <b>Was suchst du?</b>\n\nDu kannst mehrere Optionen auswählen.",
    location: "2/4 · <b>Wo möchtest du suchen?</b>", allhh: "🌐 Ganz Hamburg", boroughs: "🏙 Bezirke auswählen", neighborhoods: "📍 Stadtteile auswählen",
    chooseB: "Wähle einen oder mehrere der 7 Hamburger Bezirke.", chooseN: "Wähle beliebig viele Stadtteile. Alle 104 bestehenden Stadtteile werden berücksichtigt.",
    all104: "Alle 104 auswählen", clear: "Auswahl löschen", rent: "3/4 · <b>Maximale Warmmiete</b>", custom: "✏️ Eigener Betrag",
    enter: "Gib deine maximale Warmmiete als Zahl ein, z. B. <code>1250</code>.", area: "4/4 · <b>Mindestfläche</b>", none: "Keine Mindestfläche",
    review: "✅ <b>Suchprofil prüfen</b>", activate: "✅ Suche aktivieren", settings: "⚙️ Einstellungen", language: "🌐 Sprache",
    saved: "💾 Gespeicherte Inserate", nosaved: "Du hast noch keine Inserate gespeichert.", created: "✅ Deine Suche ist aktiv. Neue passende Inserate werden automatisch zugestellt.",
    use: "Bitte verwende die Buttons unter der Nachricht.", save: "💾 Speichern", savedState: "✅ Gespeichert", maps: "📍 Google Maps", openSaved: "Inserat anzeigen",
    missing: "nicht angegeben", coldRent: "Kaltmiete", warmRent: "Warmmiete", heating: "Heizkosten", additional: "Nebenkosten", deposit: "Kaution", address: "Adresse", rooms: "Zimmer", areaLabel: "Fläche",
  },
  en: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nFind matching homes automatically across Hamburg and create your search profile in a few steps.",
    create: "🔎 Create search", back: "⬅️ Back", confirm: "Confirm", all: "Select all", types: "1/4 · <b>What are you looking for?</b>\n\nYou can select multiple options.",
    location: "2/4 · <b>Where do you want to search?</b>", allhh: "🌐 All Hamburg", boroughs: "🏙 Select boroughs", neighborhoods: "📍 Select neighborhoods",
    chooseB: "Select one or more of Hamburg's 7 boroughs.", chooseN: "Select any neighborhoods. All 104 existing neighborhoods are included.", all104: "Select all 104", clear: "Clear selection",
    rent: "3/4 · <b>Maximum warm rent</b>", custom: "✏️ Custom amount", enter: "Enter your maximum warm rent, e.g. <code>1250</code>.", area: "4/4 · <b>Minimum area</b>", none: "No minimum",
    review: "✅ <b>Review search profile</b>", activate: "✅ Activate search", settings: "⚙️ Settings", language: "🌐 Language", saved: "💾 Saved listings", nosaved: "You have no saved listings yet.",
    created: "✅ Your search is active. New matching listings will be delivered automatically.", use: "Please use the buttons below the message.", save: "💾 Save", savedState: "✅ Saved", maps: "📍 Google Maps", openSaved: "Show listing",
    missing: "not provided", coldRent: "Cold rent", warmRent: "Warm rent", heating: "Heating", additional: "Additional costs", deposit: "Deposit", address: "Address", rooms: "Rooms", areaLabel: "Area",
  },
  tr: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nHamburg genelinde uygun evleri otomatik bulun ve arama profilinizi birkaç adımda oluşturun.",
    create: "🔎 Arama oluştur", back: "⬅️ Geri", confirm: "Onayla", all: "Tümünü seç", types: "1/4 · <b>Ne arıyorsunuz?</b>\n\nBirden fazla seçenek seçebilirsiniz.",
    location: "2/4 · <b>Nerede aramak istiyorsunuz?</b>", allhh: "🌐 Tüm Hamburg", boroughs: "🏙 İlçeleri seç", neighborhoods: "📍 Semtleri seç", chooseB: "Hamburg'un 7 ilçesinden bir veya birkaçını seçin.",
    chooseN: "İstediğiniz semtleri seçin. Mevcut 104 semtin tamamı dahildir.", all104: "104'ünü seç", clear: "Seçimi temizle", rent: "3/4 · <b>Maksimum sıcak kira</b>", custom: "✏️ Özel tutar",
    enter: "Maksimum sıcak kirayı girin, ör. <code>1250</code>.", area: "4/4 · <b>Minimum alan</b>", none: "Minimum yok", review: "✅ <b>Arama profilini kontrol et</b>", activate: "✅ Aramayı etkinleştir",
    settings: "⚙️ Ayarlar", language: "🌐 Dil", saved: "💾 Kaydedilen ilanlar", nosaved: "Henüz kayıtlı ilanınız yok.", created: "✅ Aramanız aktif. Yeni uygun ilanlar otomatik gönderilecek.", use: "Lütfen mesajın altındaki düğmeleri kullanın.",
    save: "💾 Kaydet", savedState: "✅ Kaydedildi", maps: "📍 Google Maps", openSaved: "İlanı göster", missing: "belirtilmedi", coldRent: "Soğuk kira", warmRent: "Sıcak kira", heating: "Isıtma", additional: "Ek giderler", deposit: "Depozito", address: "Adres", rooms: "Oda", areaLabel: "Alan",
  },
  ar: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nاعثر تلقائياً على السكن المناسب في جميع أنحاء هامبورغ وأنشئ ملف البحث بخطوات قليلة.",
    create: "🔎 إنشاء بحث", back: "⬅️ رجوع", confirm: "تأكيد", all: "اختيار الكل", types: "1/4 · <b>ماذا تبحث؟</b>\n\nيمكنك اختيار عدة خيارات.", location: "2/4 · <b>أين تريد البحث؟</b>",
    allhh: "🌐 كل هامبورغ", boroughs: "🏙 اختيار المناطق", neighborhoods: "📍 اختيار الأحياء", chooseB: "اختر منطقة أو أكثر من مناطق هامبورغ السبع.", chooseN: "اختر الأحياء المطلوبة. جميع الأحياء الـ104 الحالية مدرجة.",
    all104: "اختيار 104 كلها", clear: "مسح الاختيار", rent: "3/4 · <b>الحد الأقصى للإيجار الدافئ</b>", custom: "✏️ مبلغ مخصص", enter: "أدخل الحد الأقصى للإيجار، مثال <code>1250</code>.", area: "4/4 · <b>الحد الأدنى للمساحة</b>",
    none: "بدون حد أدنى", review: "✅ <b>مراجعة ملف البحث</b>", activate: "✅ تفعيل البحث", settings: "⚙️ الإعدادات", language: "🌐 اللغة", saved: "💾 الإعلانات المحفوظة", nosaved: "لا توجد إعلانات محفوظة بعد.",
    created: "✅ تم تفعيل البحث. ستصلك الإعلانات الجديدة المطابقة تلقائياً.", use: "يرجى استخدام الأزرار أسفل الرسالة.", save: "💾 حفظ", savedState: "✅ محفوظ", maps: "📍 Google Maps", openSaved: "عرض الإعلان", missing: "غير مذكور",
    coldRent: "الإيجار الأساسي", warmRent: "الإيجار الشامل", heating: "التدفئة", additional: "التكاليف الإضافية", deposit: "التأمين", address: "العنوان", rooms: "الغرف", areaLabel: "المساحة",
  },
  fa: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nخانه‌های مناسب را در سراسر هامبورگ به‌صورت خودکار پیدا کنید و پروفایل جست‌وجوی خود را بسازید.",
    create: "🔎 ایجاد جست‌وجو", back: "⬅️ بازگشت", confirm: "تأیید", all: "انتخاب همه", types: "1/4 · <b>دنبال چه هستید؟</b>\n\nمی‌توانید چند گزینه انتخاب کنید.", location: "2/4 · <b>کجا می‌خواهید جست‌وجو کنید؟</b>",
    allhh: "🌐 کل هامبورگ", boroughs: "🏙 انتخاب مناطق", neighborhoods: "📍 انتخاب محله‌ها", chooseB: "یک یا چند مورد از ۷ منطقه هامبورگ را انتخاب کنید.", chooseN: "محله‌های موردنظر را انتخاب کنید. همه ۱۰۴ محله موجود لحاظ می‌شوند.",
    all104: "انتخاب هر ۱۰۴", clear: "پاک کردن انتخاب", rent: "3/4 · <b>حداکثر اجاره گرم</b>", custom: "✏️ مبلغ دلخواه", enter: "حداکثر اجاره گرم را وارد کنید، مثال <code>1250</code>.", area: "4/4 · <b>حداقل متراژ</b>", none: "بدون حداقل",
    review: "✅ <b>بررسی پروفایل جست‌وجو</b>", activate: "✅ فعال‌کردن جست‌وجو", settings: "⚙️ تنظیمات", language: "🌐 زبان", saved: "💾 آگهی‌های ذخیره‌شده", nosaved: "هنوز آگهی ذخیره‌شده‌ای ندارید.",
    created: "✅ جست‌وجوی شما فعال است. آگهی‌های جدید مطابق به‌صورت خودکار ارسال می‌شوند.", use: "لطفاً از دکمه‌های زیر پیام استفاده کنید.", save: "💾 ذخیره", savedState: "✅ ذخیره شد", maps: "📍 Google Maps", openSaved: "نمایش آگهی", missing: "ذکر نشده",
    coldRent: "اجاره پایه", warmRent: "اجاره گرم", heating: "هزینه گرمایش", additional: "هزینه‌های جانبی", deposit: "ودیعه", address: "آدرس", rooms: "اتاق", areaLabel: "متراژ",
  },
  prs: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nخانه مناسب را در سراسر هامبورگ به‌صورت خودکار پیدا کنید و پروفایل جست‌وجوی خود را بسازید.", create: "🔎 ایجاد جست‌وجو", back: "⬅️ برگشت", confirm: "تأیید", all: "انتخاب همه",
    types: "1/4 · <b>دنبال چه نوع خانه هستید؟</b>", location: "2/4 · <b>در کجا جست‌وجو شود؟</b>", allhh: "🌐 تمام هامبورگ", boroughs: "🏙 انتخاب مناطق", neighborhoods: "📍 انتخاب محله‌ها", chooseB: "یک یا چند منطقه از ۷ منطقه هامبورگ را انتخاب کنید.",
    chooseN: "محله‌های دلخواه را انتخاب کنید. هر ۱۰۴ محله موجود شامل است.", all104: "انتخاب همه ۱۰۴", clear: "پاک‌کردن", rent: "3/4 · <b>حداکثر کرایه گرم</b>", custom: "✏️ مبلغ دلخواه", enter: "حداکثر کرایه را وارد کنید، مثال <code>1250</code>.",
    area: "4/4 · <b>حداقل مساحت</b>", none: "بدون حداقل", review: "✅ <b>بررسی پروفایل</b>", activate: "✅ فعال‌سازی", settings: "⚙️ تنظیمات", language: "🌐 زبان", saved: "💾 آگهی‌های ذخیره‌شده", nosaved: "هنوز آگهی ذخیره‌شده ندارید.",
    created: "✅ جست‌وجوی شما فعال است.", use: "لطفاً از دکمه‌های زیر پیام استفاده کنید.", save: "💾 ذخیره", savedState: "✅ ذخیره شد", maps: "📍 Google Maps", openSaved: "نمایش آگهی", missing: "ذکر نشده", coldRent: "کرایه پایه", warmRent: "کرایه گرم", heating: "گرمایش", additional: "مصارف جانبی", deposit: "تضمین", address: "آدرس", rooms: "اتاق", areaLabel: "مساحت",
  },
  ps: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nپه ټول هامبورګ کې مناسب کورونه په اتومات ډول ومومئ او خپل د لټون پروفایل جوړ کړئ.", create: "🔎 لټون جوړول", back: "⬅️ شاته", confirm: "تایید", all: "ټول وټاکئ", types: "1/4 · <b>څه لټوئ؟</b>",
    location: "2/4 · <b>چېرته لټون کول غواړئ؟</b>", allhh: "🌐 ټول هامبورګ", boroughs: "🏙 ولسوالۍ وټاکئ", neighborhoods: "📍 سیمې وټاکئ", chooseB: "د هامبورګ له ۷ ولسوالیو څخه یوه یا څو وټاکئ.", chooseN: "هرې سیمې چې غواړئ وټاکئ. ټولې ۱۰۴ سیمې شاملې دي.",
    all104: "ټولې ۱۰۴ وټاکئ", clear: "پاکول", rent: "3/4 · <b>اعظمي ګرم کرایه</b>", custom: "✏️ خپله اندازه", enter: "اعظمي کرایه ولیکئ، لکه <code>1250</code>.", area: "4/4 · <b>لږ تر لږه مساحت</b>", none: "حد نشته", review: "✅ <b>پروفایل وګورئ</b>",
    activate: "✅ لټون فعال کړئ", settings: "⚙️ تنظیمات", language: "🌐 ژبه", saved: "💾 خوندي اعلانونه", nosaved: "تر اوسه خوندي اعلان نشته.", created: "✅ ستاسو لټون فعال دی.", use: "د پیغام لاندې تڼۍ وکاروئ.", save: "💾 خوندي", savedState: "✅ خوندي", maps: "📍 Google Maps", openSaved: "اعلان ښکاره کړه", missing: "نه دی ښودل شوی", coldRent: "اساسي کرایه", warmRent: "ګرم کرایه", heating: "تودوخه", additional: "اضافي لګښتونه", deposit: "ضمانت", address: "پته", rooms: "خونې", areaLabel: "مساحت",
  },
  ckb: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nلە هەموو هامبۆرگدا بە شێوەی ئۆتۆماتیکی خانووی گونجاو بدۆزەوە و پڕۆفایلی گەڕانت دروست بکە.", create: "🔎 دروستکردنی گەڕان", back: "⬅️ گەڕانەوە", confirm: "پشتڕاستکردنەوە", all: "هەمووی هەڵبژێرە",
    types: "1/4 · <b>بەدوای چی دەگەڕێیت؟</b>", location: "2/4 · <b>لە کوێ دەگەڕێیت؟</b>", allhh: "🌐 هەموو هامبۆرگ", boroughs: "🏙 ناوچەکان", neighborhoods: "📍 گەڕەکەکان", chooseB: "یەک یان چەند ناوچە لە ٧ ناوچەی هامبۆرگ هەڵبژێرە.", chooseN: "گەڕەکەکان هەڵبژێرە. هەموو ١٠٤ گەڕەک لەبەرچاو دەگیرێن.",
    all104: "هەموو ١٠٤", clear: "سڕینەوە", rent: "3/4 · <b>زۆرترین کرێی گەرم</b>", custom: "✏️ بڕی تایبەت", enter: "زۆرترین کرێ بنووسە، بۆ نموونە <code>1250</code>.", area: "4/4 · <b>کەمترین ڕووبەر</b>", none: "بێ سنوور", review: "✅ <b>پشکنینی پڕۆفایل</b>", activate: "✅ چالاککردنی گەڕان", settings: "⚙️ ڕێکخستنەکان", language: "🌐 زمان", saved: "💾 پاشەکەوتکراوەکان", nosaved: "هێشتا هیچت پاشەکەوت نەکردووە.", created: "✅ گەڕانت چالاکە.", use: "دوگمەکانی ژێر پەیام بەکاربهێنە.", save: "💾 پاشەکەوت", savedState: "✅ پاشەکەوتکرا", maps: "📍 Google Maps", openSaved: "پیشاندانی ڕیکلام", missing: "نەدراوە", coldRent: "کرێی سارد", warmRent: "کرێی گەرم", heating: "گەرما", additional: "خەرجی زیادە", deposit: "بارمتە", address: "ناونیشان", rooms: "ژوور", areaLabel: "ڕووبەر",
  },
  ku: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nLi hemû Hamburgê xaniyên guncaw bixweber bibîne û profîla lêgerînê ava bike.", create: "🔎 Lêgerînê biafirîne", back: "⬅️ Paş", confirm: "Piştrast bike", all: "Hemû hilbijêre", types: "1/4 · <b>Tu li çi digerî?</b>",
    location: "2/4 · <b>Li ku derê bigere?</b>", allhh: "🌐 Hemû Hamburg", boroughs: "🏙 Herêm hilbijêre", neighborhoods: "📍 Tax hilbijêre", chooseB: "Ji 7 herêmên Hamburgê yek an çend hilbijêre.", chooseN: "Taxên ku dixwazî hilbijêre. Hemû 104 tax têne hesibandin.",
    all104: "Hemû 104", clear: "Paqij bike", rent: "3/4 · <b>Herî zêde kirêya germ</b>", custom: "✏️ Meblaqa xwe", enter: "Kirêya germ binivîse, mînak <code>1250</code>.", area: "4/4 · <b>Kêmtirîn rûber</b>", none: "Bê sînor", review: "✅ <b>Profîlê kontrol bike</b>", activate: "✅ Lêgerînê çalak bike", settings: "⚙️ Mîheng", language: "🌐 Ziman", saved: "💾 Îlanên tomar kirî", nosaved: "Hêj îlanek tomar nekiriye.", created: "✅ Lêgerîna te çalak e.", use: "Bişkokên binê peyamê bikar bîne.", save: "💾 Tomar bike", savedState: "✅ Tomarkirî", maps: "📍 Google Maps", openSaved: "Îlanê nîşan bide", missing: "nehatiye dayîn", coldRent: "Kirêya sar", warmRent: "Kirêya germ", heating: "Germkirin", additional: "Mesrefên din", deposit: "Depozîto", address: "Navnîşan", rooms: "Ode", areaLabel: "Rûber",
  },
  bad: {
    welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nLi hemû Hamburgê malên guncaw bixweber bibîne û profîla lêgerînê çêke.", create: "🔎 Lêgerîn çêke", back: "⬅️ Paş", confirm: "Piştrast bike", all: "Hemû hilbijêre", types: "1/4 · <b>Tu li çi digerî?</b>",
    location: "2/4 · <b>Li ku derê bigere?</b>", allhh: "🌐 Hemû Hamburg", boroughs: "🏙 Herêm hilbijêre", neighborhoods: "📍 Tax hilbijêre", chooseB: "Ji 7 herêmên Hamburgê yek an çend hilbijêre.", chooseN: "Taxên ku dixwazî hilbijêre. Hemû 104 tax têne hesibandin.",
    all104: "Hemû 104", clear: "Paqij bike", rent: "3/4 · <b>Herî zêde kirêya germ</b>", custom: "✏️ Meblaqa xwe", enter: "Kirêya germ binivîse, mînak <code>1250</code>.", area: "4/4 · <b>Kêmtirîn rûber</b>", none: "Bê sînor", review: "✅ <b>Profîlê kontrol bike</b>", activate: "✅ Lêgerînê çalak bike", settings: "⚙️ Mîheng", language: "🌐 Ziman", saved: "💾 Îlanên tomar kirî", nosaved: "Hêj îlanek tomar nekiriye.", created: "✅ Lêgerîna te çalak e.", use: "Bişkokên binê peyamê bikar bîne.", save: "💾 Tomar bike", savedState: "✅ Tomarkirî", maps: "📍 Google Maps", openSaved: "Îlanê nîşan bide", missing: "nehatiye dayîn", coldRent: "Kirêya sar", warmRent: "Kirêya germ", heating: "Germkirin", additional: "Mesrefên din", deposit: "Depozîto", address: "Navnîşan", rooms: "Ode", areaLabel: "Rûber",
  },
};

export function textFor(language: string | null | undefined, key: string) {
  const lang = language && TXT[language] ? language : "de";
  return TXT[lang]?.[key] || TXT.de[key] || key;
}


LANGS.ru = "🇷🇺 Русский";
TXT.ru = {
  welcome: "🏠 <b>Traumwohnung Hamburg</b>\n\nАвтоматически находите подходящую аренду по всему Гамбургу.",
  create: "🔎 Создать поиск", back: "← Назад", confirm: "Подтвердить", all: "Выбрать всё",
  types: "1/5 · <b>Что вы ищете?</b>\n\nМожно выбрать несколько вариантов.", location: "2/5 · <b>Где вы хотите искать?</b>", allhh: "🌐 Весь Гамбург", boroughs: "🏙 Выбрать округа", neighborhoods: "📍 Выбрать районы",
  chooseB: "Выберите один или несколько из 7 округов Гамбурга.", chooseN: "Выберите нужные районы.", all104: "Выбрать все", clear: "Очистить выбор", rent: "3/5 · <b>Максимальная аренда с коммунальными</b>", custom: "✏️ Своя сумма",
  enter: "Введите максимальную аренду, например <code>1250</code>.", area: "5/5 · <b>Минимальная площадь</b>", none: "Без минимума", review: "✅ <b>Проверить профиль поиска</b>", activate: "✅ Активировать поиск", settings: "⚙️ Настройки", language: "🌐 Язык",
  saved: "⭐️ Сохранённые объявления", nosaved: "Сохранённых объявлений пока нет.", created: "✅ Поиск активен. Новые подходящие объявления будут доставляться автоматически.", use: "Используйте кнопки под сообщением.", save: "⭐️ Сохранить", savedState: "⭐️ Сохранено", maps: "📍 Google Maps", openSaved: "Открыть объявление",
  missing: "не указано", coldRent: "Холодная аренда", warmRent: "Аренда с коммунальными", heating: "Отопление", additional: "Дополнительные расходы", deposit: "Залог", address: "Адрес", rooms: "Комнаты", areaLabel: "Площадь",
};

delete LANGS.ps;
delete LANGS.bad;
for (const lang of Object.keys(TXT)) {
  for (const [a,b] of [["1/4","1/5"],["2/4","2/5"],["3/4","3/5"],["4/4","5/5"]]) {
    for (const key of Object.keys(TXT[lang] || {})) TXT[lang][key] = String(TXT[lang][key]).replace(a,b);
  }
  if (TXT[lang]?.save) TXT[lang].save = TXT[lang].save.replace("💾", "⭐️");
  if (TXT[lang]?.saved) TXT[lang].saved = TXT[lang].saved.replace("💾", "⭐️");
  if (TXT[lang]?.savedState) TXT[lang].savedState = TXT[lang].savedState.replace("✅", "⭐️").replace("💾", "⭐️");
}

const EXTRA: Record<string, Record<string,string>> = {
  en: {"Suchprofil":"Search profile","Meine Suchprofile":"My search profiles","Suchprofile angelegt":"search profiles created","Suchprofile aktiv":"Active search profiles","Premium aktiv":"Premium active","Traumwohnung Premium":"Traumwohnung Premium","Premium ist aktiv.":"Premium is active.","Deine Vorteile:":"Your benefits:","Sofortige Zustellung":"Instant delivery","Bis zu 3 Suchprofile":"Up to 3 search profiles","Baugenossenschafts-Angebote öffnen":"Open housing-cooperative listings","Inserate speichern":"Save listings","Keine Mindestlaufzeit · jederzeit kündbar":"No minimum term · cancel anytime","Premium freischalten":"Unlock Premium","Abo verwalten":"Manage subscription","Freunde empfehlen":"Refer friends","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos":"Recommend Traumwohnung Hamburg and you both receive 7 days Premium for free","Erfolgreiche Empfehlungen":"Successful referrals","Sprachen":"Languages","Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.":"Choose your language. The complete bot menu will be shown accordingly.","Quellen im System":"Sources in the system","Systemstatus":"System status","System: online":"System: online","Suchprofil erstellen":"Create search profile","Noch kein Suchprofil angelegt.":"No search profile yet.","Suchprofil ändern":"Edit search profile","Pausieren":"Pause","Fortsetzen":"Resume","Gespeichert":"Saved","Hilfe":"Help","Status":"Status","Einstellungen":"Settings","Entwurf fortsetzen":"Continue draft"},
  tr: {"Suchprofil":"Arama profili","Meine Suchprofile":"Arama profillerim","Suchprofile angelegt":"arama profili oluşturuldu","Suchprofile aktiv":"Aktif arama profilleri","Premium aktiv":"Premium aktif","Premium ist aktiv.":"Premium aktif.","Deine Vorteile:":"Avantajların:","Sofortige Zustellung":"Anında teslim","Bis zu 3 Suchprofile":"3 arama profiline kadar","Baugenossenschafts-Angebote öffnen":"Konut kooperatifi ilanlarını aç","Inserate speichern":"İlanları kaydet","Keine Mindestlaufzeit · jederzeit kündbar":"Minimum süre yok · istediğin zaman iptal","Premium freischalten":"Premium'u aç","Abo verwalten":"Aboneliği yönet","Freunde empfehlen":"Arkadaşlarını davet et","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos":"Traumwohnung Hamburg'u önerin; ikiniz de 7 gün Premium'u ücretsiz alın","Erfolgreiche Empfehlungen":"Başarılı davetler","Sprachen":"Diller","Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.":"Dilini seç. Bot menüsünün tamamı buna göre gösterilir.","Quellen im System":"Sistemdeki kaynaklar","Systemstatus":"Sistem durumu","System: online":"Sistem: çevrimiçi","Suchprofil erstellen":"Arama profili oluştur","Noch kein Suchprofil angelegt.":"Henüz arama profili yok.","Suchprofil ändern":"Arama profilini düzenle","Pausieren":"Duraklat","Fortsetzen":"Devam et","Gespeichert":"Kaydedildi","Hilfe":"Yardım","Status":"Durum","Einstellungen":"Ayarlar","Entwurf fortsetzen":"Taslağa devam et"},
  ru: {"Suchprofil":"Профиль поиска","Meine Suchprofile":"Мои профили поиска","Suchprofile angelegt":"профилей поиска создано","Suchprofile aktiv":"Активные профили поиска","Premium aktiv":"Premium активен","Premium ist aktiv.":"Premium активен.","Deine Vorteile:":"Ваши преимущества:","Sofortige Zustellung":"Мгновенная доставка","Bis zu 3 Suchprofile":"До 3 профилей поиска","Baugenossenschafts-Angebote öffnen":"Открывать объявления жилищных кооперативов","Inserate speichern":"Сохранять объявления","Keine Mindestlaufzeit · jederzeit kündbar":"Без минимального срока · отмена в любое время","Premium freischalten":"Подключить Premium","Abo verwalten":"Управлять подпиской","Freunde empfehlen":"Пригласить друзей","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos":"Порекомендуйте Traumwohnung Hamburg — вы оба получите 7 дней Premium бесплатно","Erfolgreiche Empfehlungen":"Успешные рекомендации","Sprachen":"Языки","Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.":"Выберите язык. Всё меню бота будет показано на нём.","Quellen im System":"Источники в системе","Systemstatus":"Статус системы","System: online":"Система: онлайн","Suchprofil erstellen":"Создать профиль поиска","Noch kein Suchprofil angelegt.":"Профиль поиска пока не создан.","Suchprofil ändern":"Изменить профиль поиска","Pausieren":"Пауза","Fortsetzen":"Продолжить","Gespeichert":"Сохранено","Hilfe":"Помощь","Status":"Статус","Einstellungen":"Настройки","Entwurf fortsetzen":"Продолжить черновик"},
  ar: {"Suchprofil":"ملف البحث","Meine Suchprofile":"ملفات البحث الخاصة بي","Suchprofile angelegt":"ملفات بحث تم إنشاؤها","Suchprofile aktiv":"ملفات البحث النشطة","Premium aktiv":"Premium مفعّل","Premium ist aktiv.":"Premium مفعّل.","Deine Vorteile:":"مزاياك:","Sofortige Zustellung":"إرسال فوري","Bis zu 3 Suchprofile":"حتى 3 ملفات بحث","Baugenossenschafts-Angebote öffnen":"فتح عروض تعاونيات الإسكان","Inserate speichern":"حفظ الإعلانات","Keine Mindestlaufzeit · jederzeit kündbar":"لا توجد مدة دنيا · إلغاء في أي وقت","Premium freischalten":"تفعيل Premium","Abo verwalten":"إدارة الاشتراك","Freunde empfehlen":"دعوة الأصدقاء","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos":"رشّح Traumwohnung Hamburg وسيحصل كلاكما على 7 أيام Premium مجانًا","Erfolgreiche Empfehlungen":"الإحالات الناجحة","Sprachen":"اللغات","Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.":"اختر لغتك. ستظهر قائمة البوت كاملة بهذه اللغة.","Quellen im System":"المصادر في النظام","Systemstatus":"حالة النظام","System: online":"النظام: متصل","Suchprofil erstellen":"إنشاء ملف بحث","Noch kein Suchprofil angelegt.":"لم يتم إنشاء ملف بحث بعد.","Suchprofil ändern":"تعديل ملف البحث","Pausieren":"إيقاف مؤقت","Fortsetzen":"متابعة","Gespeichert":"تم الحفظ","Hilfe":"مساعدة","Status":"الحالة","Einstellungen":"الإعدادات","Entwurf fortsetzen":"متابعة المسودة"},
  fa: {"Suchprofil":"پروفایل جستجو","Meine Suchprofile":"پروفایل‌های جستجوی من","Suchprofile angelegt":"پروفایل جستجو ساخته شده","Suchprofile aktiv":"پروفایل‌های جستجوی فعال","Premium aktiv":"Premium فعال","Premium ist aktiv.":"Premium فعال است.","Deine Vorteile:":"مزایای شما:","Sofortige Zustellung":"ارسال فوری","Bis zu 3 Suchprofile":"تا ۳ پروفایل جستجو","Baugenossenschafts-Angebote öffnen":"باز کردن آگهی‌های تعاونی مسکن","Inserate speichern":"ذخیره آگهی‌ها","Keine Mindestlaufzeit · jederzeit kündbar":"بدون حداقل مدت · لغو در هر زمان","Premium freischalten":"فعال‌سازی Premium","Abo verwalten":"مدیریت اشتراک","Freunde empfehlen":"معرفی به دوستان","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos":"Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۷ روز Premium رایگان دریافت می‌کنید","Erfolgreiche Empfehlungen":"معرفی‌های موفق","Sprachen":"زبان‌ها","Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.":"زبان خود را انتخاب کنید. تمام منوی ربات به آن زبان نمایش داده می‌شود.","Quellen im System":"منابع در سیستم","Systemstatus":"وضعیت سیستم","System: online":"سیستم: آنلاین","Suchprofil erstellen":"ساخت پروفایل جستجو","Noch kein Suchprofil angelegt.":"هنوز پروفایل جستجو ساخته نشده است.","Suchprofil ändern":"ویرایش پروفایل جستجو","Pausieren":"توقف","Fortsetzen":"ادامه","Gespeichert":"ذخیره شد","Hilfe":"راهنما","Status":"وضعیت","Einstellungen":"تنظیمات","Entwurf fortsetzen":"ادامه پیش‌نویس"},
  prs: {"Suchprofil":"پروفایل جستجو","Meine Suchprofile":"پروفایل‌های جستجوی من","Suchprofile angelegt":"پروفایل جستجو ساخته شده","Suchprofile aktiv":"پروفایل‌های جستجوی فعال","Premium aktiv":"Premium فعال","Premium ist aktiv.":"Premium فعال است.","Deine Vorteile:":"مزایای شما:","Sofortige Zustellung":"ارسال فوری","Bis zu 3 Suchprofile":"تا ۳ پروفایل جستجو","Baugenossenschafts-Angebote öffnen":"باز کردن آگهی‌های تعاونی مسکن","Inserate speichern":"ذخیره آگهی‌ها","Keine Mindestlaufzeit · jederzeit kündbar":"بدون حداقل مدت · لغو در هر زمان","Premium freischalten":"فعال‌سازی Premium","Abo verwalten":"مدیریت اشتراک","Freunde empfehlen":"معرفی به دوستان","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos":"Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۷ روز Premium رایگان دریافت می‌کنید","Erfolgreiche Empfehlungen":"معرفی‌های موفق","Sprachen":"زبان‌ها","Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.":"زبان خود را انتخاب کنید. تمام منوی ربات به آن زبان نمایش داده می‌شود.","Quellen im System":"منابع در سیستم","Systemstatus":"وضعیت سیستم","System: online":"سیستم: آنلاین","Suchprofil erstellen":"ساخت پروفایل جستجو","Noch kein Suchprofil angelegt.":"هنوز پروفایل جستجو ساخته نشده است.","Suchprofil ändern":"ویرایش پروفایل جستجو","Pausieren":"توقف","Fortsetzen":"ادامه","Gespeichert":"ذخیره شد","Hilfe":"راهنما","Status":"وضعیت","Einstellungen":"تنظیمات","Entwurf fortsetzen":"ادامه پیش‌نویس"},
  ckb: {"Suchprofil":"پڕۆفایلی گەڕان","Meine Suchprofile":"پڕۆفایلەکانی گەڕانم","Suchprofile angelegt":"پڕۆفایلی گەڕان دروستکراوە","Suchprofile aktiv":"پڕۆفایلە چالاکەکانی گەڕان","Premium aktiv":"Premium چالاک","Premium ist aktiv.":"Premium چالاکە.","Deine Vorteile:":"سوودەکانت:","Sofortige Zustellung":"گەیاندنی دەستبەجێ","Bis zu 3 Suchprofile":"تا ٣ پڕۆفایلی گەڕان","Baugenossenschafts-Angebote öffnen":"کردنەوەی ڕیکلامەکانی کۆمەڵەی نیشتەجێبوون","Inserate speichern":"پاشەکەوتکردنی ڕیکلامەکان","Keine Mindestlaufzeit · jederzeit kündbar":"هیچ ماوەی کەمترین نییە · هەرکات دەتوانیت هەڵبوەشێنیتەوە","Premium freischalten":"Premium چالاک بکە","Abo verwalten":"بەڕێوەبردنی بەشداری","Freunde empfehlen":"هاوڕێ پێشنیار بکە","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos":"Traumwohnung Hamburg پێشنیار بکە و هەردووکتان ٧ ڕۆژ Premium بەخۆڕایی وەردەگرن","Erfolgreiche Empfehlungen":"پێشنیارە سەرکەوتووەکان","Sprachen":"زمانەکان","Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.":"زمانەکەت هەڵبژێرە. هەموو مینیوی بۆت بەو زمانە پیشان دەدرێت.","Quellen im System":"سەرچاوەکان لە سیستەم","Systemstatus":"دۆخی سیستەم","System: online":"سیستەم: ئۆنلاین","Suchprofil erstellen":"دروستکردنی پڕۆفایلی گەڕان","Noch kein Suchprofil angelegt.":"هێشتا پڕۆفایلی گەڕان دروست نەکراوە.","Suchprofil ändern":"دەستکاریکردنی پڕۆفایلی گەڕان","Pausieren":"وەستاندن","Fortsetzen":"بەردەوامبوون","Gespeichert":"پاشەکەوتکرا","Hilfe":"یارمەتی","Status":"دۆخ","Einstellungen":"ڕێکخستنەکان","Entwurf fortsetzen":"بەردەوامبوون لە ڕەشنووس"},
  ku: {"Suchprofil":"Profîla lêgerînê","Meine Suchprofile":"Profîlên lêgerîna min","Suchprofile angelegt":"profîlên lêgerînê hatine çêkirin","Suchprofile aktiv":"Profîlên lêgerînê yên çalak","Premium aktiv":"Premium çalak","Premium ist aktiv.":"Premium çalak e.","Deine Vorteile:":"Feydeyên te:","Sofortige Zustellung":"Şandina yekser","Bis zu 3 Suchprofile":"Heta 3 profîlên lêgerînê","Baugenossenschafts-Angebote öffnen":"Îlanên kooperatîfên xanî vekin","Inserate speichern":"Îlanan tomar bike","Keine Mindestlaufzeit · jederzeit kündbar":"Demê herî kêm tune · her dem dikarî betal bikî","Premium freischalten":"Premium çalak bike","Abo verwalten":"Abonetiya birêve bibe","Freunde empfehlen":"Hevalan pêşniyar bike","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos":"Traumwohnung Hamburg pêşniyar bike û hûn herdu 7 roj Premium belaş bistînin","Erfolgreiche Empfehlungen":"Pêşniyarên serketî","Sprachen":"Ziman","Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.":"Zimanê xwe hilbijêre. Hemû menuya botê bi wî zimanî tê nîşandan.","Quellen im System":"Çavkanî di pergalê de","Systemstatus":"Rewşa pergalê","System: online":"Pergal: online","Suchprofil erstellen":"Profîla lêgerînê biafirîne","Noch kein Suchprofil angelegt.":"Hîn profîlek lêgerînê tune.","Suchprofil ändern":"Profîla lêgerînê biguherîne","Pausieren":"Rawestîne","Fortsetzen":"Bidomîne","Gespeichert":"Tomarkirî","Hilfe":"Alîkarî","Status":"Rewş","Einstellungen":"Mîheng","Entwurf fortsetzen":"Pêşnivîsê bidomîne"},
};


Object.assign(EXTRA.en, {"30 Tage Premium für 0 €":"30 days Premium for €0","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Recommend Traumwohnung Hamburg and you both receive 30 days Premium for free 💎","Abbrechen":"Cancel"});
Object.assign(EXTRA.tr, {"30 Tage Premium für 0 €":"0 €'ya 30 Gün Premium","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg'u önerin; ikiniz de 30 gün Premium'u ücretsiz alın 💎","Abbrechen":"İptal"});
Object.assign(EXTRA.ru, {"30 Tage Premium für 0 €":"30 дней Premium за 0 €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Порекомендуйте Traumwohnung Hamburg — вы оба получите 30 дней Premium бесплатно 💎","Abbrechen":"Отмена"});
Object.assign(EXTRA.ar, {"30 Tage Premium für 0 €":"30 يوم Premium مقابل 0 €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"رشّح Traumwohnung Hamburg وسيحصل كلاكما على 30 يومًا من Premium مجانًا 💎","Abbrechen":"إلغاء"});
Object.assign(EXTRA.fa, {"30 Tage Premium für 0 €":"۳۰ روز Premium با ۰ €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۳۰ روز Premium رایگان دریافت می‌کنید 💎","Abbrechen":"لغو"});
Object.assign(EXTRA.prs, {"30 Tage Premium für 0 €":"۳۰ روز Premium با ۰ €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۳۰ روز Premium رایگان دریافت می‌کنید 💎","Abbrechen":"لغو"});
Object.assign(EXTRA.ckb, {"30 Tage Premium für 0 €":"٣٠ ڕۆژ Premium بە ٠ €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg پێشنیار بکە و هەردووکتان ٣٠ ڕۆژ Premium بەخۆڕایی وەردەگرن 💎","Abbrechen":"هەڵوەشاندنەوە"});
Object.assign(EXTRA.ku, {"30 Tage Premium für 0 €":"30 roj Premium bi 0 €","Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎":"Traumwohnung Hamburg pêşniyar bike û hûn herdu 30 roj Premium belaş bistînin 💎","Abbrechen":"Betal bike"});

const CURRENT_ALIASES: Array<[string,string]> = [
  ["🏠 <b>Traumwohnung Hamburg</b>\n\nFinde passende Mietangebote in Hamburg – automatisch und direkt per Telegram.\n\nWähle unten, was du machen möchtest.", "welcome"],
  ["1/5 · <b>Was suchst du?</b>\n\nWähle eine oder mehrere Wohnungsarten.", "types"],
  ["2/5 · <b>Wo möchtest du suchen?</b>", "location"],
  ["Wähle einen oder mehrere der 7 Bezirke.", "chooseB"],
  ["Wähle beliebig viele Stadtteile.", "chooseN"],
  ["3/5 · <b>Maximale Warmmiete</b>", "rent"],
  ["5/5 · <b>Mindestfläche</b>", "area"],
  ["✅ <b>Suchprofil prüfen</b>", "review"],
  ["✅ Suche aktivieren", "activate"],
  ["← Zurück", "back"], ["Alle auswählen", "all"], ["Auswahl löschen", "clear"],
  ["✏️ Eigener Betrag", "custom"], ["⭐️ Gespeicherte Inserate", "saved"], ["⭐️ Gespeichert", "savedState"], ["⭐️ Speichern", "save"], ["📍 Google Maps", "maps"],
];

export function localizeText(text: string, language: string | null | undefined) {
  const lang = language && TXT[language] ? language : "de";
  if (lang === "de") return text;
  let out = text;
  for (const [from,key] of CURRENT_ALIASES.sort((a,b)=>b[0].length-a[0].length)) out = out.split(from).join(TXT[lang]?.[key] || from);
  const extra = EXTRA[lang] || {};
  for (const from of Object.keys(extra).sort((a,b)=>b.length-a.length)) out = out.split(from).join(extra[from]);
  return out;
}

export function localizeMarkup(markup: any, language: string | null | undefined) {
  if (!markup || typeof markup !== "object") return markup;
  const copy = structuredClone(markup);
  if (Array.isArray(copy.inline_keyboard)) for (const row of copy.inline_keyboard) for (const item of row || []) if (item?.text) item.text = localizeText(String(item.text), language);
  return copy;
}


type PropertyType = "Wohnung" | "Haus" | "WG" | "Tauschwohnung";
type LocationMode = "all_hamburg" | "boroughs" | "neighborhoods";
type AdminGrant = "free" | "7d" | "30d" | "3m" | "life";
type OnboardingStep =
  | "types"
  | "location"
  | "boroughs"
  | "neighborhoods"
  | "rent"
  | "rent_custom"
  | "rooms"
  | "area"
  | "review";

type Draft = {
  property_types: PropertyType[];
  location_mode: LocationMode | null;
  borough_ids: number[];
  neighborhood_ids: number[];
  neighborhood_page: number;
  max_warm_rent: number | null;
  min_rooms: number | null;
  min_area_sqm: number | null;
  profile_slot: number;
  edit_return?: boolean;
  profile_edit?: boolean;
};

type Geography = {
  boroughs: Array<{ id: number; name: string; sort_order?: number }>;
  neighborhoods: Array<{ id: number; name: string; borough_id: number }>;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SERVICE_KEY =
  SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PREMIUM_LINK = "https://buy.stripe.com/dRm9AM7DSajfgYK2qVfYY01";
const PREMIUM_PREVIEW_B64 = "";
const PROPERTY_TYPES: PropertyType[] = [
  "Wohnung",
  "Haus",
  "WG",
  "Tauschwohnung",
];
const RENT_PRESETS = new Set([800, 1000, 1250, 2000]);
const ROOM_PRESETS = new Set([1, 2, 3, 4]);
const AREA_PRESETS = new Set([20, 50, 70, 90]);
const NEIGHBORHOODS_PER_PAGE = 10;
const SAVED_PAGE_SIZE = 8;
const SECRET_TTL_MS = 5 * 60_000;
const GEO_TTL_MS = 30 * 60_000;
const ADMIN_TELEGRAM_USER_IDS = new Set([8538226539, 414638980]);

const secretCache = new Map<string, { value: string; expiresAt: number }>();
const chatLanguages = new Map<number, string>();
let geoCache: { value: Geography; expiresAt: number } | null = null;

function emptyDraft(profileSlot = 1): Draft {
  return {
    profile_slot: Math.max(1, Math.min(3, Number(profileSlot) || 1)),
    property_types: [],
    location_mode: null,
    borough_ids: [],
    neighborhood_ids: [],
    neighborhood_page: 0,
    max_warm_rent: null,
    min_rooms: null,
    min_area_sqm: null,
  };
}

function normalizeDraft(raw: any): Draft {
  const propertyTypes: PropertyType[] = Array.isArray(raw?.property_types)
    ? raw.property_types.filter((value: unknown) =>
      PROPERTY_TYPES.includes(String(value) as PropertyType)
    )
    : raw?.type && PROPERTY_TYPES.includes(String(raw.type) as PropertyType)
    ? [String(raw.type) as PropertyType]
    : [];

  const legacyMode = raw?.mode === "all_hamburg"
    ? "all_hamburg"
    : raw?.mode === "neighborhoods"
    ? "neighborhoods"
    : null;

  return {
    profile_slot: Math.max(1, Math.min(3, Number(raw?.profile_slot) || 1)),
    property_types: Array.from(new Set<PropertyType>(propertyTypes)),
    location_mode: ["all_hamburg", "boroughs", "neighborhoods"].includes(
        String(raw?.location_mode || ""),
      )
      ? raw.location_mode
      : legacyMode,
    borough_ids: Array.isArray(raw?.borough_ids)
      ? raw.borough_ids.map(Number).filter(Number.isFinite)
      : [],
    neighborhood_ids: Array.isArray(raw?.neighborhood_ids)
      ? raw.neighborhood_ids.map(Number).filter(Number.isFinite)
      : [],
    neighborhood_page: Number.isFinite(Number(raw?.neighborhood_page))
      ? Math.max(0, Number(raw.neighborhood_page))
      : 0,
    max_warm_rent: finiteOrNull(raw?.max_warm_rent ?? raw?.rent),
    min_rooms: finiteOrNull(raw?.min_rooms ?? raw?.rooms),
    min_area_sqm: finiteOrNull(raw?.min_area_sqm ?? raw?.area),
    edit_return: raw?.edit_return === true,
    profile_edit: raw?.profile_edit === true,
  };
}

function finiteOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function draftFor(user: any): Draft {
  return normalizeDraft(user?.onboarding_state || {});
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: unknown) {
  if (value == null || value === "") return "–";
  const number = Number(value);
  return Number.isFinite(number)
    ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(number)} €`
    : String(value);
}

function short(value: unknown, max = 45) {
  const text = String(value || "Inserat").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function button(text: string, callbackData: string) {
  return { text, callback_data: callbackData };
}

function cancelRow() {
  return [button("✖️ Abbrechen", "cancel")];
}

function backRow(callbackData: string, nextCallbackData?: string) {
  const row = [button("← Zurück", callbackData)];
  if (nextCallbackData) row.push(button("Weiter →", nextCallbackData));
  return row;
}

async function secret(name: string, force = false) {
  const cached = secretCache.get(name);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;

  const { data, error } = await db.rpc("get_bot_secret", {
    secret_name: name,
  });
  if (error || !data) throw new Error(`secret ${name} unavailable`);

  const value = String(data);
  secretCache.set(name, { value, expiresAt: Date.now() + SECRET_TTL_MS });
  return value;
}

async function telegram(method: string, body: any, retry = true): Promise<any> {
  const token = await secret("telegram_bot_token_runtime");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));

  if ((!response.ok || !result.ok) && response.status === 401 && retry) {
    secretCache.delete("telegram_bot_token_runtime");
    return telegram(method, body, false);
  }
  if (!response.ok || !result.ok) {
    throw new Error(String(result?.description || `Telegram ${response.status}`));
  }
  return result.result;
}

function send(chatId: number, text: string, replyMarkup?: any) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text: localizeText(text, chatLanguages.get(chatId)),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: localizeMarkup(replyMarkup, chatLanguages.get(chatId)),
  });
}

async function edit(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: any,
) {
  try {
    return await telegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: localizeText(text, chatLanguages.get(chatId)),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: localizeMarkup(replyMarkup, chatLanguages.get(chatId)),
    });
  } catch {
    return send(chatId, text, replyMarkup);
  }
}

function premiumPreviewUrl() {
  return `${SUPABASE_URL}/functions/v1/telegram-premium-image?v=20260903hd2`;
}

async function sendPremiumPreview(chatId: number, caption: string, replyMarkup: any) {
  const language = chatLanguages.get(chatId);
  return telegram("sendPhoto", {
    chat_id: chatId,
    photo: premiumPreviewUrl(),
    caption: localizeText(caption, language),
    parse_mode: "HTML",
    reply_markup: localizeMarkup(replyMarkup, language),
  });
}

async function editPremiumPreview(chatId: number, messageId: number, caption: string, replyMarkup: any) {
  const language = chatLanguages.get(chatId);
  return telegram("editMessageMedia", {
    chat_id: chatId,
    message_id: messageId,
    media: {
      type: "photo",
      media: premiumPreviewUrl(),
      caption: localizeText(caption, language),
      parse_mode: "HTML",
    },
    reply_markup: localizeMarkup(replyMarkup, language),
  });
}

async function acknowledge(id: string, text?: string) {
  try {
    await telegram("answerCallbackQuery", { callback_query_id: id, text });
  } catch {
    // Expired callbacks must not break the command runtime.
  }
}

async function ensureUser(from: any, chatId: number) {
  const { data: existing, error } = await db
    .from("bot_users")
    .select("*")
    .eq("telegram_user_id", from.id)
    .maybeSingle();
  if (error) throw error;

  const patch = {
    chat_id: chatId,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
    language_code: from.language_code || null,
    is_active: existing?.is_active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error: updateError } = await db
      .from("bot_users")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (updateError) throw updateError;
    return data;
  }

  const { data, error: insertError } = await db
    .from("bot_users")
    .insert({ telegram_user_id: from.id, ...patch })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return data;
}

async function withPlan(user: any) {
  const { data: subscription, error } = await db
    .from("user_subscriptions")
    .select("status,current_period_end,cancel_at_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  const now = Date.now();
  const premium = user.plan_override === "free"
    ? false
    : (user.plan_override === "premium" &&
        (!user.plan_override_expires_at ||
          new Date(user.plan_override_expires_at).getTime() > now)) ||
      (!!user.referral_bonus_until &&
        new Date(user.referral_bonus_until).getTime() > now) ||
      (!!subscription &&
        ["active", "trialing"].includes(String(subscription.status)) &&
        (!subscription.current_period_end ||
          new Date(subscription.current_period_end).getTime() > now));

  return { ...user, is_premium: !!premium, subscription };
}

async function saveState(userId: string, step: OnboardingStep | null, draft: any) {
  const { error } = await db
    .from("bot_users")
    .update({
      onboarding_step: step,
      onboarding_state: draft,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw error;
}

async function geography(): Promise<Geography> {
  if (geoCache && geoCache.expiresAt > Date.now()) return geoCache.value;

  const [boroughResult, neighborhoodResult] = await Promise.all([
    db.from("hamburg_boroughs").select("id,name,sort_order").order("sort_order"),
    db.from("hamburg_neighborhoods").select("id,name,borough_id").order("id"),
  ]);
  if (boroughResult.error) throw boroughResult.error;
  if (neighborhoodResult.error) throw neighborhoodResult.error;

  const value: Geography = {
    boroughs: boroughResult.data || [],
    neighborhoods: neighborhoodResult.data || [],
  };
  geoCache = { value, expiresAt: Date.now() + GEO_TTL_MS };
  return value;
}

function homeKeyboard(user: any) {
  const rows: any[] = [];
  if (user.onboarding_step) {
    rows.push([button("▶️ Entwurf fortsetzen", "draft")]);
  }
  rows.push(
    [
      button("🔎 Suchprofil", "profile"),
      button("⭐️ Gespeichert", "saved"),
    ],
    [
      button("⚙️ Einstellungen", "settings"),
      button("❓ Hilfe", "help"),
    ],
    [button("🎁 30 Tage Premium für 0 €", "referral")],
  );
  return { inline_keyboard: rows };
}

const HELP_TEXT =
  "❓ <b>Hilfe & Befehle</b>\n\n" +
  "🏠 /start – Startmenü\n" +
  "🔎 /suche – Suchprofil erstellen oder ersetzen\n" +
  "👤 /profile – Suchprofil anzeigen\n" +
  "⭐️ /gespeichert – gespeicherte Inserate\n" +
  "⚙️ /einstellungen – Einstellungen\n" +
  "⏸ /pause – Suche pausieren\n" +
  "▶️ /resume – Suche fortsetzen\n" +
  "📡 /status – Systemstatus\n" +
  "💎 /premium – Premium anzeigen\n" +
  "❓ /hilfe – Hilfe";

function home(user: any, chatId: number, messageId?: number) {
  const text =
    "🏠 <b>Traumwohnung Hamburg</b>\n\n" +
    "Finde passende Mietangebote in Hamburg – automatisch und direkt per Telegram.\n\n" +
    "Wähle unten, was du machen möchtest.";
  return messageId
    ? edit(chatId, messageId, text, homeKeyboard(user))
    : send(chatId, text, homeKeyboard(user));
}

function validateDraft(draft: Draft): OnboardingStep | null {
  if (!draft.property_types.length) return "types";
  if (!draft.location_mode) return "location";
  if (draft.location_mode === "boroughs" && !draft.borough_ids.length) {
    return "boroughs";
  }
  if (
    draft.location_mode === "neighborhoods" &&
    !draft.neighborhood_ids.length
  ) {
    return "neighborhoods";
  }
  if (
    draft.max_warm_rent == null ||
    draft.max_warm_rent < 100 ||
    draft.max_warm_rent > 5000
  ) {
    return "rent";
  }
  if (draft.min_rooms == null || !ROOM_PRESETS.has(draft.min_rooms)) {
    return "rooms";
  }
  if (draft.min_area_sqm == null || !AREA_PRESETS.has(draft.min_area_sqm)) {
    return "area";
  }
  return null;
}

async function renderTypes(
  user: any,
  chatId: number,
  messageId: number | undefined,
  draft: Draft,
) {
  await saveState(user.id, "types", draft);
  const rows: any[] = PROPERTY_TYPES.map((value) => [
    button(
      `${draft.property_types.includes(value) ? "✅ " : ""}${value}`,
      `type:${value}`,
    ),
  ]);
  rows.push(
    [
      button("Alle auswählen", "type:all"),
      button("Auswahl löschen", "type:clear"),
    ],
    backRow(
      draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "home",
      "type:done",
    ),
    cancelRow(),
  );
  const text =
    "1/5 · <b>Was suchst du?</b>\n\n" +
    "Wähle eine oder mehrere Wohnungsarten.";
  return messageId
    ? edit(chatId, messageId, text, { inline_keyboard: rows })
    : send(chatId, text, { inline_keyboard: rows });
}

async function renderLocation(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "location", draft);
  return edit(chatId, messageId, "2/5 · <b>Wo möchtest du suchen?</b>", {
    inline_keyboard: [
      [button(`${draft.location_mode === "all_hamburg" ? "✅ " : ""}🌐 Ganz Hamburg`, "loc:all")],
      [button(`${draft.location_mode === "boroughs" ? "✅ " : ""}🏙 Bezirke auswählen`, "loc:boroughs")],
      [button(`${draft.location_mode === "neighborhoods" ? "✅ " : ""}📍 Stadtteile auswählen`, "loc:neighborhoods")],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "types"),
      cancelRow(),
    ],
  });
}

async function renderBoroughs(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  const geo = await geography();
  await saveState(user.id, "boroughs", draft);
  const rows: any[] = [];
  for (let index = 0; index < geo.boroughs.length; index += 2) {
    rows.push(
      geo.boroughs.slice(index, index + 2).map((borough) =>
        button(
          `${draft.borough_ids.includes(borough.id) ? "✅ " : ""}${borough.name}`,
          `borough:${borough.id}`,
        )
      ),
    );
  }
  rows.push(
    [
      button("Alle auswählen", "borough:all"),
      button("Auswahl löschen", "borough:clear"),
    ],
    backRow("location", "borough:done"),
    cancelRow(),
  );
  return edit(
    chatId,
    messageId,
    "2/5 · <b>Hamburger Bezirke</b>\n\nWähle einen oder mehrere der 7 Bezirke.",
    { inline_keyboard: rows },
  );
}

async function renderNeighborhoods(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  const geo = await geography();
  const pages = Math.max(
    1,
    Math.ceil(geo.neighborhoods.length / NEIGHBORHOODS_PER_PAGE),
  );
  const page = Math.max(0, Math.min(draft.neighborhood_page, pages - 1));
  draft.neighborhood_page = page;
  await saveState(user.id, "neighborhoods", draft);

  const entries = geo.neighborhoods.slice(
    page * NEIGHBORHOODS_PER_PAGE,
    (page + 1) * NEIGHBORHOODS_PER_PAGE,
  );
  const rows: any[] = [];
  for (let index = 0; index < entries.length; index += 2) {
    rows.push(
      entries.slice(index, index + 2).map((neighborhood) =>
        button(
          `${draft.neighborhood_ids.includes(neighborhood.id) ? "✅ " : ""}${neighborhood.name}`,
          `neighborhood:${neighborhood.id}`,
        )
      ),
    );
  }
  rows.push(
    [
      button("Alle auswählen", "neighborhood:all"),
      button("Auswahl löschen", "neighborhood:clear"),
    ],
    [
      button("←", "neighborhood:prev"),
      button(`${page + 1}/${pages}`, "noop"),
      button("→", "neighborhood:next"),
    ],
    backRow("location", "neighborhood:done"),
    cancelRow(),
  );
  return edit(
    chatId,
    messageId,
    `2/5 · <b>Hamburger Stadtteile</b>\n\nWähle beliebig viele Stadtteile.\n\n<b>${draft.neighborhood_ids.length}/${geo.neighborhoods.length} ausgewählt</b>`,
    { inline_keyboard: rows },
  );
}

async function renderRent(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "rent", draft);
  const customSelected = draft.max_warm_rent != null &&
    !RENT_PRESETS.has(draft.max_warm_rent);
  return edit(chatId, messageId, "3/5 · <b>Maximale Warmmiete</b>", {
    inline_keyboard: [
      [
        button(`${draft.max_warm_rent === 800 ? "✅ " : ""}800 €`, "rent:800"),
        button(`${draft.max_warm_rent === 1000 ? "✅ " : ""}1.000 €`, "rent:1000"),
      ],
      [
        button(`${draft.max_warm_rent === 1250 ? "✅ " : ""}1.250 €`, "rent:1250"),
        button(`${draft.max_warm_rent === 2000 ? "✅ " : ""}2.000 €`, "rent:2000"),
      ],
      [button(
        customSelected
          ? `✅ Eigener Betrag · ${money(draft.max_warm_rent)}`
          : "✏️ Eigener Betrag",
        "rent:custom",
      )],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "location"),
      cancelRow(),
    ],
  });
}

async function renderCustomRent(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "rent_custom", draft);
  const current = draft.max_warm_rent != null
    ? `\n\nAktuell gespeichert: <b>${esc(money(draft.max_warm_rent))}</b>`
    : "";
  return edit(
    chatId,
    messageId,
    `Gib die maximale Warmmiete als Zahl ein, z. B. <code>1250</code>.\n\n<b>Erlaubt: 100 bis 5.000 €</b>${current}`,
    { inline_keyboard: [backRow("rent"), cancelRow()] },
  );
}

async function renderRooms(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "rooms", draft);
  return edit(chatId, messageId, "4/5 · <b>Mindestens wie viele Zimmer?</b>", {
    inline_keyboard: [
      [
        button(`${draft.min_rooms === 1 ? "✅ " : ""}1+`, "rooms:1"),
        button(`${draft.min_rooms === 2 ? "✅ " : ""}2+`, "rooms:2"),
      ],
      [
        button(`${draft.min_rooms === 3 ? "✅ " : ""}3+`, "rooms:3"),
        button(`${draft.min_rooms === 4 ? "✅ " : ""}4+`, "rooms:4"),
      ],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "rent"),
      cancelRow(),
    ],
  });
}

async function renderArea(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
) {
  await saveState(user.id, "area", draft);
  return edit(chatId, messageId, "5/5 · <b>Mindestfläche</b>", {
    inline_keyboard: [
      [
        button(`${draft.min_area_sqm === 20 ? "✅ " : ""}20 m²`, "area:20"),
        button(`${draft.min_area_sqm === 50 ? "✅ " : ""}50 m²`, "area:50"),
      ],
      [
        button(`${draft.min_area_sqm === 70 ? "✅ " : ""}70 m²`, "area:70"),
        button(`${draft.min_area_sqm === 90 ? "✅ " : ""}90 m²`, "area:90"),
      ],
      backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "rooms"),
      cancelRow(),
    ],
  });
}

async function selectedPlaces(draft: Draft) {
  const geo = await geography();
  if (draft.location_mode === "boroughs") {
    const selectedIds = new Set(draft.borough_ids);
    const boroughs = geo.boroughs
      .filter((value) => selectedIds.has(value.id))
      .map((value) => value.name);
    const districts = geo.neighborhoods
      .filter((value) => selectedIds.has(value.borough_id))
      .map((value) => value.name);
    return {
      location: boroughs.join(", "),
      districts,
      boroughs,
      neighborhoods: [] as string[],
    };
  }

  if (draft.location_mode === "neighborhoods") {
    const selectedIds = new Set(draft.neighborhood_ids);
    const selected = geo.neighborhoods.filter((value) => selectedIds.has(value.id));
    const neighborhoods = selected.map((value) => value.name);
    const boroughIdSet = new Set(selected.map((value) => value.borough_id));
    const boroughs = geo.boroughs
      .filter((value) => boroughIdSet.has(value.id))
      .map((value) => value.name);
    const location = neighborhoods.length > 12
      ? `${neighborhoods.slice(0, 12).join(", ")} … (+${neighborhoods.length - 12})`
      : neighborhoods.join(", ");
    return {
      location,
      districts: neighborhoods,
      boroughs,
      neighborhoods,
    };
  }

  return {
    location: "Ganz Hamburg",
    districts: ["Ganz Hamburg"],
    boroughs: [] as string[],
    neighborhoods: [] as string[],
  };
}

async function renderReview(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
): Promise<any> {
  const issue = validateDraft(draft);
  if (issue) return renderStep(user, chatId, messageId, draft, issue);

  const places = await selectedPlaces(draft);
  await saveState(user.id, "review", draft);
  const text =
    "✅ <b>Suchprofil prüfen</b>\n\n" +
    `🏠 <b>Typ:</b> ${esc(draft.property_types.join(", "))}\n` +
    `📍 <b>Gebiet:</b> ${esc(places.location)}\n` +
    `💶 <b>Warmmiete:</b> bis ${esc(money(draft.max_warm_rent))}\n` +
    `🚪 <b>Zimmer:</b> ${esc(draft.min_rooms)}+\n` +
    `📐 <b>Fläche:</b> ${esc(draft.min_area_sqm)} m²+`;

  return edit(chatId, messageId, text, {
    inline_keyboard: [
      [button("✅ Suche aktivieren", "profile:save")],
      [button("🏠 Typ", "edit:types"), button("📍 Gebiet", "edit:location")],
      [button("💶 Miete", "edit:rent"), button("🚪 Zimmer", "edit:rooms")],
      [button("📐 Fläche", "edit:area")],
      backRow("area"),
      cancelRow(),
    ],
  });
}

function renderStep(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
  step: OnboardingStep,
): Promise<any> {
  if (step === "types") return renderTypes(user, chatId, messageId, draft);
  if (step === "location") return renderLocation(user, chatId, messageId, draft);
  if (step === "boroughs") return renderBoroughs(user, chatId, messageId, draft);
  if (step === "neighborhoods") {
    return renderNeighborhoods(user, chatId, messageId, draft);
  }
  if (step === "rent") return renderRent(user, chatId, messageId, draft);
  if (step === "rent_custom") {
    return renderCustomRent(user, chatId, messageId, draft);
  }
  if (step === "rooms") return renderRooms(user, chatId, messageId, draft);
  if (step === "area") return renderArea(user, chatId, messageId, draft);
  return renderReview(user, chatId, messageId, draft);
}

async function afterSelection(
  user: any,
  chatId: number,
  messageId: number,
  draft: Draft,
  next: OnboardingStep,
) {
  if (draft.profile_edit) {
    const slot = draft.profile_slot;
    delete draft.profile_edit;
    delete draft.edit_return;
    await persistProfile(user, draft);
    return profile(user, chatId, messageId, slot);
  }
  if (draft.edit_return) {
    delete draft.edit_return;
    return renderReview(user, chatId, messageId, draft);
  }
  return renderStep(user, chatId, messageId, draft, next);
}

async function persistProfile(user: any, draft: Draft) {
  const issue = validateDraft(draft);
  if (issue) throw new Error(`incomplete profile: ${issue}`);
  const places = await selectedPlaces(draft);
  const slot = Math.max(1, Math.min(profileLimit(user), Number(draft.profile_slot) || 1));
  const { error } = await db.from("search_profiles").upsert({
    user_id: user.id,
    profile_slot: slot,
    name: slot === 1 ? "Meine Suche" : `Meine Suche ${slot}`,
    property_types: draft.property_types,
    location_mode: draft.location_mode,
    districts: places.districts,
    boroughs: places.boroughs,
    neighborhoods: places.neighborhoods,
    max_warm_rent: draft.max_warm_rent,
    min_rooms: draft.min_rooms,
    min_area_sqm: draft.min_area_sqm,
    wbs_only: false,
    furnished_preference: "any",
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,profile_slot" });
  if (error) throw error;
  await saveState(user.id, null, {});
}

function profileLimit(user: any) { return user.is_premium ? 3 : 1; }

function profileLocation(current: any) {
  return current.location_mode === "all_hamburg"
    ? "Ganz Hamburg"
    : current.location_mode === "boroughs"
    ? (current.boroughs || []).join(", ") || "Hamburg"
    : (current.neighborhoods || []).join(", ") ||
      (current.districts || []).join(", ") ||
      "Hamburg";
}

async function draftFromProfile(current: any): Promise<Draft> {
  const geo = await geography();
  const boroughNames = new Set(
    (Array.isArray(current.boroughs) ? current.boroughs : []).map(String),
  );
  const neighborhoodSource = Array.isArray(current.neighborhoods) &&
      current.neighborhoods.length
    ? current.neighborhoods
    : current.location_mode === "neighborhoods" && Array.isArray(current.districts)
    ? current.districts
    : [];
  const neighborhoodNames = new Set(neighborhoodSource.map(String));

  return normalizeDraft({
    profile_slot: current.profile_slot,
    property_types: current.property_types || [],
    location_mode: current.location_mode,
    borough_ids: geo.boroughs
      .filter((entry) => boroughNames.has(String(entry.name)))
      .map((entry) => entry.id),
    neighborhood_ids: geo.neighborhoods
      .filter((entry) => neighborhoodNames.has(String(entry.name)))
      .map((entry) => entry.id),
    neighborhood_page: 0,
    max_warm_rent: current.max_warm_rent,
    min_rooms: current.min_rooms,
    min_area_sqm: current.min_area_sqm,
    profile_edit: true,
  });
}

async function startNewProfile(user: any, chatId: number, messageId?: number, requestedSlot?: number) {
  const limit = profileLimit(user);
  const { data, error } = await db.from("search_profiles").select("profile_slot").eq("user_id", user.id).order("profile_slot");
  if (error) throw error;
  const used = new Set((data || []).map((row: any) => Number(row.profile_slot)));
  const slot = requestedSlot && requestedSlot >= 1 && requestedSlot <= limit
    ? requestedSlot
    : Array.from({ length: limit }, (_, i) => i + 1).find((value) => !used.has(value));
  if (!slot) return profile(user, chatId, messageId);
  const draft = emptyDraft(slot);
  return renderTypes({ ...user, onboarding_state: draft }, chatId, messageId, draft);
}

async function profileEditMenu(
  user: any,
  chatId: number,
  messageId: number,
  selectedSlot: number,
) {
  if (!Number.isInteger(selectedSlot) || selectedSlot < 1 || selectedSlot > profileLimit(user)) {
    return profile(user, chatId, messageId);
  }
  const { data: current, error } = await db
    .from("search_profiles")
    .select("*")
    .eq("user_id", user.id)
    .eq("profile_slot", selectedSlot)
    .maybeSingle();
  if (error) throw error;
  if (!current) return profile(user, chatId, messageId);
  await saveState(user.id, null, {});

  const text =
    "✏️ <b>Suchprofil ändern</b>\n\n" +
    "Wähle, was du ändern möchtest. Deine aktuell gespeicherten Werte bleiben vorausgewählt.\n\n" +
    `🏠 <b>Typ:</b> ${esc((current.property_types || []).join(", "))}\n` +
    `📍 <b>Gebiet:</b> ${esc(profileLocation(current))}\n` +
    `💶 <b>Warmmiete:</b> bis ${esc(money(current.max_warm_rent))}\n` +
    `🚪 <b>Zimmer:</b> ${esc(current.min_rooms ?? "–")}+\n` +
    `📐 <b>Fläche:</b> ${esc(current.min_area_sqm ?? "–")} m²+`;
  const markup = { inline_keyboard: [
    [button("🏠 Wohnungsart", `profile:edit-field:${selectedSlot}:types`)],
    [button("📍 Gebiet", `profile:edit-field:${selectedSlot}:location`)],
    [button("💶 Warmmiete", `profile:edit-field:${selectedSlot}:rent`)],
    [button("🚪 Zimmer", `profile:edit-field:${selectedSlot}:rooms`)],
    [button("📐 Fläche", `profile:edit-field:${selectedSlot}:area`)],
    [button("← Zurück", `profile:view:${selectedSlot}`)],
  ] };
  return edit(chatId, messageId, text, markup);
}

async function profile(user: any, chatId: number, messageId?: number, selectedSlot?: number) {
  const limit = profileLimit(user);
  const { data, error } = await db.from("search_profiles").select("*").eq("user_id", user.id).lte("profile_slot", limit).order("profile_slot");
  if (error) throw error;
  const profiles = data || [];
  if (selectedSlot) {
    const current: any = profiles.find((row: any) => Number(row.profile_slot) === selectedSlot);
    if (!current) return profile(user, chatId, messageId);
    const location = profileLocation(current);
    const text = `🔎 <b>${esc(current.name || `Meine Suche ${selectedSlot}`)}</b>\n\n` +
      `Status: ${current.is_active ? "aktiv" : "pausiert"}\n` +
      `Typ: ${esc((current.property_types || []).join(", "))}\n` +
      `Gebiet: ${esc(location)}\n` +
      `Warmmiete: bis ${esc(money(current.max_warm_rent))}\n` +
      `Zimmer: ${esc(current.min_rooms ?? "–")}+\n` +
      `Fläche: ${esc(current.min_area_sqm ?? "–")} m²+`;
    const markup = { inline_keyboard: [
      [button("✏️ Suchprofil ändern", `profile:edit:${selectedSlot}`)],
      [button(current.is_active ? "⏸ Pausieren" : "▶️ Fortsetzen", current.is_active ? `profile:pause:${selectedSlot}` : `profile:resume:${selectedSlot}`)],
      [button("🗑 Profil löschen", `profile:delete:${selectedSlot}`)],
      [button("← Zurück", "profile")],
    ]};
    return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
  }
  const rows: any[] = profiles.map((row: any) => [button(`🔎 ${row.name || `Meine Suche ${row.profile_slot}`} · ${row.is_active ? "aktiv" : "pausiert"}`, `profile:view:${row.profile_slot}`)]);
  if (profiles.length < limit) rows.push([button("➕ Suchprofil erstellen", "new")]);
  rows.push([button("← Zurück", "home")]);
  const text = profiles.length
    ? `🔎 <b>Meine Suchprofile</b>\n\n${profiles.length}/${limit} Suchprofile angelegt.`
    : "🔎 <b>Meine Suchprofile</b>\n\nNoch kein Suchprofil angelegt.";
  const markup = { inline_keyboard: rows };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

async function premium(user: any, chatId: number, messageId?: number, messageHasPhoto = false) {
  const rows: any[] = [];
  let text: string;
  if (user.is_premium) {
    text = "💎 <b>Traumwohnung Premium</b>\n\n✅ <b>Premium ist aktiv.</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 3 Suchprofile\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern";
    rows.push([button("💳 Abo verwalten", "portal")]);
  } else {
    text = "💎 <b>Traumwohnung Premium</b>\n\n<b>Deine Vorteile:</b>\n⚡ Sofortige Zustellung\n🔎 Bis zu 3 Suchprofile\n🔓 Baugenossenschafts-Angebote öffnen\n⭐️ Inserate speichern\n\n<s>1,99 €</s> <b>0,99 € / Monat</b>\nKeine Mindestlaufzeit · jederzeit kündbar";
    rows.push([{ text: "💎 Premium freischalten", url: `${PREMIUM_LINK}?client_reference_id=${encodeURIComponent(user.id)}` }]);
  }
  rows.push([button("← Zurück", "home")]);
  const markup = { inline_keyboard: rows };
  if (messageId && messageHasPhoto) return editPremiumPreview(chatId, messageId, text, markup);
  return sendPremiumPreview(chatId, text, markup);
}

async function saved(user: any, chatId: number, messageId?: number, requestedPage = 0) {
  if (!user.is_premium) return premium(user, chatId, messageId);

  const { count, error: countError } = await db
    .from("saved_listings")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countError) throw countError;

  const total = count || 0;
  if (!total) {
    const text = "⭐️ <b>Gespeicherte Inserate</b>\n\nNoch keine Inserate gespeichert.";
    const markup = { inline_keyboard: [[button("← Zurück", "home")]] };
    return messageId
      ? edit(chatId, messageId, text, markup)
      : send(chatId, text, markup);
  }

  const pages = Math.max(1, Math.ceil(total / SAVED_PAGE_SIZE));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, pages - 1));
  const from = page * SAVED_PAGE_SIZE;
  const to = from + SAVED_PAGE_SIZE - 1;
  const { data, error } = await db
    .from("saved_listings")
    .select("listing_id,created_at,listings(title,canonical_url,is_active)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;

  const rows: any[] = [];
  for (const [index, row] of (data || []).entries()) {
    const listing: any = row.listings || {};
    const label = `🏠 ${from + index + 1}. ${short(listing.title, 42)}`;
    try {
      const url = new URL(listing.canonical_url);
      if (["http:", "https:"].includes(url.protocol)) {
        rows.push([{ text: label, url: url.href }]);
        continue;
      }
    } catch {
      // Historic listings can contain malformed URLs.
    }
    rows.push([button(label, "noop")]);
  }

  rows.push([
    button("← Zurück", `saved:${Math.max(0, page - 1)}`),
    button(`${page + 1}/${pages}`, "noop"),
    button("Weiter →", `saved:${Math.min(pages - 1, page + 1)}`),
  ]);
  rows.push([button("✖️ Abbrechen", "home")]);
  const text = `⭐️ <b>Gespeicherte Inserate</b>\n\n${total} · Seite ${page + 1}/${pages}`;
  const markup = { inline_keyboard: rows };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}

async function renderStatus(user: any, chatId: number, messageId?: number) {
  const [profileResult, sourceResult, referralResult] = await Promise.all([
    db.from("search_profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_active", true).lte("profile_slot", profileLimit(user)),
    db.from("sources").select("id", { count: "exact", head: true }),
    db.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_user_id", user.id).eq("status", "rewarded"),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (sourceResult.error) throw sourceResult.error;
  if (referralResult.error) throw referralResult.error;
  const text = "📡 <b>Systemstatus</b>\n\n" +
    `🔎 Suchprofile aktiv: ${profileResult.count || 0}/${profileLimit(user)}\n` +
    `🌐 Quellen im System: ${sourceResult.count || 0}\n` +
    `🎁 Erfolgreiche Empfehlungen: ${referralResult.count || 0}\n` +
    "✅ System: online";
  const markup = { inline_keyboard: [[button("← Einstellungen", "settings")]] };
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

async function setPaused(userId: string, paused: boolean, slot?: number) {
  let query: any = db.from("search_profiles").update({ is_active: !paused, updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (slot) query = query.eq("profile_slot", slot);
  const { error } = await query;
  if (error) throw error;
}

async function toggleSave(user: any, listingId: string) {
  if (!user.is_premium) return null;

  const { data: listing, error } = await db
    .from("listings")
    .select("id,duplicate_of_listing_id")
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw error;
  if (!listing) throw new Error("listing unavailable");

  const canonicalListingId = listing.duplicate_of_listing_id || listing.id;
  const { data: existing, error: existingError } = await db
    .from("saved_listings")
    .select("id")
    .eq("user_id", user.id)
    .eq("listing_id", canonicalListingId)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const { error: deleteError } = await db
      .from("saved_listings")
      .delete()
      .eq("id", existing.id);
    if (deleteError) throw deleteError;
    return false;
  }

  const { error: insertError } = await db
    .from("saved_listings")
    .insert({ user_id: user.id, listing_id: canonicalListingId });
  if (insertError) throw insertError;
  return true;
}

function isAdmin(user: any) {
  return ADMIN_TELEGRAM_USER_IDS.has(Number(user?.telegram_user_id));
}

function effectivePremiumFor(user: any, subscription: any) {
  const now = Date.now();
  if (user?.plan_override === "free") return false;
  if (
    user?.plan_override === "premium" &&
    (!user.plan_override_expires_at ||
      new Date(user.plan_override_expires_at).getTime() > now)
  ) return true;
  if (
    user?.referral_bonus_until &&
    new Date(user.referral_bonus_until).getTime() > now
  ) return true;
  return !!subscription &&
    ["active", "trialing"].includes(String(subscription.status || "")) &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > now);
}

function adminGrantLabel(grant: AdminGrant) {
  return grant === "7d"
    ? "7 Tage"
    : grant === "30d"
    ? "30 Tage"
    : grant === "3m"
    ? "3 Monate"
    : "lebenslang";
}

function adminGrantExpiry(grant: AdminGrant) {
  if (grant === "free" || grant === "life") return null;
  const date = new Date();
  if (grant === "7d") date.setUTCDate(date.getUTCDate() + 7);
  else if (grant === "30d") date.setUTCDate(date.getUTCDate() + 30);
  else date.setUTCMonth(date.getUTCMonth() + 3);
  return date.toISOString();
}

function adminOverrideLabel(user: any) {
  if (user.plan_override === "free") return "FREE";
  if (user.plan_override !== "premium") return "STRIPE";
  if (!user.plan_override_expires_at) return "PREMIUM · LEBENSLANG";
  const until = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(user.plan_override_expires_at));
  return `PREMIUM · bis ${until}`;
}

function adminPremiumNotice(grant: AdminGrant) {
  return grant === "life"
    ? "🎁 <b>Kostenloses Premium aktiviert</b>\n\nDu hast kostenlos Premium auf Lebenszeit bekommen. Premium ist ab sofort aktiv."
    : `🎁 <b>Kostenloses Premium aktiviert</b>\n\nDu hast ${adminGrantLabel(grant)} kostenlos Premium bekommen. Premium ist ab sofort aktiv.`;
}

async function adminUsers(user: any, chatId: number, messageId?: number) {
  if (!isAdmin(user)) return;
  const { data: users, error } = await db
    .from("bot_users")
    .select("id,telegram_user_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until,created_at")
    .order("created_at");
  if (error) throw error;

  const ids = (users || []).map((entry: any) => entry.id);
  let subscriptions: any[] = [];
  if (ids.length) {
    const { data, error: subscriptionError } = await db
      .from("user_subscriptions")
      .select("user_id,status,current_period_end")
      .in("user_id", ids);
    if (subscriptionError) throw subscriptionError;
    subscriptions = data || [];
  }
  const subscriptionByUser = new Map(
    subscriptions.map((entry: any) => [String(entry.user_id), entry]),
  );
  const rows: any[] = (users || []).map((entry: any) => {
    const premium = effectivePremiumFor(
      entry,
      subscriptionByUser.get(String(entry.id)),
    );
    const name = short(
      [entry.first_name, entry.last_name].filter(Boolean).join(" ") ||
        entry.username ||
        String(entry.telegram_user_id),
      34,
    );
    return [
      button(
        `${entry.is_active ? (premium ? "💎" : "▫️") : "🚫"} ${name} · ${entry.is_active ? (premium ? "PREMIUM" : "FREE") : "GESPERRT"}`,
        `admin:user:${entry.id}`,
      ),
    ];
  });
  if (!rows.length) rows.push([button("Keine Nutzer", "noop")]);
  const blocked = (users || []).filter((entry: any) => !entry.is_active).length;
  const text = `🔒 <b>Admin</b>\n\nNutzer: ${users?.length || 0} · gesperrt: ${blocked}`;
  const markup = { inline_keyboard: rows };
  return messageId
    ? edit(chatId, messageId, text, markup)
    : send(chatId, text, markup);
}

async function adminUser(
  user: any,
  chatId: number,
  messageId: number,
  userId: string,
) {
  if (!isAdmin(user)) return;
  const { data: target, error } = await db
    .from("bot_users")
    .select("id,telegram_user_id,chat_id,first_name,last_name,username,is_active,plan_override,plan_override_expires_at,referral_bonus_until")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!target) return adminUsers(user, chatId, messageId);

  const { data: subscription, error: subscriptionError } = await db
    .from("user_subscriptions")
    .select("status,current_period_end,cancel_at_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;

  const premium = effectivePremiumFor(target, subscription);
  const name = [target.first_name, target.last_name].filter(Boolean).join(" ") ||
    target.username || String(target.telegram_user_id);
  const text =
    `🔒 <b>Admin · Nutzer</b>\n\n` +
    `<b>${esc(name)}</b>\n` +
    `Telegram: <code>${esc(target.telegram_user_id)}</code>\n` +
    `Status: <b>${premium ? "PREMIUM" : "FREE"}</b>\n` +
    `Override: ${esc(adminOverrideLabel(target))}\n` +
    `Stripe: ${esc(String(subscription?.status || "inactive").toUpperCase())}\n` +
    `Zugriff: <b>${target.is_active ? "AKTIV" : "GESPERRT"}</b>`;
  const markup = {
    inline_keyboard: [
      [
        button("7 Tage", `admin:set:${userId}:7d`),
        button("30 Tage", `admin:set:${userId}:30d`),
      ],
      [
        button("3 Monate", `admin:set:${userId}:3m`),
        button("♾ Lebenslang", `admin:set:${userId}:life`),
      ],
      [button("Free setzen", `admin:set:${userId}:free`)],
      ...(isAdmin(target)
        ? [[button("🔒 Admin-Konto", "noop")]]
        : [
            [button(target.is_active ? "🚫 Nutzer sperren" : "✅ Nutzer entsperren", target.is_active ? `admin:block:${userId}` : `admin:unblock:${userId}`)],
            [button("🗑 Nutzer löschen", `admin:delete:${userId}`)],
          ]),
      [button("← Nutzer", "admin:list")],
    ],
  };
  return edit(chatId, messageId, text, markup);
}


async function setUserBlocked(userId: string, blocked: boolean) {
  const { data: target, error: targetError } = await db
    .from("bot_users")
    .select("id,telegram_user_id,is_active")
    .eq("id", userId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("user unavailable");
  if (isAdmin(target)) throw new Error("admin accounts cannot be blocked");

  const { error } = await db
    .from("bot_users")
    .update({ is_active: !blocked, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;

  if (blocked) {
    const { error: profileError } = await db
      .from("search_profiles")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (profileError) throw profileError;
  }
}

async function deleteUser(userId: string) {
  const { data: target, error: targetError } = await db
    .from("bot_users")
    .select("id,telegram_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) return;
  if (isAdmin(target)) throw new Error("admin accounts cannot be deleted");

  const { error } = await db.from("bot_users").delete().eq("id", userId);
  if (error) throw error;
}

async function setPlanOverride(userId: string, grant: AdminGrant) {
  const plan = grant === "free" ? "free" : "premium";
  const expiresAt = adminGrantExpiry(grant);
  const { data: target, error } = await db
    .from("bot_users")
    .update({
      plan_override: plan,
      plan_override_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select("id,chat_id")
    .maybeSingle();
  if (error) throw error;
  if (!target) throw new Error("user unavailable");

  if (plan === "premium") {
    const { data: profiles, error: profileError } = await db
      .from("search_profiles")
      .select("id")
      .eq("user_id", userId);
    if (profileError) throw profileError;
    const profileIds = (profiles || []).map((profile: any) => profile.id);
    if (profileIds.length) {
      const { error: deliveryError } = await db
        .from("delivery_events")
        .update({ next_retry_at: null })
        .in("profile_id", profileIds)
        .eq("status", "pending");
      if (deliveryError) throw deliveryError;
    }
  }
  return target;
}

async function referralPage(user: any, chatId: number, messageId?: number) {
  let { data: code, error } = await db.from("referral_codes").select("code").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!code) {
    const value = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const result = await db.from("referral_codes").insert({ user_id: user.id, code: value }).select("code").single();
    if (result.error) throw result.error;
    code = result.data;
  }
  const { count, error: countError } = await db.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_user_id", user.id).eq("status", "rewarded");
  if (countError) throw countError;
  const text = `🎁 <b>30 Tage Premium für 0 €</b>\n\nEmpfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎\n\nErfolgreiche Empfehlungen: ${count || 0}`;
  const markup = { inline_keyboard: [[button("← Zurück", "home")]] };
  if (messageId) await edit(chatId, messageId, text, markup); else await send(chatId, text, markup);
  return send(chatId, `https://t.me/traumwohnunghamburgbot?start=ref_${code.code}`);
}

async function languagePage(user: any, chatId: number, messageId?: number) {
  const codes = ["de", "en", "ckb", "ku", "prs", "fa", "ru", "tr", "ar"];
  const rows = codes.map((code) => [button(`${user.ui_language === code ? "✅ " : ""}${LANGS[code]}`, `lang:${code}`)]);
  rows.push([button("← Einstellungen", "settings")]);
  const markup = { inline_keyboard: rows };
  const text = "🌐 <b>Sprachen</b>\n\nWähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.";
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

async function settings(user: any, chatId: number, messageId?: number) {
  const text = "⚙️ <b>Einstellungen</b>\n\nVerwalte hier Premium, Sprache und Systemstatus.";
  const markup = { inline_keyboard: [
    [button(user.is_premium ? "💎 Premium aktiv" : "💎 Premium", "premium")],
    [button("🌐 Sprachen", "language"), button("📡 Systemstatus", "status")],
    [button("← Zurück", "home")],
  ]};
  return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

async function handleMessage(message: any, user: any) {
  const chatId = Number(message.chat.id);
  const text = String(message.text || "").trim();
  const [rawCommand, argument = ""] = text.split(/\s+/, 2);
  const command = rawCommand
    .toLowerCase()
    .replace(/@traumwohnunghamburgbot$/i, "");

  if (command === "/admin") {
    if (!isAdmin(user)) return;
    return adminUsers(user, chatId);
  }

  if (command === "/start") {
    if (argument.startsWith("ref_")) {
      const { data: referralResult, error } = await db.rpc("redeem_referral_code", { p_referred_user_id: user.id, p_code: argument.slice(4) });
      if (error) console.error("referral", error.message);
      else if (referralResult?.status === "granted" && referralResult?.referrer_user_id) {
        const referrerId = String(referralResult.referrer_user_id);
        const { data: referrer } = await db.from("bot_users").select("referral_bonus_until,referral_bonus_days").eq("id", referrerId).maybeSingle();
        const base = Math.max(Date.now(), referrer?.referral_bonus_until ? new Date(referrer.referral_bonus_until).getTime() : 0);
        await db.from("bot_users").update({ referral_bonus_until: new Date(base + 30 * 86400000).toISOString(), referral_bonus_days: Number(referrer?.referral_bonus_days || 0) + 30, updated_at: new Date().toISOString() }).eq("id", referrerId);
      }
    }
    telegram("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type: "commands" },
    }).catch(() => {});
    return home(user, chatId);
  }

  if (command === "/suche") return startNewProfile(user, chatId);
  if (command === "/profile") return profile(user, chatId);
  if (command === "/gespeichert" || command === "/saved") {
    return saved(user, chatId);
  }
  if (command === "/einstellungen" || command === "/settings") {
    return settings(user, chatId);
  }
  if (command === "/pause") {
    await setPaused(user.id, true);
    return send(chatId, "⏸ Dein Suchprofil ist pausiert.");
  }
  if (command === "/resume") {
    await setPaused(user.id, false);
    return send(chatId, "▶️ Dein Suchprofil ist wieder aktiv.");
  }
  if (command === "/status") return renderStatus(user, chatId);
  if (command === "/hilfe" || command === "/help") {
    return send(chatId, HELP_TEXT);
  }
  if (command === "/premium") return premium(user, chatId);

  const draft = draftFor(user);
  if (user.onboarding_step === "rent_custom") {
    const value = Number(text.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(value) || value < 100 || value > 5000) {
      return send(
        chatId,
        "Bitte einen Betrag zwischen 100 und 5.000 eingeben.",
      );
    }
    draft.max_warm_rent = value;
    if (draft.profile_edit) {
      const slot = draft.profile_slot;
      delete draft.profile_edit;
      delete draft.edit_return;
      await persistProfile(user, draft);
      return profile(user, chatId, undefined, slot);
    }
    if (draft.edit_return) {
      delete draft.edit_return;
      return renderReview(user, chatId, message.message_id, draft);
    }
    await saveState(user.id, "rooms", draft);
    return send(chatId, "4/5 · <b>Mindestens wie viele Zimmer?</b>", {
      inline_keyboard: [
        [button("1+", "rooms:1"), button("2+", "rooms:2")],
        [button("3+", "rooms:3"), button("4+", "rooms:4")],
        backRow("rent"),
        cancelRow(),
      ],
    });
  }

  return send(
    chatId,
    "Bitte verwende die Befehle oder Buttons. Mit /hilfe siehst du alle Befehle.",
  );
}

async function handleCallback(query: any, user: any) {
  const chatId = Number(query.message?.chat.id);
  const messageId = Number(query.message?.message_id);
  const data = String(query.data || "");
  if (!chatId || !messageId) return acknowledge(query.id);

  if (data.startsWith("admin:")) {
  if (!isAdmin(user)) return acknowledge(query.id);
  if (data === "admin:list") {
    await acknowledge(query.id);
    return adminUsers(user, chatId, messageId);
  }
  if (data.startsWith("admin:user:")) {
    await acknowledge(query.id);
    return adminUser(
      user,
      chatId,
      messageId,
      data.slice("admin:user:".length),
    );
  }
  if (data.startsWith("admin:block:")) {
    const userId = data.slice("admin:block:".length);
    try {
      await setUserBlocked(userId, true);
      await acknowledge(query.id, "Nutzer gesperrt");
    } catch (error) {
      await acknowledge(query.id, String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Sperren fehlgeschlagen");
    }
    return adminUser(user, chatId, messageId, userId);
  }
  if (data.startsWith("admin:unblock:")) {
    const userId = data.slice("admin:unblock:".length);
    try {
      await setUserBlocked(userId, false);
      await acknowledge(query.id, "Nutzer entsperrt");
    } catch (error) {
      await acknowledge(query.id, String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Entsperren fehlgeschlagen");
    }
    return adminUser(user, chatId, messageId, userId);
  }
  if (data.startsWith("admin:delete-confirm:")) {
    const userId = data.slice("admin:delete-confirm:".length);
    try {
      await deleteUser(userId);
      await acknowledge(query.id, "Nutzer gelöscht");
    } catch (error) {
      await acknowledge(query.id, String(error).includes("admin accounts") ? "Admin-Konto geschützt" : "Löschen fehlgeschlagen");
    }
    return adminUsers(user, chatId, messageId);
  }
  if (data.startsWith("admin:delete:")) {
    const userId = data.slice("admin:delete:".length);
    await acknowledge(query.id);
    return edit(
      chatId,
      messageId,
      "🗑 <b>Nutzer wirklich löschen?</b>\n\nSuchprofile, gespeicherte Inserate, Referral- und Abo-Zuordnungen werden dauerhaft gelöscht.",
      { inline_keyboard: [
        [button("🗑 Ja, endgültig löschen", `admin:delete-confirm:${userId}`)],
        [button("← Abbrechen", `admin:user:${userId}`)],
      ] },
    );
  }
  if (data.startsWith("admin:set:")) {
    const parts = data.split(":");
    const userId = parts[2];
    const grant = parts[3] as AdminGrant;
    if (!userId || !["free", "7d", "30d", "3m", "life"].includes(grant)) {
      return acknowledge(query.id);
    }
    const target = await setPlanOverride(userId, grant);
    let noticeFailed = false;
    if (grant !== "free") {
      try {
        await send(Number(target.chat_id), adminPremiumNotice(grant));
      } catch (error) {
        noticeFailed = true;
        console.error("admin_premium_notice", error);
      }
    }
    await acknowledge(
      query.id,
      grant === "free"
        ? "Free gesetzt"
        : noticeFailed
        ? "Premium gesetzt · Nachricht fehlgeschlagen"
        : `${adminGrantLabel(grant)} Premium gesetzt`,
    );
    return adminUser(user, chatId, messageId, userId);
  }
  return acknowledge(query.id);
}

  if (data.startsWith("save:")) {
    const savedState = await toggleSave(user, data.slice(5));
    if (savedState === null) {
      await acknowledge(query.id);
      return premium(user, chatId, messageId);
    }
    return acknowledge(query.id, savedState ? "⭐️ Gespeichert" : "Entfernt");
  }

  await acknowledge(query.id);

  if (data === "noop") return;
  if (data === "cancel") {
    await saveState(user.id, null, {});
    return home({ ...user, onboarding_step: null, onboarding_state: {} }, chatId, messageId);
  }
  if (data === "home") {
    if (query.message?.photo) { await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {}); return home(user, chatId); }
    return home(user, chatId, messageId);
  }
  if (data === "new") return startNewProfile(user, chatId, messageId);
  if (data === "draft") {
    const draft = draftFor(user);
    const step = String(user.onboarding_step || "types") as OnboardingStep;
    return renderStep(
      user,
      chatId,
      messageId,
      draft,
      [
          "types",
          "location",
          "boroughs",
          "neighborhoods",
          "rent",
          "rent_custom",
          "rooms",
          "area",
          "review",
        ].includes(step)
        ? step
        : "types",
    );
  }
  if (data === "profile" || data === "profiles") return profile(user, chatId, messageId);
  if (data === "p:view:1") return profile(user, chatId, messageId, 1);
  if (data.startsWith("profile:view:")) return profile(user, chatId, messageId, Number(data.split(":")[2]));
  if (data.startsWith("profile:edit-field:")) {
    const parts = data.split(":");
    const slot = Number(parts[2]);
    const field = parts[3];
    if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user)) return;
    const { data: current, error } = await db
      .from("search_profiles")
      .select("*")
      .eq("user_id", user.id)
      .eq("profile_slot", slot)
      .maybeSingle();
    if (error) throw error;
    if (!current) return profile(user, chatId, messageId);
    const draft = await draftFromProfile(current);
    if (field === "types") return renderTypes(user, chatId, messageId, draft);
    if (field === "location") return renderLocation(user, chatId, messageId, draft);
    if (field === "rent") return renderRent(user, chatId, messageId, draft);
    if (field === "rooms") return renderRooms(user, chatId, messageId, draft);
    if (field === "area") return renderArea(user, chatId, messageId, draft);
    return profileEditMenu(user, chatId, messageId, slot);
  }
  if (data.startsWith("profile:edit:")) {
    return profileEditMenu(user, chatId, messageId, Number(data.split(":")[2]));
  }
  if (data.startsWith("profile:delete-confirm:")) {
    const slot = Number(data.split(":")[2]);
    if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user)) return;
    const { error } = await db
      .from("search_profiles")
      .delete()
      .eq("user_id", user.id)
      .eq("profile_slot", slot);
    if (error) throw error;
    return profile(user, chatId, messageId);
  }
  if (data.startsWith("profile:delete:")) {
    const slot = Number(data.split(":")[2]);
    if (!Number.isInteger(slot) || slot < 1 || slot > profileLimit(user)) return;
    return edit(
      chatId,
      messageId,
      "🗑 <b>Suchprofil löschen?</b>\n\nDiese Aktion kann nicht rückgängig gemacht werden.",
      { inline_keyboard: [
        [button("🗑 Ja, löschen", `profile:delete-confirm:${slot}`)],
        [button("← Abbrechen", `profile:view:${slot}`)],
      ] },
    );
  }
  if (data.startsWith("profile:pause:") || data.startsWith("profile:resume:")) {
    const slot = Number(data.split(":")[2]);
    await setPaused(user.id, data.startsWith("profile:pause:"), slot);
    return profile(user, chatId, messageId, slot);
  }
  if (data === "saved") return saved(user, chatId, messageId, 0);
  if (data.startsWith("saved:")) {
    return saved(user, chatId, messageId, Number(data.slice(6)) || 0);
  }
  if (data === "settings") return settings(user, chatId, messageId);
  if (data === "referral") return referralPage(user, chatId, messageId);
  if (data === "language") return languagePage(user, chatId, messageId);
  if (data.startsWith("lang:")) {
    const code = data.slice(5);
    if (!["de","en","ckb","ku","prs","fa","ru","tr","ar"].includes(code)) return;
    const { error } = await db.from("bot_users").update({ ui_language: code, updated_at: new Date().toISOString() }).eq("id", user.id);
    if (error) throw error;
    chatLanguages.set(chatId, code);
    return settings({ ...user, ui_language: code }, chatId, messageId);
  }
  if (data === "help") {
    return edit(chatId, messageId, HELP_TEXT, {
      inline_keyboard: [[button("← Zurück", "home")]],
    });
  }
  if (data === "premium") {
  if (query.message?.photo) return premium(user, chatId, messageId, true);
  await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {});
  return premium(user, chatId);
}
  if (data === "portal") {
    if (query.message?.photo) await telegram("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {});
    const url = await secret("stripe_portal_url").catch(() => null);
    const valid = url && /^https:\/\/billing\.stripe\.com\//.test(url);
    return edit(
      chatId,
      messageId,
      valid
        ? "💳 <b>Abo verwalten</b>"
        : "💳 Das Stripe Customer Portal ist aktuell noch nicht konfiguriert.",
      {
        inline_keyboard: [
          ...(valid ? [[{ text: "Stripe öffnen", url }]] : []),
          [button("← Premium", "premium")],
        ],
      },
    );
  }
  if (data === "pause") {
    await setPaused(user.id, true);
    return edit(
      chatId,
      messageId,
      "⏸ Dein Suchprofil ist pausiert.",
      homeKeyboard(user),
    );
  }
  if (data === "resume") {
    await setPaused(user.id, false);
    return edit(
      chatId,
      messageId,
      "▶️ Dein Suchprofil ist wieder aktiv.",
      homeKeyboard(user),
    );
  }
  if (data === "status") return renderStatus(user, chatId, messageId);

  const draft = draftFor(user);

  if (data === "types") return renderTypes(user, chatId, messageId, draft);
  if (data === "location") return renderLocation(user, chatId, messageId, draft);
  if (data === "boroughs") {
    return renderBoroughs(user, chatId, messageId, draft);
  }
  if (data === "neighborhoods") {
    return renderNeighborhoods(user, chatId, messageId, draft);
  }
  if (data === "rent") return renderRent(user, chatId, messageId, draft);
  if (data === "rooms") return renderRooms(user, chatId, messageId, draft);
  if (data === "area") return renderArea(user, chatId, messageId, draft);

  if (data.startsWith("edit:")) {
    draft.edit_return = true;
    const step = data.slice(5);
    if (step === "types") return renderTypes(user, chatId, messageId, draft);
    if (step === "location") {
      return renderLocation(user, chatId, messageId, draft);
    }
    if (step === "rent") return renderRent(user, chatId, messageId, draft);
    if (step === "rooms") return renderRooms(user, chatId, messageId, draft);
    if (step === "area") return renderArea(user, chatId, messageId, draft);
  }

  if (data.startsWith("type:")) {
    const value = data.slice(5);
    if (value === "all") draft.property_types = [...PROPERTY_TYPES];
    else if (value === "clear") draft.property_types = [];
    else if (value === "done") {
      if (!draft.property_types.length) {
        return renderTypes(user, chatId, messageId, draft);
      }
      return afterSelection(user, chatId, messageId, draft, "location");
    } else if (PROPERTY_TYPES.includes(value as PropertyType)) {
      const type = value as PropertyType;
      draft.property_types = draft.property_types.includes(type)
        ? draft.property_types.filter((entry) => entry !== type)
        : [...draft.property_types, type];
    }
    return renderTypes(user, chatId, messageId, draft);
  }

  if (data.startsWith("loc:")) {
    const value = data.slice(4);
    if (value === "all") {
      draft.location_mode = "all_hamburg";
      draft.borough_ids = [];
      draft.neighborhood_ids = [];
      return afterSelection(user, chatId, messageId, draft, "rent");
    }
    if (value === "boroughs") {
      draft.location_mode = "boroughs";
      draft.neighborhood_ids = [];
      return renderBoroughs(user, chatId, messageId, draft);
    }
    if (value === "neighborhoods") {
      draft.location_mode = "neighborhoods";
      draft.borough_ids = [];
      return renderNeighborhoods(user, chatId, messageId, draft);
    }
  }

  if (data.startsWith("borough:")) {
    const value = data.slice(8);
    const geo = await geography();
    if (value === "all") {
      draft.borough_ids = geo.boroughs.map((entry) => entry.id);
    } else if (value === "clear") {
      draft.borough_ids = [];
    } else if (value === "done") {
      if (!draft.borough_ids.length) {
        return renderBoroughs(user, chatId, messageId, draft);
      }
      return afterSelection(user, chatId, messageId, draft, "rent");
    } else {
      const id = Number(value);
      if (geo.boroughs.some((entry) => entry.id === id)) {
        draft.borough_ids = draft.borough_ids.includes(id)
          ? draft.borough_ids.filter((entry) => entry !== id)
          : [...draft.borough_ids, id];
      }
    }
    return renderBoroughs(user, chatId, messageId, draft);
  }

  if (data.startsWith("neighborhood:")) {
    const value = data.slice(13);
    const geo = await geography();
    if (value === "all") {
      draft.neighborhood_ids = geo.neighborhoods.map((entry) => entry.id);
    } else if (value === "clear") {
      draft.neighborhood_ids = [];
    } else if (value === "prev") {
      draft.neighborhood_page = Math.max(0, draft.neighborhood_page - 1);
    } else if (value === "next") {
      const pages = Math.max(
        1,
        Math.ceil(geo.neighborhoods.length / NEIGHBORHOODS_PER_PAGE),
      );
      draft.neighborhood_page = Math.min(
        pages - 1,
        draft.neighborhood_page + 1,
      );
    } else if (value === "done") {
      if (!draft.neighborhood_ids.length) {
        return renderNeighborhoods(user, chatId, messageId, draft);
      }
      return afterSelection(user, chatId, messageId, draft, "rent");
    } else {
      const id = Number(value);
      if (geo.neighborhoods.some((entry) => entry.id === id)) {
        draft.neighborhood_ids = draft.neighborhood_ids.includes(id)
          ? draft.neighborhood_ids.filter((entry) => entry !== id)
          : [...draft.neighborhood_ids, id];
      }
    }
    return renderNeighborhoods(user, chatId, messageId, draft);
  }

  if (data.startsWith("rent:")) {
    const value = data.slice(5);
    if (value === "custom") {
      return renderCustomRent(user, chatId, messageId, draft);
    }
    const amount = Number(value);
    if (RENT_PRESETS.has(amount)) {
      draft.max_warm_rent = amount;
      return afterSelection(user, chatId, messageId, draft, "rooms");
    }
    return renderRent(user, chatId, messageId, draft);
  }

  if (data.startsWith("rooms:")) {
    const rooms = Number(data.slice(6));
    if (ROOM_PRESETS.has(rooms)) {
      draft.min_rooms = rooms;
      return afterSelection(user, chatId, messageId, draft, "area");
    }
    return renderRooms(user, chatId, messageId, draft);
  }

  if (data.startsWith("area:")) {
    const area = Number(data.slice(5));
    if (AREA_PRESETS.has(area)) {
      draft.min_area_sqm = area;
      return afterSelection(user, chatId, messageId, draft, "review");
    }
    return renderArea(user, chatId, messageId, draft);
  }

  if (data === "profile:save" || data === "s:save") {
    const issue = validateDraft(draft);
    if (issue) return renderStep(user, chatId, messageId, draft, issue);
    await persistProfile(user, draft);
    return edit(
      chatId,
      messageId,
      "✅ Deine Suche ist aktiv. Neue passende Inserate werden automatisch zugestellt.",
      homeKeyboard({ ...user, onboarding_step: null }),
    );
  }
}

async function claimUpdate(payload: any) {
  const { error } = await db.from("bot_events").insert({
    telegram_update_id: payload.update_id,
    event_type: payload.callback_query
      ? "callback_query"
      : payload.message
      ? "message"
      : "other",
    telegram_user_id:
      payload.callback_query?.from?.id || payload.message?.from?.id || null,
    payload,
  });
  if (!error) return true;
  if (
    error.code === "23505" ||
    String(error.message).toLowerCase().includes("duplicate")
  ) {
    return false;
  }
  console.error("bot_event", error.message);
  return true;
}

Deno.serve(async (request: Request) => {
  try {
    if (request.method === "GET" || request.method === "HEAD") {
      const url = new URL(request.url);
      if (url.searchParams.get("asset") === "premium") {
        const raw = atob(PREMIUM_PREVIEW_B64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return new Response(request.method === "HEAD" ? null : bytes, {
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
          },
        });
      }
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    let expectedSecret = await secret("telegram_webhook_secret");
    const suppliedSecret =
      request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (suppliedSecret !== expectedSecret) {
      secretCache.delete("telegram_webhook_secret");
      expectedSecret = await secret("telegram_webhook_secret", true);
      if (suppliedSecret !== expectedSecret) {
        return new Response("unauthorized", { status: 401 });
      }
    }

    const payload = await request.json().catch(() => ({}));
    const from = payload.callback_query?.from || payload.message?.from;
    const chatId =
      payload.callback_query?.message?.chat?.id || payload.message?.chat?.id;
    if (!from?.id || !chatId) return Response.json({ ok: true, ignored: true });
    if (!(await claimUpdate(payload))) {
      return Response.json({ ok: true, duplicate: true });
    }

    const user = await withPlan(await ensureUser(from, Number(chatId)));
    if (!user.is_active && !isAdmin(user)) {
      return Response.json({ ok: true, blocked: true });
    }
    chatLanguages.set(Number(chatId), String(user.ui_language || "de"));
    if (payload.callback_query) {
      await handleCallback(payload.callback_query, user);
    } else if (
      payload.message?.chat?.type === "private" &&
      payload.message?.text
    ) {
      await handleMessage(payload.message, user);
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("telegram_command_runtime", error);
    return Response.json(
      { ok: false, error: "command_runtime_failed" },
      { status: 500 },
    );
  }
});
