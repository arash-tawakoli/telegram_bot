import { saved, settings } from "./navigation.js";
import { profile } from "./profiles.js";
export const LANGS = {
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

export const TXT = {
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

export function textFor(language, key) {
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
    for (const [a, b] of [["1/4", "1/5"], ["2/4", "2/5"], ["3/4", "3/5"], ["4/4", "5/5"]]) {
        for (const key of Object.keys(TXT[lang] || {}))
            TXT[lang][key] = String(TXT[lang][key]).replace(a, b);
    }
    if (TXT[lang]?.save)
        TXT[lang].save = TXT[lang].save.replace("💾", "⭐️");
    if (TXT[lang]?.saved)
        TXT[lang].saved = TXT[lang].saved.replace("💾", "⭐️");
    if (TXT[lang]?.savedState)
        TXT[lang].savedState = TXT[lang].savedState.replace("✅", "⭐️").replace("💾", "⭐️");
}

export const EXTRA = {
    en: { "Suchprofil": "Search profile", "Meine Suchprofile": "My search profiles", "Suchprofile angelegt": "search profiles created", "Suchprofile aktiv": "Active search profiles", "Premium aktiv": "Premium active", "Traumwohnung Premium": "Traumwohnung Premium", "Premium ist aktiv.": "Premium is active.", "Deine Vorteile:": "Your benefits:", "Sofortige Zustellung": "Instant delivery", "Bis zu 3 Suchprofile": "Up to 3 search profiles", "Baugenossenschafts-Angebote öffnen": "Open housing-cooperative listings", "Inserate speichern": "Save listings", "Keine Mindestlaufzeit · jederzeit kündbar": "No minimum term · cancel anytime", "Premium freischalten": "Unlock Premium", "Abo verwalten": "Manage subscription", "Freunde empfehlen": "Refer friends", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Recommend Traumwohnung Hamburg and you both receive 7 days Premium for free", "Erfolgreiche Empfehlungen": "Successful referrals", "Sprachen": "Languages", "Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.": "Choose your language. The complete bot menu will be shown accordingly.", "Quellen im System": "Sources in the system", "Systemstatus": "System status", "System: online": "System: online", "Suchprofil erstellen": "Create search profile", "Noch kein Suchprofil angelegt.": "No search profile yet.", "Suchprofil ändern": "Edit search profile", "Pausieren": "Pause", "Fortsetzen": "Resume", "Gespeichert": "Saved", "Hilfe": "Help", "Status": "Status", "Einstellungen": "Settings", "Entwurf fortsetzen": "Continue draft" },
    tr: { "Suchprofil": "Arama profili", "Meine Suchprofile": "Arama profillerim", "Suchprofile angelegt": "arama profili oluşturuldu", "Suchprofile aktiv": "Aktif arama profilleri", "Premium aktiv": "Premium aktif", "Premium ist aktiv.": "Premium aktif.", "Deine Vorteile:": "Avantajların:", "Sofortige Zustellung": "Anında teslim", "Bis zu 3 Suchprofile": "3 arama profiline kadar", "Baugenossenschafts-Angebote öffnen": "Konut kooperatifi ilanlarını aç", "Inserate speichern": "İlanları kaydet", "Keine Mindestlaufzeit · jederzeit kündbar": "Minimum süre yok · istediğin zaman iptal", "Premium freischalten": "Premium'u aç", "Abo verwalten": "Aboneliği yönet", "Freunde empfehlen": "Arkadaşlarını davet et", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg'u önerin; ikiniz de 7 gün Premium'u ücretsiz alın", "Erfolgreiche Empfehlungen": "Başarılı davetler", "Sprachen": "Diller", "Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.": "Dilini seç. Bot menüsünün tamamı buna göre gösterilir.", "Quellen im System": "Sistemdeki kaynaklar", "Systemstatus": "Sistem durumu", "System: online": "Sistem: çevrimiçi", "Suchprofil erstellen": "Arama profili oluştur", "Noch kein Suchprofil angelegt.": "Henüz arama profili yok.", "Suchprofil ändern": "Arama profilini düzenle", "Pausieren": "Duraklat", "Fortsetzen": "Devam et", "Gespeichert": "Kaydedildi", "Hilfe": "Yardım", "Status": "Durum", "Einstellungen": "Ayarlar", "Entwurf fortsetzen": "Taslağa devam et" },
    ru: { "Suchprofil": "Профиль поиска", "Meine Suchprofile": "Мои профили поиска", "Suchprofile angelegt": "профилей поиска создано", "Suchprofile aktiv": "Активные профили поиска", "Premium aktiv": "Premium активен", "Premium ist aktiv.": "Premium активен.", "Deine Vorteile:": "Ваши преимущества:", "Sofortige Zustellung": "Мгновенная доставка", "Bis zu 3 Suchprofile": "До 3 профилей поиска", "Baugenossenschafts-Angebote öffnen": "Открывать объявления жилищных кооперативов", "Inserate speichern": "Сохранять объявления", "Keine Mindestlaufzeit · jederzeit kündbar": "Без минимального срока · отмена в любое время", "Premium freischalten": "Подключить Premium", "Abo verwalten": "Управлять подпиской", "Freunde empfehlen": "Пригласить друзей", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Порекомендуйте Traumwohnung Hamburg — вы оба получите 7 дней Premium бесплатно", "Erfolgreiche Empfehlungen": "Успешные рекомендации", "Sprachen": "Языки", "Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.": "Выберите язык. Всё меню бота будет показано на нём.", "Quellen im System": "Источники в системе", "Systemstatus": "Статус системы", "System: online": "Система: онлайн", "Suchprofil erstellen": "Создать профиль поиска", "Noch kein Suchprofil angelegt.": "Профиль поиска пока не создан.", "Suchprofil ändern": "Изменить профиль поиска", "Pausieren": "Пауза", "Fortsetzen": "Продолжить", "Gespeichert": "Сохранено", "Hilfe": "Помощь", "Status": "Статус", "Einstellungen": "Настройки", "Entwurf fortsetzen": "Продолжить черновик" },
    ar: { "Suchprofil": "ملف البحث", "Meine Suchprofile": "ملفات البحث الخاصة بي", "Suchprofile angelegt": "ملفات بحث تم إنشاؤها", "Suchprofile aktiv": "ملفات البحث النشطة", "Premium aktiv": "Premium مفعّل", "Premium ist aktiv.": "Premium مفعّل.", "Deine Vorteile:": "مزاياك:", "Sofortige Zustellung": "إرسال فوري", "Bis zu 3 Suchprofile": "حتى 3 ملفات بحث", "Baugenossenschafts-Angebote öffnen": "فتح عروض تعاونيات الإسكان", "Inserate speichern": "حفظ الإعلانات", "Keine Mindestlaufzeit · jederzeit kündbar": "لا توجد مدة دنيا · إلغاء في أي وقت", "Premium freischalten": "تفعيل Premium", "Abo verwalten": "إدارة الاشتراك", "Freunde empfehlen": "دعوة الأصدقاء", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "رشّح Traumwohnung Hamburg وسيحصل كلاكما على 7 أيام Premium مجانًا", "Erfolgreiche Empfehlungen": "الإحالات الناجحة", "Sprachen": "اللغات", "Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.": "اختر لغتك. ستظهر قائمة البوت كاملة بهذه اللغة.", "Quellen im System": "المصادر في النظام", "Systemstatus": "حالة النظام", "System: online": "النظام: متصل", "Suchprofil erstellen": "إنشاء ملف بحث", "Noch kein Suchprofil angelegt.": "لم يتم إنشاء ملف بحث بعد.", "Suchprofil ändern": "تعديل ملف البحث", "Pausieren": "إيقاف مؤقت", "Fortsetzen": "متابعة", "Gespeichert": "تم الحفظ", "Hilfe": "مساعدة", "Status": "الحالة", "Einstellungen": "الإعدادات", "Entwurf fortsetzen": "متابعة المسودة" },
    fa: { "Suchprofil": "پروفایل جستجو", "Meine Suchprofile": "پروفایل‌های جستجوی من", "Suchprofile angelegt": "پروفایل جستجو ساخته شده", "Suchprofile aktiv": "پروفایل‌های جستجوی فعال", "Premium aktiv": "Premium فعال", "Premium ist aktiv.": "Premium فعال است.", "Deine Vorteile:": "مزایای شما:", "Sofortige Zustellung": "ارسال فوری", "Bis zu 3 Suchprofile": "تا ۳ پروفایل جستجو", "Baugenossenschafts-Angebote öffnen": "باز کردن آگهی‌های تعاونی مسکن", "Inserate speichern": "ذخیره آگهی‌ها", "Keine Mindestlaufzeit · jederzeit kündbar": "بدون حداقل مدت · لغو در هر زمان", "Premium freischalten": "فعال‌سازی Premium", "Abo verwalten": "مدیریت اشتراک", "Freunde empfehlen": "معرفی به دوستان", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۷ روز Premium رایگان دریافت می‌کنید", "Erfolgreiche Empfehlungen": "معرفی‌های موفق", "Sprachen": "زبان‌ها", "Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.": "زبان خود را انتخاب کنید. تمام منوی ربات به آن زبان نمایش داده می‌شود.", "Quellen im System": "منابع در سیستم", "Systemstatus": "وضعیت سیستم", "System: online": "سیستم: آنلاین", "Suchprofil erstellen": "ساخت پروفایل جستجو", "Noch kein Suchprofil angelegt.": "هنوز پروفایل جستجو ساخته نشده است.", "Suchprofil ändern": "ویرایش پروفایل جستجو", "Pausieren": "توقف", "Fortsetzen": "ادامه", "Gespeichert": "ذخیره شد", "Hilfe": "راهنما", "Status": "وضعیت", "Einstellungen": "تنظیمات", "Entwurf fortsetzen": "ادامه پیش‌نویس" },
    prs: { "Suchprofil": "پروفایل جستجو", "Meine Suchprofile": "پروفایل‌های جستجوی من", "Suchprofile angelegt": "پروفایل جستجو ساخته شده", "Suchprofile aktiv": "پروفایل‌های جستجوی فعال", "Premium aktiv": "Premium فعال", "Premium ist aktiv.": "Premium فعال است.", "Deine Vorteile:": "مزایای شما:", "Sofortige Zustellung": "ارسال فوری", "Bis zu 3 Suchprofile": "تا ۳ پروفایل جستجو", "Baugenossenschafts-Angebote öffnen": "باز کردن آگهی‌های تعاونی مسکن", "Inserate speichern": "ذخیره آگهی‌ها", "Keine Mindestlaufzeit · jederzeit kündbar": "بدون حداقل مدت · لغو در هر زمان", "Premium freischalten": "فعال‌سازی Premium", "Abo verwalten": "مدیریت اشتراک", "Freunde empfehlen": "معرفی به دوستان", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۷ روز Premium رایگان دریافت می‌کنید", "Erfolgreiche Empfehlungen": "معرفی‌های موفق", "Sprachen": "زبان‌ها", "Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.": "زبان خود را انتخاب کنید. تمام منوی ربات به آن زبان نمایش داده می‌شود.", "Quellen im System": "منابع در سیستم", "Systemstatus": "وضعیت سیستم", "System: online": "سیستم: آنلاین", "Suchprofil erstellen": "ساخت پروفایل جستجو", "Noch kein Suchprofil angelegt.": "هنوز پروفایل جستجو ساخته نشده است.", "Suchprofil ändern": "ویرایش پروفایل جستجو", "Pausieren": "توقف", "Fortsetzen": "ادامه", "Gespeichert": "ذخیره شد", "Hilfe": "راهنما", "Status": "وضعیت", "Einstellungen": "تنظیمات", "Entwurf fortsetzen": "ادامه پیش‌نویس" },
    ckb: { "Suchprofil": "پڕۆفایلی گەڕان", "Meine Suchprofile": "پڕۆفایلەکانی گەڕانم", "Suchprofile angelegt": "پڕۆفایلی گەڕان دروستکراوە", "Suchprofile aktiv": "پڕۆفایلە چالاکەکانی گەڕان", "Premium aktiv": "Premium چالاک", "Premium ist aktiv.": "Premium چالاکە.", "Deine Vorteile:": "سوودەکانت:", "Sofortige Zustellung": "گەیاندنی دەستبەجێ", "Bis zu 3 Suchprofile": "تا ٣ پڕۆفایلی گەڕان", "Baugenossenschafts-Angebote öffnen": "کردنەوەی ڕیکلامەکانی کۆمەڵەی نیشتەجێبوون", "Inserate speichern": "پاشەکەوتکردنی ڕیکلامەکان", "Keine Mindestlaufzeit · jederzeit kündbar": "هیچ ماوەی کەمترین نییە · هەرکات دەتوانیت هەڵبوەشێنیتەوە", "Premium freischalten": "Premium چالاک بکە", "Abo verwalten": "بەڕێوەبردنی بەشداری", "Freunde empfehlen": "هاوڕێ پێشنیار بکە", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg پێشنیار بکە و هەردووکتان ٧ ڕۆژ Premium بەخۆڕایی وەردەگرن", "Erfolgreiche Empfehlungen": "پێشنیارە سەرکەوتووەکان", "Sprachen": "زمانەکان", "Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.": "زمانەکەت هەڵبژێرە. هەموو مینیوی بۆت بەو زمانە پیشان دەدرێت.", "Quellen im System": "سەرچاوەکان لە سیستەم", "Systemstatus": "دۆخی سیستەم", "System: online": "سیستەم: ئۆنلاین", "Suchprofil erstellen": "دروستکردنی پڕۆفایلی گەڕان", "Noch kein Suchprofil angelegt.": "هێشتا پڕۆفایلی گەڕان دروست نەکراوە.", "Suchprofil ändern": "دەستکاریکردنی پڕۆفایلی گەڕان", "Pausieren": "وەستاندن", "Fortsetzen": "بەردەوامبوون", "Gespeichert": "پاشەکەوتکرا", "Hilfe": "یارمەتی", "Status": "دۆخ", "Einstellungen": "ڕێکخستنەکان", "Entwurf fortsetzen": "بەردەوامبوون لە ڕەشنووس" },
    ku: { "Suchprofil": "Profîla lêgerînê", "Meine Suchprofile": "Profîlên lêgerîna min", "Suchprofile angelegt": "profîlên lêgerînê hatine çêkirin", "Suchprofile aktiv": "Profîlên lêgerînê yên çalak", "Premium aktiv": "Premium çalak", "Premium ist aktiv.": "Premium çalak e.", "Deine Vorteile:": "Feydeyên te:", "Sofortige Zustellung": "Şandina yekser", "Bis zu 3 Suchprofile": "Heta 3 profîlên lêgerînê", "Baugenossenschafts-Angebote öffnen": "Îlanên kooperatîfên xanî vekin", "Inserate speichern": "Îlanan tomar bike", "Keine Mindestlaufzeit · jederzeit kündbar": "Demê herî kêm tune · her dem dikarî betal bikî", "Premium freischalten": "Premium çalak bike", "Abo verwalten": "Abonetiya birêve bibe", "Freunde empfehlen": "Hevalan pêşniyar bike", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 7 Tage Premium kostenlos": "Traumwohnung Hamburg pêşniyar bike û hûn herdu 7 roj Premium belaş bistînin", "Erfolgreiche Empfehlungen": "Pêşniyarên serketî", "Sprachen": "Ziman", "Wähle deine Sprache. Das komplette Bot-Menü wird entsprechend angezeigt.": "Zimanê xwe hilbijêre. Hemû menuya botê bi wî zimanî tê nîşandan.", "Quellen im System": "Çavkanî di pergalê de", "Systemstatus": "Rewşa pergalê", "System: online": "Pergal: online", "Suchprofil erstellen": "Profîla lêgerînê biafirîne", "Noch kein Suchprofil angelegt.": "Hîn profîlek lêgerînê tune.", "Suchprofil ändern": "Profîla lêgerînê biguherîne", "Pausieren": "Rawestîne", "Fortsetzen": "Bidomîne", "Gespeichert": "Tomarkirî", "Hilfe": "Alîkarî", "Status": "Rewş", "Einstellungen": "Mîheng", "Entwurf fortsetzen": "Pêşnivîsê bidomîne" },
};
Object.assign(EXTRA.en, { "30 Tage Premium für 0 €": "30 days Premium for €0", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎": "Recommend Traumwohnung Hamburg and you both receive 30 days Premium for free 💎", "Abbrechen": "Cancel" });
Object.assign(EXTRA.tr, { "30 Tage Premium für 0 €": "0 €'ya 30 Gün Premium", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎": "Traumwohnung Hamburg'u önerin; ikiniz de 30 gün Premium'u ücretsiz alın 💎", "Abbrechen": "İptal" });
Object.assign(EXTRA.ru, { "30 Tage Premium für 0 €": "30 дней Premium за 0 €", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎": "Порекомендуйте Traumwohnung Hamburg — вы оба получите 30 дней Premium бесплатно 💎", "Abbrechen": "Отмена" });
Object.assign(EXTRA.ar, { "30 Tage Premium für 0 €": "30 يوم Premium مقابل 0 €", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎": "رشّح Traumwohnung Hamburg وسيحصل كلاكما على 30 يومًا من Premium مجانًا 💎", "Abbrechen": "إلغاء" });
Object.assign(EXTRA.fa, { "30 Tage Premium für 0 €": "۳۰ روز Premium با ۰ €", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎": "Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۳۰ روز Premium رایگان دریافت می‌کنید 💎", "Abbrechen": "لغو" });
Object.assign(EXTRA.prs, { "30 Tage Premium für 0 €": "۳۰ روز Premium با ۰ €", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎": "Traumwohnung Hamburg را معرفی کنید و هر دوی شما ۳۰ روز Premium رایگان دریافت می‌کنید 💎", "Abbrechen": "لغو" });
Object.assign(EXTRA.ckb, { "30 Tage Premium für 0 €": "٣٠ ڕۆژ Premium بە ٠ €", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎": "Traumwohnung Hamburg پێشنیار بکە و هەردووکتان ٣٠ ڕۆژ Premium بەخۆڕایی وەردەگرن 💎", "Abbrechen": "هەڵوەشاندنەوە" });
Object.assign(EXTRA.ku, { "30 Tage Premium für 0 €": "30 roj Premium bi 0 €", "Empfehle Traumwohnung Hamburg weiter und erhaltet beide 30 Tage Premium kostenlos 💎": "Traumwohnung Hamburg pêşniyar bike û hûn herdu 30 roj Premium belaş bistînin 💎", "Abbrechen": "Betal bike" });

export const CURRENT_ALIASES = [
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

export function localizeText(text, language) {
    const lang = language && TXT[language] ? language : "de";
    if (lang === "de")
        return text;
    let out = text;
    for (const [from, key] of CURRENT_ALIASES.sort((a, b) => b[0].length - a[0].length))
        out = out.split(from).join(TXT[lang]?.[key] || from);
    const extra = EXTRA[lang] || {};
    for (const from of Object.keys(extra).sort((a, b) => b.length - a.length))
        out = out.split(from).join(extra[from]);
    return out;
}

export function localizeMarkup(markup, language) {
    if (!markup || typeof markup !== "object")
        return markup;
    const copy = structuredClone(markup);
    if (Array.isArray(copy.inline_keyboard))
        for (const row of copy.inline_keyboard)
            for (const item of row || [])
                if (item?.text)
                    item.text = localizeText(String(item.text), language);
    return copy;
}
