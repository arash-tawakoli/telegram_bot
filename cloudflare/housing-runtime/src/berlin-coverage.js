import { ingestImmoScoutSource } from "./immoscout-source.js";

// The MCP exposes counts without pagination. Keep subdividing queries that
// return fewer unique IDs than the MCP reports. Never report such a job complete.
const PRICE_BANDS = Object.freeze([
  [null, 750], [750, 1250], [1250, 1750], [1750, 2500], [2500, null],
]);
const ROOM_BANDS = Object.freeze([1, 2, 3, 4, 5]);
const MAX_JOBS_PER_RUN = 4;

export function berlinCoverageQuery({ area, rent_min = null, rent_max = null, rooms = null }) {
  const base = "Wohnungen zur Miete in Berlin-" + String(area) + ", Deutschland";
  let query = base;
  if (rent_min != null && rent_max != null) query += ", Kaltmiete " + rent_min + " bis " + rent_max + " Euro";
  else if (rent_max != null) query += ", Kaltmiete bis " + rent_max + " Euro";
  else if (rent_min != null) query += ", Kaltmiete ab " + rent_min + " Euro";
  if (rooms != null) query += rooms === 5 ? ", ab 5 Zimmer" : ", " + rooms + " Zimmer";
  return query;
}

export function splitBerlinCoverageJob(job) {
  const stage = Number(job.stage || 0);
  const area = String(job.area || "");
  if (stage === 0) return PRICE_BANDS.map(([rent_min, rent_max]) =>
    ({ area, rent_min, rent_max, rooms: null, stage: 1 }));
  if (stage === 1) return ROOM_BANDS.map(rooms =>
    ({ area, rent_min: job.rent_min, rent_max: job.rent_max, rooms, stage: 2 }));
  if (stage >= 6) return [];
  const low = job.rent_min == null ? 0 : Number(job.rent_min);
  const high = job.rent_max == null ? null : Number(job.rent_max);
  if (high !== null && high - low <= 100) return [];
  if (high === null && low >= 10000) return [];
  const cut = high === null
    ? Math.min(10000, low + Math.max(750, Math.round(low * 0.45 / 50) * 50))
    : Math.round((low + high) / 100) * 50;
  if (cut <= low || (high != null && cut >= high)) return [];
  return [
    { area, rent_min: job.rent_min, rent_max: cut, rooms: job.rooms, stage: stage + 1 },
    { area, rent_min: cut, rent_max: job.rent_max, rooms: job.rooms, stage: stage + 1 },
  ];
}

async function nextJob(sql) {
  const rows = await sql.unsafe(`
    SELECT query, area, rent_min, rent_max, rooms, stage
    FROM housing.scout_coverage_jobs
    WHERE source_id=72 AND datetime(next_run_at)<=datetime('now')
    ORDER BY CASE WHEN last_run_at IS NULL THEN 0 ELSE 1 END,
      priority, next_run_at, area
    LIMIT 1
  `);
  return rows[0] || null;
}

async function saveChildren(sql, job) {
  const children = splitBerlinCoverageJob(job);
  for (const child of children) {
    const query = berlinCoverageQuery(child);
    await sql.unsafe(`
      INSERT OR IGNORE INTO housing.scout_coverage_jobs
        (source_id,query,area,rent_min,rent_max,rooms,stage,priority)
      VALUES (72,$1,$2,$3,$4,$5,$6,1)
    `, [query, child.area, child.rent_min, child.rent_max, child.rooms, child.stage]);
  }
  return children.length;
}

async function finishJob(sql, job, result, addedChildren) {
  const total = Number.isFinite(Number(result.fetched)) ? Number(result.fetched) : null;
  const valid = Number(result.valid || 0);
  const complete = total != null && total <= valid;
  const status = complete ? "covered" : addedChildren ? "split" : "limited";
  const interval = status === "limited" ? "+6 hours" : "+24 hours";
  await sql.unsafe(`
    UPDATE housing.scout_coverage_jobs SET
      status=$1, reported_total=$2, returned_count=$3,
      last_run_at=CURRENT_TIMESTAMP,
      next_run_at=datetime('now',$4), last_error=NULL
    WHERE source_id=72 AND query=$5
  `, [status, total, valid, interval, job.query]);
  return status;
}

async function failJob(sql, job, error) {
  const message = String(error?.message || error).slice(0, 240);
  await sql.unsafe(`
    UPDATE housing.scout_coverage_jobs SET
      status='retry',last_run_at=CURRENT_TIMESTAMP,
      next_run_at=datetime('now','+30 minutes'),last_error=$1
    WHERE source_id=72 AND query=$2
  `, [message, job.query]);
}

export async function runBerlinCoverage(sql, source, maxJobs = MAX_JOBS_PER_RUN, ingest = ingestImmoScoutSource) {
  if (Number(source?.id) !== 72) return null;
  const processed = [];
  const limit = Math.max(0, Math.min(MAX_JOBS_PER_RUN, Number(maxJobs) || 0));
  for (let i = 0; i < limit; i++) {
    const job = await nextJob(sql);
    if (!job) break;
    try {
      // Reuse the same ingestion, matching, delivery dedupe and offer storage
      // as the normal ImmoScout cron; only the query is more specific.
      const result = await ingest(sql, source, { query: job.query });
      if (/429|rate.?limit/i.test(String(result.map_error || "")))
        throw new Error("immoscout_mcp_rate_limited");
      const incomplete = result.missing_from_response == null
        || result.missing_from_response > 0;
      const children = incomplete ? await saveChildren(sql, job) : 0;
      const status = await finishJob(sql, job, result, children);
      processed.push({
        query: job.query, total: result.fetched, retrieved: result.valid,
        new_ids: result.newly_discovered_in_response, status, children,
      });
    } catch (error) {
      await failJob(sql, job, error);
      processed.push({ query: job.query, status: "retry" });
      // Respect MCP rate limits. Remaining work persists for the next cron.
      if (/429|rate.?limit/i.test(String(error?.message || error))) break;
    }
  }
  const summary = await sql.unsafe(`
    SELECT status,COUNT(*) AS n FROM housing.scout_coverage_jobs
    WHERE source_id=72 GROUP BY status
  `);
  return { processed, jobs: summary };
}
