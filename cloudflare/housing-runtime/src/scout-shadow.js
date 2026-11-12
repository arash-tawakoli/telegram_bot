import { fetchImmoScoutSource } from "./immoscout-source.js";

const SOURCE_ID = 1;
const BOROUGHS = ["Hamburg-Mitte", "Altona", "Eimsbüttel", "Hamburg-Nord", "Wandsbek", "Bergedorf", "Harburg"];
const BATCH_SIZE = 6;

function query(task) {
  const parts = [`Wohnungen zur Miete in ${task.region}, Hamburg`, "neueste Inserate"];
  if (task.min != null && task.max != null) parts.push(`zwischen ${task.min} und ${task.max} Euro monatlich`);
  else if (task.max != null) parts.push(`maximal ${task.max} Euro monatlich`);
  else if (task.min != null) parts.push(`ab ${task.min} Euro monatlich`);
  return parts.join(", ");
}

function split(task) {
  if (task.depth >= 8) return [];
  if (task.min == null && task.max == null) {
    const bounds = [null, 750, 1000, 1250, 1500, 2000, 3000, 5000, null];
    return bounds.slice(0, -1).map((min, i) => ({ ...task, min, max: bounds[i + 1], depth: task.depth + 1 }));
  }
  const min = task.min ?? 0, max = task.max ?? Math.max(10000, min * 2);
  if (max - min <= 50) return [];
  const middle = Math.round((min + max) / 2);
  return [{ ...task, min: task.min, max: middle, depth: task.depth + 1 }, { ...task, min: middle, max: task.max, depth: task.depth + 1 }];
}

export async function runScoutShadow(db) {
  const initial = BOROUGHS.map(region => ({ region, min: null, max: null, depth: 0 }));
  await db.prepare("INSERT OR IGNORE INTO scout_shadow_scans(source_id,cycle_id,queue_json) VALUES(?,?,?)")
    .bind(SOURCE_ID, crypto.randomUUID(), JSON.stringify(initial)).run();
  const token = crypto.randomUUID();
  const state = await db.prepare("UPDATE scout_shadow_scans SET lease_token=?,lease_until=datetime('now','+2 minutes') WHERE source_id=? AND status='running' AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) RETURNING *")
    .bind(token, SOURCE_ID).first();
  // shortcut: a finished scan is not automatically restarted; reset after its coverage has been checked.
  if (!state) return { status: "idle" };
  try {
    const queue = JSON.parse(state.queue_json);
    if (!Array.isArray(queue) || !queue.length || queue.length > 2000) throw new Error("shadow_queue_invalid");
    let total = Number(state.root_total), requests = Number(state.requests), unresolved = Number(state.unresolved);
    const tasks = queue.slice(0, BATCH_SIZE);
    for (const task of tasks) {
      if (!BOROUGHS.includes(task.region) || !Number.isInteger(task.depth) || task.depth < 0 || task.depth > 8 || [task.min, task.max].some(value => value != null && (!Number.isSafeInteger(value) || value < 0 || value > 10000000)) || (task.min != null && task.max != null && task.min >= task.max)) throw new Error("shadow_partition_invalid");
    }
    const fetched = await Promise.allSettled(tasks.map(task => fetchImmoScoutSource({ id: SOURCE_ID, name: "ImmobilienScout24 Hamburg" }, { query: query(task) })));
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (fetched[i].status === "rejected") throw fetched[i].reason;
      const result = fetched[i].value;
      if (!Number.isInteger(result.reported_total) || result.reported_total < 0) throw new Error("shadow_total_unavailable");
      const next = queue.slice(1);
      if (task.depth === 0) total += result.reported_total;
      if (result.reported_total > result.nodes.length) {
        const children = split(task);
        if (children.length) next.push(...children);
        else unresolved++;
      }
      if (next.length > 2000) throw new Error("shadow_queue_limit");
      requests++;
      const finished = next.length === 0;
      const writes = result.nodes.map(node => db.prepare("INSERT INTO scout_shadow_offers(source_id,external_id,cycle_id,canonical_url,facts) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM scout_shadow_scans WHERE source_id=? AND lease_token=? AND status='running') ON CONFLICT(source_id,external_id) DO UPDATE SET cycle_id=excluded.cycle_id,canonical_url=excluded.canonical_url,facts=excluded.facts,seen_at=CURRENT_TIMESTAMP")
        .bind(SOURCE_ID, node.identity, state.cycle_id, node.canonical_url, JSON.stringify(node.facts), SOURCE_ID, token));
      writes.push(db.prepare("UPDATE scout_shadow_scans SET queue_json=?,root_total=?,requests=?,unresolved=?,status=?,finished_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,last_error=NULL WHERE source_id=? AND lease_token=? AND status='running'")
        .bind(JSON.stringify(next), total, requests, unresolved, finished ? "finished" : "running", finished ? 1 : 0, SOURCE_ID, token));
      const batch = await db.batch(writes);
      if (Number(batch.at(-1)?.meta?.changes || 0) !== 1) throw new Error("shadow_lease_lost");
      queue.splice(0, queue.length, ...next);
    }
    return { status: queue.length ? "running" : "finished", requests, unresolved };
  } catch (error) {
    await db.prepare("UPDATE scout_shadow_scans SET last_error='scan_failed' WHERE source_id=? AND lease_token=?").bind(SOURCE_ID, token).run().catch(() => {});
    throw error;
  } finally {
    await db.prepare("UPDATE scout_shadow_scans SET lease_token=NULL,lease_until=NULL WHERE source_id=? AND lease_token=?").bind(SOURCE_ID, token).run().catch(() => {});
  }
}
