export function rewriteD1Sql(statement) {
  let query = String(statement)
    .replace(/\bINSERT\s+INTO\s+central_credentials\b/gi, "INSERT INTO app_private.immoscout_central_credentials AS central_credentials")
    .replace(/\bFROM\s+central_credentials\b/gi, "FROM app_private.immoscout_central_credentials AS central_credentials")
    .replace(/\bUPDATE\s+central_credentials\b/gi, "UPDATE app_private.immoscout_central_credentials AS central_credentials")
    .replace(/\b(INTO|FROM|UPDATE|DELETE FROM)\s+oauth_flows\b/gi, "$1 app_private.immoscout_central_oauth_flows")
    .replace(/\b(INTO|FROM|UPDATE|DELETE FROM)\s+audit_events\b/gi, "$1 app_private.immoscout_central_audit_events");

  let index = 0;
  query = query.replace(/\?/g, () => "$" + (++index));
  return query;
}

export function createD1Compat(sql) {
  return {
    prepare(statement) {
      const query = rewriteD1Sql(statement);
      return {
        bind(...values) {
          return {
            async first() {
              const rows = await sql.unsafe(query, values);
              return rows[0] ?? null;
            },
            async all() {
              const rows = await sql.unsafe(query, values);
              return { results: rows };
            },
            async run() {
              const rows = await sql.unsafe(query, values);
              return {
                success: true,
                meta: {
                  changes: Number(rows.count ?? rows.length ?? 0),
                },
              };
            },
          };
        },
      };
    },
  };
}
