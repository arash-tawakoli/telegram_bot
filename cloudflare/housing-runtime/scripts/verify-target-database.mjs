import postgres from "postgres";

const targetUrl = process.env.TARGET_DATABASE_URL;
if (!targetUrl) throw new Error("TARGET_DATABASE_URL is required");

const sql = postgres(targetUrl, { max: 2, prepare: true });
try {
  const [sources, tables, counts, duplicates, access] = await Promise.all([
    sql`SELECT array_agg(id ORDER BY id) AS ids FROM housing.source_registry WHERE enabled = true`,
    sql`SELECT count(*)::int AS count, bool_and(c.relrowsecurity) AS all_rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'housing' AND c.relkind = 'r'`,
    sql`SELECT
      (SELECT count(*)::int FROM housing.participants) AS participants,
      (SELECT count(*)::int FROM housing.search_profiles) AS search_profiles,
      (SELECT count(*)::int FROM housing.applicant_profiles) AS applicant_profiles,
      (SELECT count(*)::int FROM housing.provider_connections) AS provider_connections,
      (SELECT count(*)::int FROM housing.offer_identities) AS offers,
      (SELECT count(*)::int FROM housing.deliveries) AS deliveries,
      (SELECT count(*)::int FROM housing.applications) AS applications`,
    sql`SELECT
      (SELECT count(*) FROM (SELECT idempotency_key FROM housing.deliveries GROUP BY idempotency_key HAVING count(*) > 1) d)::int AS duplicate_deliveries,
      (SELECT count(*) FROM (SELECT idempotency_key FROM housing.applications GROUP BY idempotency_key HAVING count(*) > 1) a)::int AS duplicate_applications`,
    sql`SELECT has_schema_privilege(current_user, 'housing', 'USAGE') AS schema_usage, current_user AS role`,
  ]);
  const result = {
    sources: sources[0]?.ids || [],
    tables: tables[0] || {},
    counts: counts[0] || {},
    duplicates: duplicates[0] || {},
    access: access[0] || {},
  };
  if (JSON.stringify(result.sources) !== JSON.stringify([1, 3, 23, 29, 34, 35, 66, 69, 71])) throw new Error("source_allowlist_mismatch");
  if (result.tables.count !== 20 || result.tables.all_rls !== true) throw new Error("housing_rls_contract_failed");
  if (result.duplicates.duplicate_deliveries !== 0 || result.duplicates.duplicate_applications !== 0) throw new Error("idempotency_contract_failed");
  if (result.access.schema_usage !== true) throw new Error("housing_access_failed");
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await sql.end({ timeout: 5 });
}
