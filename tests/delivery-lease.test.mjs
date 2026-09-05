import test from "node:test";
import assert from "node:assert/strict";
import {
  claimDelivery,
  finishDelivery,
  recoverDeliveries,
} from "../supabase/functions/notification-dispatcher/delivery-lease.ts";
function database(row) {
  return {
    row,
    error: null,
    from() {
      const db = this,
        filters = [];
      let patch;
      const query = {
        update(p) {
          patch = p;
          return this;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return this;
        },
        lt(k, v) {
          filters.push((r) => r[k] < v);
          return this;
        },
        select() {
          return this;
        },
        async maybeSingle() {
          if (db.error) return { data: null, error: db.error };
          if (!filters.every((f) => f(db.row)))
            return { data: null, error: null };
          Object.assign(db.row, patch);
          return { data: { id: db.row.id }, error: null };
        },
        then(resolve, reject) {
          return this.maybeSingle().then(resolve, reject);
        },
      };
      return query;
    },
  };
}
test("two workers cannot claim the same pending event", async () => {
  const event = { id: "delivery", status: "pending", dispatch_attempts: 0 };
  const db = database({ ...event });
  const leases = await Promise.all([
    claimDelivery(db, event),
    claimDelivery(db, event),
  ]);
  assert.equal(leases.filter(Boolean).length, 1);
  assert.equal(db.row.dispatch_attempts, 1);
});
test("old delivery lease cannot overwrite a newer attempt", async () => {
  const db = database({
    id: "delivery",
    status: "pending",
    dispatch_attempts: 0,
  });
  const lease = await claimDelivery(db, { ...db.row });
  db.row.dispatch_attempts++;
  await assert.rejects(
    finishDelivery(db, lease, { status: "sent" }),
    /lease no longer owned/,
  );
  assert.equal(db.row.status, "processing");
});
test("successful finish writes only the owned processing event", async () => {
  const db = database({
    id: "delivery",
    status: "pending",
    dispatch_attempts: 0,
  });
  const lease = await claimDelivery(db, { ...db.row });
  await finishDelivery(db, lease, { status: "sent", telegram_message_id: 123 });
  assert.equal(db.row.status, "sent");
  await assert.rejects(
    finishDelivery(db, lease, { status: "failed" }),
    /lease no longer owned/,
  );
});
test("DB failure during claim stops processing", async () => {
  const db = database({
    id: "delivery",
    status: "pending",
    dispatch_attempts: 0,
  });
  db.error = new Error("DB unavailable");
  await assert.rejects(claimDelivery(db, { ...db.row }), /DB unavailable/);
  assert.equal(db.row.status, "pending");
});
test("recovery does not steal live leases and retains attempt count", async () => {
  const db = database({
    id: "delivery",
    status: "processing",
    dispatch_attempts: 2,
    last_attempt_at: new Date().toISOString(),
  });
  await recoverDeliveries(db);
  assert.equal(db.row.status, "processing");
  db.row.last_attempt_at = new Date(Date.now() - 660000).toISOString();
  await recoverDeliveries(db);
  assert.equal(db.row.status, "failed");
  assert.equal(db.row.dispatch_attempts, 2);
});
