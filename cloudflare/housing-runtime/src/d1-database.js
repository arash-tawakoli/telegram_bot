const UUID_EXPR = "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))";

function scalar(value) {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sqliteQuery(query) {
  return String(query)
    .replace(/\bhousing\./gi, "")
    .replace(/\bgen_random_uuid\(\)/gi, UUID_EXPR)
    .replace(/\bnow\(\)/gi, "CURRENT_TIMESTAMP")
    .replace(/CURRENT_TIMESTAMP\s*([-+])\s*interval\s*'([0-9]+)\s+(minutes?|hours?|days?)'/gi, (_match, sign, amount, unit) => `datetime('now','${sign === '+' ? '+' : '-'}${amount} ${unit}')`)
    .replace(/\s+FOR\s+UPDATE(?:\s+OF\s+[A-Za-z0-9_, ]+)?(?:\s+SKIP\s+LOCKED)?/gi, "")
    .replace(/::(?:jsonb|json|timestamptz|timestamp|uuid|integer|int|bigint|smallint|text|boolean|double precision)/gi, "")
    .replace(/\bTRUE\b/gi, "1")
    .replace(/\bFALSE\b/gi, "0");
}

function dollarParams(query, params) {
  const values = [];
  const rewritten = String(query).replace(/\$(\d+)/g, (_match, index) => {
    values.push(params[Number(index) - 1]);
    return "?";
  });
  return { query: rewritten, values };
}

export function createD1Client(db) {
  async function execute(query, params = []) {
    const prepared = db.prepare(sqliteQuery(query));
    const bound = params.map(scalar);
    const result = bound.length ? await prepared.bind(...bound).all() : await prepared.all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    rows.count = Number(result?.meta?.changes || 0);
    return rows;
  }

  function sql(strings, ...values) {
    let query = strings[0];
    const params = [];
    for (let index = 0; index < values.length; index++) {
      query += "?";
      params.push(values[index]);
      query += strings[index + 1];
    }
    return execute(query, params);
  }

  sql.unsafe = (query, params = []) => {
    const rewritten = dollarParams(query, params);
    return execute(rewritten.query, rewritten.values);
  };
  sql.begin = async (callback) => callback(sql);
  sql.end = async () => {};
  sql.array = (values) => values;
  return sql;
}
