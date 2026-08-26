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
