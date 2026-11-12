import { sha256 } from "./auth.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER = /^(?:legacy|cloudflare):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function reconcileCloudflareDeliveries(db) {
  const result = await db.prepare("UPDATE delivery_cutover_ledger SET status='sent',updated_at=CURRENT_TIMESTAMP WHERE status='sending' AND owner LIKE 'cloudflare:%' AND EXISTS (SELECT 1 FROM deliveries d WHERE 'cloudflare:'||d.id=delivery_cutover_ledger.owner AND d.status='sent' AND d.telegram_message_id>0)").run();
  return Number(result?.meta?.changes || 0);
}

export function listingIdentity(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("invalid_listing_url");
  let url;
  try { url = new URL(value); } catch { throw new Error("invalid_listing_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("invalid_listing_url");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let match;
  if (host === "immobilienscout24.de") {
    match = url.pathname.match(/^\/expose\/([0-9]+)\/?$/i);
    if (match) return `immoscout24:${match[1]}`;
  } else if (host === "immowelt.de") {
    match = url.pathname.match(/^\/expose\/([a-z0-9_-]+)\/?$/i);
    if (match) return `immowelt:${match[1]}`;
  } else if (host === "tenant.immomio.com") {
    match = url.pathname.match(/^\/(?:de\/)?apply\/([0-9a-f-]{36})\/?$/i);
    if (match && UUID.test(match[1])) return `immomio:${match[1].toLowerCase()}`;
  }
  throw new Error("unsupported_listing_url");
}

export async function deliveryCutoverLedger(db, input) {
  const participant = String(input?.participant_id || ""), owner = String(input?.owner || ""), action = String(input?.action || "");
  if (!UUID.test(participant) || !OWNER.test(owner) || !["claim", "begin", "resume", "resume_partial", "sent", "unknown", "release"].includes(action)) throw new Error("invalid_ledger_request");
  const key = await sha256(`${participant.toLowerCase()}:${listingIdentity(input.url)}`);
  if (action === "claim") {
    const inserted = await db.prepare("INSERT INTO delivery_cutover_ledger(delivery_key,owner,status,lease_until) VALUES(?,?,'reserved',datetime('now','+2 minutes')) ON CONFLICT(delivery_key) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until,updated_at=CURRENT_TIMESTAMP WHERE delivery_cutover_ledger.status='reserved' AND delivery_cutover_ledger.lease_until<CURRENT_TIMESTAMP").bind(key, owner).run();
    if (Number(inserted?.meta?.changes || 0) === 1) return { status: "claimed" };
    const existing = await db.prepare("SELECT status FROM delivery_cutover_ledger WHERE delivery_key=?").bind(key).first();
    // shortcut: uncertain sends stay blocked until reconciled; never retry them automatically.
    return { status: existing?.status === "sent" ? "already_sent" : existing?.status === "unknown" ? "unknown" : "busy" };
  }
  if (action === "release") {
    const result = await db.prepare("DELETE FROM delivery_cutover_ledger WHERE delivery_key=? AND owner=? AND status IN ('reserved','sending')").bind(key, owner).run();
    return { status: Number(result?.meta?.changes || 0) === 1 ? "released" : "not_owner" };
  }
  if (action === "begin") {
    const result = await db.prepare("UPDATE delivery_cutover_ledger SET status='sending',lease_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE delivery_key=? AND owner=? AND status='reserved' AND lease_until>=CURRENT_TIMESTAMP").bind(key, owner).run();
    return { status: Number(result?.meta?.changes || 0) === 1 ? "sending" : "not_owner" };
  }
  if (action === "resume" || action === "resume_partial") {
    const existing = await db.prepare("SELECT owner,status FROM delivery_cutover_ledger WHERE delivery_key=?").bind(key).first();
    return { status: owner.startsWith("legacy:") && existing?.owner === owner && (existing?.status === "sending" || (action === "resume_partial" && existing?.status === "sent")) ? "sending" : "not_owner" };
  }
  const result = await db.prepare("UPDATE delivery_cutover_ledger SET status=?,updated_at=CURRENT_TIMESTAMP WHERE delivery_key=? AND owner=? AND status='sending'").bind(action, key, owner).run();
  if (Number(result?.meta?.changes || 0) === 1) return { status: action };
  const existing = await db.prepare("SELECT owner,status FROM delivery_cutover_ledger WHERE delivery_key=?").bind(key).first();
  return { status: existing?.owner === owner && existing?.status === action ? action : "not_owner" };
}
