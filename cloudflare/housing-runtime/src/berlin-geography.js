// Berlin's 12 Bezirke and 97 Ortsteile. Source: Land Berlin borough and
// locality registers (2025/2026). Keep canonical German spellings stable.
const DISTRICTS = Object.freeze({
  "Mitte": ["Mitte","Moabit","Hansaviertel","Tiergarten","Wedding","Gesundbrunnen"],
  "Friedrichshain-Kreuzberg": ["Friedrichshain","Kreuzberg"],
  "Pankow": ["Prenzlauer Berg","Weißensee","Blankenburg","Heinersdorf","Karow","Stadtrandsiedlung Malchow","Pankow","Blankenfelde","Buch","Französisch Buchholz","Niederschönhausen","Rosenthal","Wilhelmsruh"],
  "Charlottenburg-Wilmersdorf": ["Charlottenburg","Westend","Charlottenburg-Nord","Wilmersdorf","Schmargendorf","Grunewald","Halensee"],
  "Spandau": ["Spandau","Haselhorst","Siemensstadt","Staaken","Gatow","Kladow","Hakenfelde","Falkenhagener Feld","Wilhelmstadt"],
  "Steglitz-Zehlendorf": ["Steglitz","Lichterfelde","Lankwitz","Zehlendorf","Dahlem","Nikolassee","Wannsee","Schlachtensee"],
  "Tempelhof-Schöneberg": ["Schöneberg","Friedenau","Tempelhof","Mariendorf","Marienfelde","Lichtenrade"],
  "Neukölln": ["Neukölln","Britz","Buckow","Rudow","Gropiusstadt"],
  "Treptow-Köpenick": ["Alt-Treptow","Plänterwald","Baumschulenweg","Johannisthal","Niederschöneweide","Altglienicke","Adlershof","Bohnsdorf","Oberschöneweide","Köpenick","Friedrichshagen","Rahnsdorf","Grünau","Müggelheim","Schmöckwitz"],
  "Marzahn-Hellersdorf": ["Marzahn","Biesdorf","Kaulsdorf","Mahlsdorf","Hellersdorf"],
  "Lichtenberg": ["Friedrichsfelde","Karlshorst","Lichtenberg","Fennpfuhl","Rummelsburg","Falkenberg","Malchow","Wartenberg","Neu-Hohenschönhausen","Alt-Hohenschönhausen"],
  "Reinickendorf": ["Reinickendorf","Tegel","Konradshöhe","Heiligensee","Frohnau","Hermsdorf","Waidmannslust","Lübars","Wittenau","Märkisches Viertel","Borsigwalde"],
});
export const BERLIN_BOROUGHS = Object.freeze(Object.keys(DISTRICTS));
export const BERLIN_LOCALITIES = Object.freeze(
  Object.entries(DISTRICTS).flatMap(([borough, localities]) =>
    localities.map(name => Object.freeze({ name, borough }))),
);
const boroughForLocality = new Map(BERLIN_LOCALITIES.map(x => [x.name.toLocaleLowerCase("de-DE"), x.borough]));

export function berlinBoroughFor(locality) {
  return boroughForLocality.get(String(locality || "").normalize("NFKC").toLocaleLowerCase("de-DE").trim()) || null;
}
