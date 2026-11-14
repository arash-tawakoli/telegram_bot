// Only the Telegram home preview is localized; all buttons and other screens remain German.
export const HOME_LANGUAGES = {"de":"Deutsch","en":"English","ar":"العربية","prs":"دری","ckb":"کوردی (سۆرانی)","kmr":"Kurdî (Kurmancî)","ru":"Русский","uk":"Українська","tr":"Türkçe"};
const HOME_TEXT = {
  "de": {
    "what": "Was ist das?",
    "about": "Dein Bot, der rund um die Uhr passende Wohnungen sucht und dich automatisch bewirbt.",
    "how": "Wie funktioniert das?",
    "intro": "In drei Schritten zur automatisierten Bewerbung:",
    "steps": [
      "Suchprofil erstellen",
      "Bewerberprofil erstellen",
      "Auto-Bewerbung einrichten"
    ],
    "cta": "Jetzt loslegen! 👇"
  },
  "en": {
    "what": "What is it?",
    "about": "Your bot finds suitable homes around the clock and applies for you automatically.",
    "how": "How does it work?",
    "intro": "Three steps to automatic applications:",
    "steps": [
      "Create a search profile",
      "Create an applicant profile",
      "Set up auto-apply"
    ],
    "cta": "Get started! 👇"
  },
  "ar": {
    "what": "ما هو؟",
    "about": "مساعدك الذي يبحث عن مساكن مناسبة على مدار الساعة ويقدّم طلبات السكن نيابةً عنك تلقائيًا.",
    "how": "كيف يعمل؟",
    "intro": "ثلاث خطوات لتقديم طلبات السكن تلقائيًا:",
    "steps": [
      "إنشاء ملف البحث",
      "إنشاء ملف المتقدم",
      "إعداد التقديم التلقائي"
    ],
    "cta": "ابدأ الآن! 👇"
  },
  "prs": {
    "what": "این چیست؟",
    "about": "ربات شما که شبانه‌روز خانه‌های مناسب را جستجو می‌کند و به‌طور خودکار برای شما درخواست می‌فرستد.",
    "how": "چگونه کار می‌کند؟",
    "intro": "سه گام تا درخواست خودکار:",
    "steps": [
      "ساخت پروفایل جستجو",
      "ساخت پروفایل درخواست‌دهنده",
      "تنظیم درخواست خودکار"
    ],
    "cta": "همین حالا شروع کنید! 👇"
  },
  "ckb": {
    "what": "ئەمە چییە؟",
    "about": "بۆتەکەت بە شەو و ڕۆژ خانووی گونجاو دەگەڕێت و بە شێوەیەکی خۆکار داواکاری بۆت دەنێرێت.",
    "how": "چۆن کار دەکات؟",
    "intro": "بە سێ هەنگاو بۆ داواکاریی خۆکار:",
    "steps": [
      "دروستکردنی پرۆفایلی گەڕان",
      "دروستکردنی پرۆفایلی داواکار",
      "ڕێکخستنی داواکاریی خۆکار"
    ],
    "cta": "ئێستا دەست پێ بکە! 👇"
  },
  "kmr": {
    "what": "Ev çi ye?",
    "about": "Bota te ku şev û roj xaniyên guncaw digere û bi awayekî xweber ji bo te serlêdanan dişîne.",
    "how": "Çawa dixebite?",
    "intro": "Di sê gavan de serlêdana xweber:",
    "steps": [
      "Profîla lêgerînê çêbike",
      "Profîla serlêderî çêbike",
      "Serlêdana xweber saz bike"
    ],
    "cta": "Niha dest pê bike! 👇"
  },
  "ru": {
    "what": "Что это?",
    "about": "Бот круглосуточно ищет подходящее жильё и автоматически подаёт заявки от вашего имени.",
    "how": "Как это работает?",
    "intro": "Три шага к автоматической подаче заявок:",
    "steps": [
      "Создать профиль поиска",
      "Создать профиль заявителя",
      "Настроить автоподачу заявок"
    ],
    "cta": "Начните прямо сейчас! 👇"
  },
  "uk": {
    "what": "Що це?",
    "about": "Бот цілодобово шукає відповідне житло й автоматично подає заявки від вашого імені.",
    "how": "Як це працює?",
    "intro": "Три кроки до автоматичного подання заявок:",
    "steps": [
      "Створити профіль пошуку",
      "Створити профіль заявника",
      "Налаштувати автоподання заявок"
    ],
    "cta": "Почніть зараз! 👇"
  },
  "tr": {
    "what": "Bu nedir?",
    "about": "Sana uygun evleri günün her saati arayan ve senin adına otomatik başvuru yapan botun.",
    "how": "Nasıl çalışır?",
    "intro": "Otomatik başvuruya üç adımda ulaş:",
    "steps": [
      "Arama profili oluştur",
      "Başvuru profili oluştur",
      "Otomatik başvuruyu ayarla"
    ],
    "cta": "Hemen başla! 👇"
  }
};

export function homePreview(language='de') {
  const copy = HOME_TEXT[language] || HOME_TEXT.de;
  return '🏠 <b>Traumwohnung Hamburg</b>\n\n'
    +'<b>'+copy.what+'</b>\n'+copy.about+'\n\n'
    +'<b>'+copy.how+'</b>\n'+copy.intro+'\n\n'
    +copy.steps.map((step,index)=>(index+1)+'. '+step).join('\n')
    +'\n\n<b>'+copy.cta+'</b>';
}

export function languageMenu(user,chatId,messageId,send,edit,button){
  const rows=Object.entries(HOME_LANGUAGES).map(([code,name])=>
    [button((user?.language_selected_at&&user.ui_language===code?'✓ ':'')+name,'language:set:'+code)]);
  if(user?.language_selected_at)rows.push([button('← Einstellungen','settings')]);
  const text='<b>Sprache auswählen / Choose your language</b>\n\n'
    +'Nur der Vorschautext im Startmenü wird übersetzt.';
  return messageId?edit(chatId,messageId,text,{inline_keyboard:rows}):send(chatId,text,{inline_keyboard:rows});
}
