type Lease = { id: string; attempt: number; claimedAt: string };

const CUTOVER_ENDPOINT = "https://traumwohnung-housing-runtime.arash-ce5.workers.dev/internal/delivery-cutover-ledger";
const CUTOVER_SOURCES = new Set([1, 3, 23, 29, 30, 32, 34, 35, 36, 39, 66, 69, 71]);
const CUTOVER_STATUSES = new Set(["claimed", "busy", "already_sent", "unknown", "sending", "sent", "released", "not_owner"]);

export function shouldProtectDelivery(eventType: unknown, sourceId: unknown, value: unknown) {
  if (String(eventType || "new_listing") !== "new_listing" || !CUTOVER_SOURCES.has(Number(sourceId))) return false;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return (host === "immobilienscout24.de" && /^\/expose\/[0-9]+\/?$/i.test(url.pathname))
      || (host === "immowelt.de" && /^\/expose\/[a-z0-9_-]+\/?$/i.test(url.pathname))
      || (host === "tenant.immomio.com" && /^\/(?:de\/)?apply\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(url.pathname));
  } catch { return false; }
}

export async function callCutoverBridge(secret: string, action: string, participantId: string, url: string, eventId: string, request: typeof fetch = fetch) {
  const response = await request(CUTOVER_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ action, participant_id: participantId, url, owner: `legacy:${eventId}` }),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("cutover_bridge_unavailable");
  const result = await response.json().catch(() => null);
  if (!CUTOVER_STATUSES.has(result?.status)) throw new Error("cutover_bridge_invalid_response");
  return result.status as string;
}

export async function claimDelivery(
  db: any,
  event: any,
): Promise<Lease | null> {
  const lease = {
    id: event.id,
    attempt: Number(event.dispatch_attempts || 0) + 1,
    claimedAt: new Date().toISOString(),
  };
  const { data, error } = await db
    .from("delivery_events")
    .update({
      status: "processing",
      dispatch_attempts: lease.attempt,
      last_attempt_at: lease.claimedAt,
    })
    .eq("id", event.id)
    .eq("status", event.status)
    .eq("dispatch_attempts", Number(event.dispatch_attempts || 0))
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data ? lease : null;
}

export async function finishDelivery(
  db: any,
  lease: Lease,
  patch: Record<string, unknown>,
) {
  const { data, error } = await db
    .from("delivery_events")
    .update(patch)
    .eq("id", lease.id)
    .eq("status", "processing")
    .eq("dispatch_attempts", lease.attempt)
    .eq("last_attempt_at", lease.claimedAt)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Delivery ${lease.id}: lease no longer owned`);
}

export async function recoverDeliveries(db: any) {
  // Longer than the hosted Edge Function lifetime. Never steal a live request.
  const { error } = await db
    .from("delivery_events")
    .update({
      status: "failed",
      delivery_outcome_unknown: true,
      next_retry_at: new Date().toISOString(),
      error_message:
        "Expired delivery lease; prior Telegram outcome may be unknown",
    })
    .eq("status", "processing")
    .lt("last_attempt_at", new Date(Date.now() - 600_000).toISOString());
  if (error) throw error;
}
