const de = {
  address: "Adresse",
  warm: "Warmmiete",
  cold: "Kaltmiete",
  heating: "Heizkosten",
  additional: "Nebenkosten",
  operating: "Betriebskosten",
  deposit: "Kaution",
  rooms: "Zimmer",
  area: "Wohnfläche",
  offer: "Angebot",
  save: "⭐️ Speichern",
  saved: "⭐️ Gespeichert",
  maps: "📍 Google Maps",
};
const en = {
  ...de,
  address: "Address",
  warm: "Warm rent",
  cold: "Cold rent",
  rooms: "Rooms",
  area: "Living area",
  offer: "Listing",
  save: "⭐️ Save",
  saved: "⭐️ Saved",
};
export const LABELS: any = {
  de,
  en,
  tr: de,
  ar: de,
  fa: de,
  prs: de,
  ps: de,
  ckb: de,
  ku: de,
};
export function label(language: string | null | undefined, key: string) {
  const l = language && LABELS[language] ? language : "de";
  return LABELS[l]?.[key] || de[key as keyof typeof de] || key;
}
