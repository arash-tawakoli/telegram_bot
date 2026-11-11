import { readFile } from "node:fs/promises";
import postgres from "postgres";

const targetUrl = process.env.TARGET_DATABASE_URL;
const snapshotFile = process.env.HOUSING_SNAPSHOT_FILE;
const apply = process.argv.includes("--apply");
if (!targetUrl || !snapshotFile) throw new Error("TARGET_DATABASE_URL and HOUSING_SNAPSHOT_FILE are required");

const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
if (snapshot.version !== 1 || !snapshot.tables || !Array.isArray(snapshot.allowlist)) throw new Error("snapshot_invalid");

const conflictKeys = {
  source_registry: ["id"], portal_members: ["id"], participant_assignments: ["participant_id"], applicant_profiles: ["participant_id"],
  search_profiles: ["id"], source_links: ["search_profile_id", "source_id"], application_preferences: ["participant_id"],
  provider_connections: ["participant_id", "provider"], documents: ["id"], participants: ["id"], offer_identities: ["id"],
  deliveries: ["id"],
};
for (const table of Object.keys(snapshot.tables)) {
  if (!Object.hasOwn(conflictKeys, table)) throw new Error(`snapshot_table_forbidden:${table}`);
}
const jsonColumns = new Set(["connector_config", "profile", "criteria", "facts", "metadata", "telegram_state"]);

function identifier(value) {
  if (!/^[a-z_]+$/.test(value)) throw new Error("identifier_invalid");
  return `"${value}"`;
}

async function insertRows(tx, table, values) {
  if (!values.length) return 0;
  const columns = Object.keys(values[0]);
  const keys = conflictKeys[table];
  if (!keys) throw new Error(`table_conflict_key_missing:${table}`);
  const colSql = columns.map(identifier).join(",");
  const updates = columns.filter((column) => !keys.includes(column)).map((column) => `${identifier(column)}=EXCLUDED.${identifier(column)}`).join(",");
  for (const row of values) {
    const params = columns.map((column) => jsonColumns.has(column) && row[column] != null ? JSON.stringify(row[column]) : row[column]);
    const placeholders = columns.map((column, index) => jsonColumns.has(column) ? `$${index + 1}::jsonb` : `$${index + 1}`).join(",");
    await tx.unsafe(`INSERT INTO housing.${identifier(table)} (${colSql}) VALUES (${placeholders}) ON CONFLICT (${keys.map(identifier).join(",")}) DO ${updates ? `UPDATE SET ${updates}` : "NOTHING"}`, params);
  }
  return values.length;
}

const target = postgres(targetUrl, { max: 3, prepare: true });
try {
  if (!apply) {
    console.log(JSON.stringify({ dry_run: true, allowlist: snapshot.allowlist, tables: Object.fromEntries(Object.entries(snapshot.tables).map(([name, values]) => [name, values.length])) }));
  } else {
    const result = await target.begin(async (tx) => {
      const counts = {};
      for (const [table, values] of Object.entries(snapshot.tables)) counts[table] = await insertRows(tx, table, values);
      return counts;
    });
    console.log(JSON.stringify({ applied: true, counts: result }));
  }
} finally { await target.end({ timeout: 5 }); }
