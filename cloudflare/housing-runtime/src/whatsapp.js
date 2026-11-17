// Optional, explicit opt-in WAHA transport. WAHA itself requires a persistent Docker host.
const CHAT = /^[1-9]\d{7,14}@c\.us$/;
function origin(env) {
  try {
    const url = new URL(String(env?.WAHA_BASE_URL || ""));
    return url.protocol === "https:" && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}
export function whatsAppConfigured(env) {
  return env?.WAHA_ENABLED === "1" && Boolean(origin(env)) && Boolean(env.WAHA_API_KEY)
    && Boolean(env.WAHA_WEBHOOK_HMAC_KEY)
    && /^[1-9]\d{7,14}$/.test(String(env.WAHA_SENDER_NUMBER || ""))
    && /^[\w-]{1,40}$/.test(String(env.WAHA_SESSION || "default"));
}
async function hash(value) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(data)].map(n => n.toString(16).padStart(2, "0")).join("");
}
export async function whatsAppStatus(sql, id, env) {
  if (!whatsAppConfigured(env)) return { available: false, linked: false };
  const rows = await sql.unsafe("SELECT enabled FROM whatsapp_links WHERE participant_id=$1", [id]);
  return { available: true, linked: Number(rows[0]?.enabled) === 1 };
}
export async function startWhatsAppLink(sql, id, env) {
  if (!whatsAppConfigured(env)) throw new Error("whatsapp_unavailable");
  const token = [...crypto.getRandomValues(new Uint8Array(16))]
    .map(n => n.toString(16).padStart(2, "0")).join("");
  await sql.unsafe(
    "INSERT INTO whatsapp_link_tokens(participant_id,token_hash,expires_at) VALUES($1,$2,datetime('now','+30 minutes')) " +
    "ON CONFLICT(participant_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at",
    [id, await hash(token)]
  );
  return { ok: true, url: "https://wa.me/" + env.WAHA_SENDER_NUMBER +
    "?text=" + encodeURIComponent("START " + token) };
}
export async function stopWhatsApp(sql, id) {
  await sql.unsafe("UPDATE whatsapp_links SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE participant_id=$1", [id]);
  await sql.unsafe("DELETE FROM whatsapp_link_tokens WHERE participant_id=$1", [id]);
  return { ok: true };
}
async function authenticated(request, secret, raw) {
  const mac = String(request.headers.get("x-webhook-hmac") || "");
  if (request.headers.get("x-webhook-hmac-algorithm")?.toLowerCase() !== "sha512"
    || !/^[a-f0-9]{128}$/i.test(mac)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const actual = Uint8Array.from(mac.match(/.{2}/g), pair => parseInt(pair, 16));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i];
  return difference === 0;
}
export async function wahaWebhook(sql, env, request) {
  if (!whatsAppConfigured(env)) return new Response("Unavailable", { status: 503 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await request.text();
  if (raw.length > 32768 || !await authenticated(request, env.WAHA_WEBHOOK_HMAC_KEY, raw))
    return new Response("Unauthorized", { status: 401 });
  const ts = Number(request.headers.get("x-webhook-timestamp"));
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60_000)
    return new Response("Expired", { status: 401 });
  let event;
  try { event = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
  if (event?.event !== "message" || event.session !== (env.WAHA_SESSION || "default")
    || event.payload?.fromMe || !CHAT.test(String(event.payload?.from || "")))
    return Response.json({ ok: true, ignored: true });
  const chatId = event.payload.from;
  const body = String(event.payload.body || "").trim();
  if (/^STOP$/i.test(body)) {
    await sql.unsafe("UPDATE whatsapp_links SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE chat_id=$1", [chatId]);
    return Response.json({ ok: true, disabled: true });
  }
  const match = /^START ([a-f0-9]{32})$/i.exec(body);
  if (!match) return Response.json({ ok: true, ignored: true });
  const digest = await hash(match[1].toLowerCase());
  // D1's compatibility wrapper does not provide a real multi-statement transaction.
  // Consume the token atomically (DELETE RETURNING) before binding the chat.
  const rows = await sql.unsafe(
    "DELETE FROM whatsapp_link_tokens WHERE token_hash=$1 AND expires_at>CURRENT_TIMESTAMP RETURNING participant_id",
    [digest]
  );
  let activated = false;
  if (rows[0]) {
    const existing = await sql.unsafe("SELECT participant_id FROM whatsapp_links WHERE chat_id=$1", [chatId]);
    if (!existing[0] || existing[0].participant_id === rows[0].participant_id) {
      await sql.unsafe(
        "INSERT INTO whatsapp_links(participant_id,chat_id,enabled,consent_at,updated_at) VALUES($1,$2,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) " +
        "ON CONFLICT(participant_id) DO UPDATE SET chat_id=excluded.chat_id,enabled=1,consent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP",
        [rows[0].participant_id, chatId]
      );
      activated = true;
    }
  }
  return Response.json({ ok: true, activated });
}
export function formatWhatsAppListing(facts, url) {
  const data = facts && typeof facts === "object" ? facts : {};
  const title = String(data.title || "Neue Wohnung").replace(/[\r\n]/g, " ").slice(0, 120);
  const location = [data.city, data.district].filter(Boolean).map(s => String(s).slice(0, 70)).join(", ");
  const price = Number(data.warm_rent);
  return [title, location, Number.isFinite(price) && price > 0 ? Math.round(price) + " EUR warm" : "", String(url).slice(0, 2048)]
    .filter(Boolean).join("\n");
}
export async function sendWahaText(env, chatId, text, requester = fetch) {
  if (!whatsAppConfigured(env) || !CHAT.test(chatId)) throw Error("whatsapp_not_ready");
  const response = await requester(origin(env) + "/api/sendText", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": env.WAHA_API_KEY },
    body: JSON.stringify({ session: env.WAHA_SESSION || "default", chatId, text }),
    signal: AbortSignal.timeout(15000),
  });
  return { ok: response.ok, status: response.status };
}
// Separate per-channel dedupe. Telegram delivery states are never modified.
export async function processWhatsAppDelivery(sql, env, requester = fetch) {
  if (!whatsAppConfigured(env)) return { status: "disabled" };
  await sql.unsafe(
    "INSERT OR IGNORE INTO whatsapp_deliveries(delivery_id,participant_id) " +
    "SELECT d.id,d.participant_id FROM deliveries d " +
    "JOIN whatsapp_links w ON w.participant_id=d.participant_id AND w.enabled=1 " +
    "JOIN participants p ON p.id=d.participant_id AND p.status='active' " +
    "WHERE d.created_at>=datetime('now','-15 minutes') AND d.offer_identity_id IS NOT NULL " +
    "AND (d.listing_expired_at IS NULL OR d.listing_expired_at>CURRENT_TIMESTAMP)"
  );
  const rows = await sql.unsafe(
    "SELECT wd.delivery_id,w.chat_id,oi.facts,oi.canonical_url FROM whatsapp_deliveries wd " +
    "JOIN whatsapp_links w ON w.participant_id=wd.participant_id AND w.enabled=1 " +
    "JOIN participants p ON p.id=wd.participant_id AND p.status='active' " +
    "JOIN deliveries d ON d.id=wd.delivery_id " +
    "JOIN offer_identities oi ON oi.id=d.offer_identity_id " +
    "WHERE wd.status='pending' AND wd.created_at>=datetime('now','-15 minutes') " +
    "ORDER BY wd.created_at,wd.delivery_id LIMIT 1"
  );
  if (!rows[0]) return { status: "idle" };
  const item = rows[0];
  const claim = await sql.unsafe(
    "UPDATE whatsapp_deliveries SET status='processing',attempts=attempts+1 " +
    "WHERE delivery_id=$1 AND status='pending' RETURNING delivery_id", [item.delivery_id]
  );
  if (!claim.length) return { status: "busy" };
  let facts = item.facts;
  if (typeof facts === "string") { try { facts = JSON.parse(facts); } catch { facts = {}; } }
  let result;
  try {
    result = await sendWahaText(env, item.chat_id, formatWhatsAppListing(facts, item.canonical_url), requester);
  } catch {
    await sql.unsafe(
      "UPDATE whatsapp_deliveries SET status='unknown',error_message='transport_outcome_unknown' WHERE delivery_id=$1",
      [item.delivery_id]
    );
    return { status: "unknown" };
  }
  if (!result.ok) {
    await sql.unsafe(
      "UPDATE whatsapp_deliveries SET status='failed',error_message=$1 WHERE delivery_id=$2",
      ["waha_http_" + result.status, item.delivery_id]
    );
    return { status: "failed" };
  }
  await sql.unsafe("UPDATE whatsapp_deliveries SET status='sent',sent_at=CURRENT_TIMESTAMP,error_message=NULL WHERE delivery_id=$1", [item.delivery_id]);
  return { status: "sent" }; // WAHA accepted; not proof of WhatsApp recipient delivery.
}
