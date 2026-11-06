import { execFileSync } from "node:child_process";

const sql = `SELECT (SELECT count(*) FROM source_registry) AS sources,(SELECT count(*) FROM participants) AS participants,(SELECT count(*) FROM search_profiles) AS search_profiles,(SELECT count(*) FROM applicant_profiles) AS applicant_profiles,(SELECT count(*) FROM provider_connections) AS provider_connections,(SELECT count(*) FROM offer_identities) AS offers,(SELECT count(*) FROM deliveries) AS deliveries,(SELECT count(*) FROM applications) AS applications,(SELECT count(*) FROM application_events) AS application_events,(SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('source_registry','participants','portal_members','participant_assignments','portal_sessions','bootstrap_tokens','search_profiles','source_links','applicant_profiles','documents','upload_tokens','provider_connections','application_preferences','offer_identities','deliveries','applications','application_events','jobs','audit_events','telegram_updates')) AS tables,(SELECT count(*) FROM (SELECT idempotency_key FROM deliveries GROUP BY idempotency_key HAVING count(*)>1)) AS duplicate_deliveries,(SELECT count(*) FROM (SELECT idempotency_key FROM applications GROUP BY idempotency_key HAVING count(*)>1)) AS duplicate_applications;`;
const raw = execFileSync("npx", ["wrangler", "d1", "execute", "traumwohnung-housing-core", "--remote", "--json", "--command", sql], { encoding: "utf8" });
const parsed = JSON.parse(raw);
const row = parsed?.[0]?.results?.[0];
if (!row) throw new Error("d1_verify_result_missing");
if (Number(row.sources) !== 9 || Number(row.tables) !== 20) throw new Error("d1_schema_contract_failed");
if (Number(row.duplicate_deliveries) !== 0 || Number(row.duplicate_applications) !== 0) throw new Error("d1_idempotency_contract_failed");
console.log(JSON.stringify({ ok: true, ...row }));
