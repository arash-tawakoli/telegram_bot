import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const targetUrl = process.env.TARGET_DATABASE_URL;
if (!targetUrl) throw new Error("TARGET_DATABASE_URL is required");

const root = new URL("../", import.meta.url);
const files = [
  "schema/0001_housing_core.sql",
  "schema/0006_housing_retention.sql",
  "schema/0007_telegram_participant_state.sql",
  "schema/0008_target_bootstrap.sql",
  "schema/0009_source_url_repair.sql",
  "schema/0010_remove_unverified_source.sql",
  "schema/0011_external_runtime_grants.sql",
];

const sql = postgres(targetUrl, { max: 2, prepare: true });
try {
  for (const file of files) {
    await sql.unsafe(await readFile(new URL(file, root), "utf8"));
    console.log(JSON.stringify({ applied: file }));
  }
} finally {
  await sql.end({ timeout: 5 });
}
