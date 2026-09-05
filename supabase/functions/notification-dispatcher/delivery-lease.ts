type Lease = { id: string; attempt: number; claimedAt: string };

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
