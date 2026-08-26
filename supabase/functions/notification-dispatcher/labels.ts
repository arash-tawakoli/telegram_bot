export const LABELS: Record<string, Record<string, string>> = {
  de:{missing:"nicht angegeben",address:"Adresse",warm:"Warmmiete",cold:"Kaltmiete",heating:"Heizkosten",additional:"Nebenkosten",deposit:"Kaution",rooms:"Zimmer",area:"Fläche",save:"💾 Speichern",maps:"📍 Google Maps"},
  en:{missing:"not provided",address:"Address",warm:"Warm rent",cold:"Cold rent",heating:"Heating",additional:"Additional costs",deposit:"Deposit",rooms:"Rooms",area:"Area",save:"💾 Save",maps:"📍 Google Maps"},
  tr:{missing:"belirtilmedi",address:"Adres",warm:"Sıcak kira",cold:"Soğuk kira",heating:"Isıtma",additional:"Ek giderler",deposit:"Depozito",rooms:"Oda",area:"Alan",save:"💾 Kaydet",maps:"📍 Google Maps"},
  ar:{missing:"غير مذكور",address:"العنوان",warm:"الإيجار الشامل",cold:"الإيجار الأساسي",heating:"التدفئة",additional:"التكاليف الإضافية",deposit:"التأمين",rooms:"الغرف",area:"المساحة",save:"💾 حفظ",maps:"📍 Google Maps"},
  fa:{missing:"ذکر نشده",address:"آدرس",warm:"اجاره گرم",cold:"اجاره پایه",heating:"هزینه گرمایش",additional:"هزینه‌های جانبی",deposit:"ودیعه",rooms:"اتاق",area:"متراژ",save:"💾 ذخیره",maps:"📍 Google Maps"},
  prs:{missing:"ذکر نشده",address:"آدرس",warm:"کرایه گرم",cold:"کرایه پایه",heating:"گرمایش",additional:"مصارف جانبی",deposit:"تضمین",rooms:"اتاق",area:"مساحت",save:"💾 ذخیره",maps:"📍 Google Maps"},
  ps:{missing:"نه دی ښودل شوی",address:"پته",warm:"ګرم کرایه",cold:"اساسي کرایه",heating:"تودوخه",additional:"اضافي لګښتونه",deposit:"ضمانت",rooms:"خونې",area:"مساحت",save:"💾 خوندي",maps:"📍 Google Maps"},
  ckb:{missing:"نەدراوە",address:"ناونیشان",warm:"کرێی گەرم",cold:"کرێی سارد",heating:"گەرما",additional:"خەرجی زیادە",deposit:"بارمتە",rooms:"ژوور",area:"ڕووبەر",save:"💾 پاشەکەوت",maps:"📍 Google Maps"},
  ku:{missing:"nehatiye dayîn",address:"Navnîşan",warm:"Kirêya germ",cold:"Kirêya sar",heating:"Germkirin",additional:"Mesrefên din",deposit:"Depozîto",rooms:"Ode",area:"Rûber",save:"💾 Tomar bike",maps:"📍 Google Maps"},
  bad:{missing:"nehatiye dayîn",address:"Navnîşan",warm:"Kirêya germ",cold:"Kirêya sar",heating:"Germkirin",additional:"Mesrefên din",deposit:"Depozîto",rooms:"Ode",area:"Rûber",save:"💾 Tomar bike",maps:"📍 Google Maps"},
};
export function label(language:string|null|undefined,key:string){const lang=language&&LABELS[language]?language:"de";return LABELS[lang]?.[key]||LABELS.de[key]||key;}
