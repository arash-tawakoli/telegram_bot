import test from "node:test";
import assert from "node:assert/strict";
import {
  listingCaption, listingKeyboard, listingPhotoRequest, listingImageUrl,
  resolveListingImage, sendListingPhoto,
} from "../src/telegram-listing-preview.js";

const url = "https://www.immowelt.de/expose/123";
const image = "https://mms.immowelt.de/a/b/c/d/example.jpg?w=626&h=470";
const facts = {
  title: "Wohnung zur Miete - Hamburg - 1.300 € - 3 Zimmer, 90 m², 2. Geschoss",
  city: "Hamburg", district: "Eidelstedt", postal_code: "22523",
  borough: "Eimsbüttel", address: "Lüttwisch 2", cold_rent: 1300,
  rooms: 3, area_sqm: 90, floor: "2. Geschoss", property_type: "Wohnung",
};

test("listing message matches the original large-photo fact card layout", () => {
  const payload = listingPhotoRequest(123, image, facts, url, 3, "Immowelt Hamburg");
  assert.equal(payload.photo, image);
  assert.equal(payload.text, undefined);
  assert.equal(payload.parse_mode, "HTML");
  assert.match(payload.caption, /^🏠 <b>Wohnung zur Miete/);
  for (const label of ["Kaltmiete", "Zimmer", "Wohnfläche", "Etage", "Wohnungstyp", "Bezirk", "Stadtteil", "Adresse"]) {
    assert.match(payload.caption, new RegExp(label + ":"));
  }
  assert.match(payload.caption, /Lüttwisch 2, 22523 Hamburg/);
  assert.doesNotMatch(payload.caption, /Originalangebot öffnen/);
  assert.equal(payload.reply_markup.inline_keyboard.length, 3);
  assert.deepEqual(payload.reply_markup.inline_keyboard.map(row => row[0].text), [
    "Zu Immowelt", "⭐ Speichern", "🗺️ Google Map",
  ]);
  assert.equal(payload.reply_markup.inline_keyboard[0][0].url, url);
  assert.match(payload.reply_markup.inline_keyboard[1][0].url, /^https:\/\/t\.me\/share\/url\?/);
  assert.match(payload.reply_markup.inline_keyboard[2][0].url, /^https:\/\/www\.google\.com\/maps\/search\/\?/);
});

test("unknown fields stay absent, HTML is escaped and captions stay under Telegram limit", () => {
  const caption = listingCaption({ title: "<script>" + "Long title ".repeat(40), warm_rent: null, rooms: "" });
  assert.doesNotMatch(caption, /<script>/);
  assert.doesNotMatch(caption, /Warmmiete|Zimmer:/);
  assert.ok(caption.length < 1024);
  assert.match(caption, /^🏠 <b>/);
});

test("only expected HTTPS image hosts are eligible for the photo card", () => {
  assert.equal(listingImageUrl(image), image);
  assert.equal(listingImageUrl("http://mms.immowelt.de/a.jpg"), null);
  assert.equal(listingImageUrl("https://evil.example/a.jpg"), null);
  assert.equal(listingImageUrl("https://127.0.0.1/a.jpg"), null);
  assert.throws(() => listingPhotoRequest(1, null, facts, url, 3, "Immowelt"), /listing_photo_missing/);
});

test("Immowelt exposes can supply a verified og:image when a search card lacks it", async () => {
  const calls = [];
  const request = async (target) => {
    calls.push(target);
    return new Response('<meta content="https://mms.immowelt.de/a/b/c/d/example.jpg" property="og:image">', { status: 200 });
  };
  assert.equal(await resolveListingImage({}, url, 3, request), "https://mms.immowelt.de/a/b/c/d/example.jpg");
  assert.deepEqual(calls, [url]);
  calls.length = 0;
  assert.equal(await resolveListingImage({}, url, 1, request), null);
  assert.deepEqual(calls, []);
});

test("sendPhoto success sends exactly one photo card, not a text preview", async () => {
  const payload = listingPhotoRequest(123, image, facts, url, 3, "Immowelt");
  const requests = [];
  const request = async (endpoint, options) => {
    requests.push({ endpoint, options });
    return Response.json({ ok: true, result: { message_id: 42 } });
  };
  const result = await sendListingPhoto("fake", payload, request);
  assert.equal(result.data.result.message_id, 42);
  assert.equal(requests.length, 1);
  assert.match(requests[0].endpoint, /\/sendPhoto$/);
  assert.equal(JSON.parse(requests[0].options.body).caption, payload.caption);
});

test("known image URL rejection may retry with validated binary, never with text", async () => {
  const payload = listingPhotoRequest(123, image, facts, url, 3, "Immowelt");
  const requests = [];
  const request = async (target, options) => {
    requests.push({ target, options });
    if (target === image) return new Response(new Uint8Array([255, 216, 255, 0, 0]));
    if (requests.filter(x => x.target.endsWith("/sendPhoto")).length === 1)
      return Response.json({ ok: false, description: "Bad Request: failed to get HTTP URL content" }, { status: 400 });
    return Response.json({ ok: true, result: { message_id: 43 } });
  };
  const result = await sendListingPhoto("fake", payload, request);
  assert.equal(result.data.result.message_id, 43);
  assert.equal(requests.filter(x => x.target.endsWith("/sendPhoto")).length, 2);
  assert.ok(requests[2].options.body instanceof FormData);
  assert.equal(requests[2].options.body.get("caption"), payload.caption);
  assert.equal(requests[2].options.body.get("reply_markup"), JSON.stringify(payload.reply_markup));
});

test("an ambiguous Telegram send never triggers another send", async () => {
  const payload = listingPhotoRequest(123, image, facts, url, 3, "Immowelt");
  let calls = 0;
  await assert.rejects(() => sendListingPhoto("fake", payload, async () => {
    calls++;
    throw new Error("transport lost");
  }), /transport lost/);
  assert.equal(calls, 1);
});

test("missing or invalid photographs never degrade to text messages", async () => {
  const payload = listingPhotoRequest(123, image, facts, url, 3, "Immowelt");
  const requests = [];
  const request = async (target, options) => {
    requests.push({ target, options });
    if (target === image) return new Response("Not a real image", { status: 200 });
    return Response.json({ ok: false, description: "Bad Request: failed to get HTTP URL content" }, { status: 400 });
  };
  const result = await sendListingPhoto("fake", payload, request);
  assert.equal(result.response.status, 400);
  assert.equal(requests.length, 2);
  assert.match(requests[0].target, /sendPhoto$/);
  assert.equal(requests.some(x => /sendMessage/.test(x.target)), false);
});

test("map queries use verified coordinates and source link stays on original platform", () => {
  const board = listingKeyboard({ latitude: 53.6, longitude: 10.2 }, "https://www.immobilienscout24.de/expose/123", 1, "ImmoScout24 Hamburg");
  assert.match(board.inline_keyboard[2][0].url, /53\.6%2C10\.2/);
  assert.equal(board.inline_keyboard[0][0].text, "Zu ImmoScout24");
});
