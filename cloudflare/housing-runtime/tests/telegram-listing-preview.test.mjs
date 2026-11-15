import test from "node:test";
import assert from "node:assert/strict";
import {
  listingCaption, listingHeadline, listingKeyboard, listingImageUrl, resolveListingImage,
} from "../src/telegram-listing-preview.js";

const source = "https://www.immowelt.de/expose/123";
const image = "https://mms.immowelt.de/a/b/c/d/example.jpg?w=626&h=470";

test("shared facts keep the original apartment details without a Telegram photo attachment", () => {
  const caption = listingCaption({
    title: "Wohnung zur Miete, Hamburg", city: "Hamburg", district: "Eidelstedt",
    postal_code: "22523", address: "Lüttwisch 2", cold_rent: 1300,
    rooms: 3, area_sqm: 90, floor: "2. Geschoss", property_type: "Wohnung",
  });
  for (const label of ["Kaltmiete", "Zimmer", "Wohnfläche", "Etage", "Wohnungstyp", "Stadtteil", "Adresse"]) {
    assert.match(caption, new RegExp(label + ":"));
  }
  assert.match(caption, /Lüttwisch 2, 22523 Hamburg/);
  assert.doesNotMatch(caption, /Originalangebot öffnen/);
  assert.ok(caption.length < 1024);
});

test("Immowelt search titles do not repeat prices, room counts or floor details", () => {
  const facts = {
    title: "Wohnung zur Miete - Hamburg - 1.300 € - 3 Zimmer, 90 m², 2. Geschoss",
    cold_rent: 1300, rooms: 3, area_sqm: 90, floor: "2. Geschoss",
    district: "Eidelstedt", city: "Hamburg", postal_code: "22523", address: "Lüttwisch 2",
  };
  assert.equal(listingHeadline(facts), "Wohnung zur Miete in Eidelstedt");
  const caption=listingCaption(facts);
  assert.match(caption, /^🏠 <b>Wohnung zur Miete in Eidelstedt<\/b>/);
  for (const detail of ["Kaltmiete:</b> 1.300 €","Zimmer:</b> 3","Wohnfläche:</b> 90 m²","Etage:</b> 2. Geschoss","Lüttwisch 2, 22523 Hamburg"])
    assert.ok(caption.includes(detail), detail);
  assert.equal((caption.match(/1.300 €/g)||[]).length,1);
  assert.equal((caption.match(/90 m²/g)||[]).length,1);
  assert.equal(listingHeadline({title:"Maisonette-Wohnung mit Dachterrasse in Harvestehude",district:"Harvestehude"}),
    "Maisonette-Wohnung mit Dachterrasse in Harvestehude");
});

test("unknown fields stay absent and HTML is escaped", () => {
  const caption = listingCaption({ title: "<script>alert(1)</script>", warm_rent: null, rooms: "" });
  assert.doesNotMatch(caption, /<script>/);
  assert.doesNotMatch(caption, /Warmmiete|Zimmer:/);
  assert.match(caption, /^🏠 <b>/);
});

test("source/save/map actions remain on the housing card", () => {
  const markup = listingKeyboard({ city: "Hamburg" }, source, 3, "Immowelt Hamburg", "00000000-0000-0000-0000-000000000003");
  assert.deepEqual(markup.inline_keyboard.map(row => row[0].text), [
    "Zu Immowelt", "⭐ Speichern", "🗺️ Google Map", "📤 Teilen",
  ]);
  assert.equal(markup.inline_keyboard[0][0].url, source);
  assert.equal(markup.inline_keyboard[1][0].callback_data, "save:00000000-0000-0000-0000-000000000003");
  assert.equal(markup.inline_keyboard[1][0].url, undefined);
  assert.match(markup.inline_keyboard[2][0].url, /^https:\/\/www\.google\.com\/maps\/search\//);
  assert.match(markup.inline_keyboard[3][0].url, /^https:\/\/t\.me\/share\/url\?/);
  assert.ok(markup.inline_keyboard[3][0].url.includes(encodeURIComponent(source)));
});

test("only approved HTTPS image hosts can be used in the Mini App", () => {
  assert.equal(listingImageUrl(image), image);
  assert.equal(listingImageUrl("http://mms.immowelt.de/a.jpg"), null);
  assert.equal(listingImageUrl("https://evil.example/a.jpg"), null);
  assert.equal(listingImageUrl("https://127.0.0.1/a.jpg"), null);
  assert.equal(listingImageUrl("https://mms.immowelt.de:8443/a.jpg"), null);
});

test("existing Immowelt OG picture resolver remains available for isolated pages", async () => {
  const calls = [];
  const request = async target => {
    calls.push(target);
    return new Response('<meta content="https://mms.immowelt.de/a/b/c/d/example.jpg" property="og:image">', { status: 200 });
  };
  assert.equal(await resolveListingImage({}, source, 3, request),
    "https://mms.immowelt.de/a/b/c/d/example.jpg");
  assert.deepEqual(calls, [source]);
  calls.length = 0;
  assert.equal(await resolveListingImage({}, source, 1, request), null);
  assert.deepEqual(calls, []);
});
