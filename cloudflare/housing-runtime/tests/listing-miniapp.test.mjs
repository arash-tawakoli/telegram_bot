import test from "node:test";
import assert from "node:assert/strict";
import { listingWebUrl, listingMessageRequest, sendListingMessage, listingMiniAppResponse } from "../src/listing-miniapp.js";

const delivery = "00000000-0000-0000-0000-000000000003";
const photo = "https://pictures.immobilienscout24.de/listing.jpg";
const source = "https://www.immobilienscout24.de/expose/123456";
const facts = { title: "Sonnige Wohnung", cold_rent: 621, rooms: 1, area_sqm: 45, city: "Hamburg", district: "Alsterdorf", image_url: photo };

test("unique HTTPS Mini App address per delivery with no other offers or query identifiers", () => {
  assert.equal(listingWebUrl(delivery), "https://traumwohnung-housing-runtime.arash-ce5.workers.dev/angebot/" + delivery);
  assert.notEqual(listingWebUrl(delivery), listingWebUrl("00000000-0000-0000-0000-000000000004"));
  assert.throws(() => listingWebUrl("../../../etc/passwd"), /listing_delivery_id_invalid/);
  assert.throws(() => listingWebUrl("delivery"), /listing_delivery_id_invalid/);
});

test("a Telegram listing is one photo preview with one title and exactly three action buttons", () => {
  const payload = listingMessageRequest(123, photo, facts, source, 1, "ImmoScout24", delivery);
  assert.equal(payload.chat_id, 123);
  assert.equal(payload.photo, undefined);
  assert.equal(payload.media_group_id, undefined);
  assert.match(payload.text, /Sonnige Wohnung/);
  assert.match(payload.text, /Kaltmiete/);
  assert.doesNotMatch(payload.text, /Wohnung einzeln ansehen/);
  assert.equal(payload.link_preview_options.prefer_large_media, true);
  assert.equal(payload.link_preview_options.show_above_text, true);
  assert.equal(payload.link_preview_options.url, listingWebUrl(delivery));
  assert.equal(payload.reply_markup.inline_keyboard.length, 3);
  assert.deepEqual(payload.reply_markup.inline_keyboard.map(row => row[0].text),
    ["Zu ImmoScout24", "⭐ Speichern", "🗺️ Google Map"]);
  assert.equal(payload.reply_markup.inline_keyboard[0][0].url, source);
  assert.throws(() => listingMessageRequest(123, null, facts, source, 1, "ImmoScout24", delivery), /listing_photo_missing/);
});

test("successful Telegram send makes exactly one sendMessage call, never photo or media group", async () => {
  const payload = listingMessageRequest(123, photo, facts, source, 1, "ImmoScout24", delivery);
  const calls = [];
  const send = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json({ ok: true, result: { message_id: 25 } });
  };
  const result = await sendListingMessage("fake", payload, send);
  assert.equal(result.data.result.message_id, 25);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sendMessage$/);
  assert.equal(calls[0].body.photo, undefined);
});

test("definitive Telegram errors do not cause duplicate listing messages", async () => {
  const payload = listingMessageRequest(123, photo, facts, source, 1, "ImmoScout24", delivery);
  const calls = [];
  const send = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ok:false,description:"Bad Request: BUTTON_TYPE_INVALID"},{status:400});
  };
  const result = await sendListingMessage("fake", payload, send);
  assert.equal(result.response.status,400);
  assert.equal(calls.length,1);
  assert.equal(calls[0].reply_markup.inline_keyboard.length,3);
});

test("ambiguous network failure never resends a listing", async () => {
  const payload = listingMessageRequest(123, photo, facts, source, 1, "ImmoScout24", delivery);
  let calls = 0;
  await assert.rejects(() => sendListingMessage("fake", payload, async () => {
    calls++;
    throw new Error("transport lost");
  }), /transport lost/);
  assert.equal(calls, 1);
});

test("isolated HTML displays only one whitelisted listing and never recipient information", async () => {
  let queries = 0;
  const sql = async (pieces, ...args) => {
    queries++;
    assert.match(pieces.join("?"), /d.status IN \('processing','sent'\)/);
    assert.deepEqual(args, [delivery]);
    return [{ source_id: 1, source_name: "ImmoScout24", canonical_url: source,
      facts: { ...facts, title: "Sonnige <Wohnung> & Balkon" } }];
  };
  const result = await listingMiniAppResponse(sql, delivery);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type"), /text\/html/);
  assert.match(result.headers.get("cache-control"), /no-store/);
  assert.match(result.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(queries, 1);
  const html = await result.text();
  assert.match(html, /<meta property="og:image" content="https:\/\/pictures\.immobilienscout24\.de\/listing\.jpg">/);
  assert.match(html, /<meta property="og:title" content="Sonnige &lt;Wohnung&gt; &amp; Balkon">/);
  assert.match(html, /Sonnige &lt;Wohnung&gt; &amp; Balkon/);
  assert.match(html, /telegram-web-app\.js/);
  assert.equal((html.match(/<img\b/g) || []).length, 1);
  assert.equal((html.match(/<article>/g) || []).length, 1);
  assert.doesNotMatch(html, /participant_id|telegram_chat_id|test_auto_apply|private_key/);
  assert.doesNotMatch(html, /otherListing|nextOffer|swiper|carousel/);
  assert.match(html, /Zu ImmoScout24/);
  assert.match(html, /Google Map/);
});

test("invalid and nonexistent deliveries cannot expose any listing data", async () => {
  let queried = false;
  const emptySql = async () => { queried = true; return []; };
  const invalid = await listingMiniAppResponse(emptySql, "not-a-delivery");
  assert.equal(invalid.status, 404);
  assert.equal(queried, false);
  const missing = await listingMiniAppResponse(emptySql, delivery);
  assert.equal(missing.status, 404);
  assert.equal(queried, true);
});

test("no reflected script injection in title, source label or address", async () => {
  const sql = async () => [{ source_id: 3, source_name: "<img src=x onerror=alert(1)>",
    canonical_url: "https://www.immowelt.de/expose/12",
    facts: { ...facts, image_url: "https://mms.immowelt.de/room.jpg",
      title: "<script>alert(1)</script>", city: "<b>Hamburg</b>" } }];
  const html = await (await listingMiniAppResponse(sql, delivery)).text();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;Hamburg&lt;\/b&gt;/);
});
