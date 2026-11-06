const FUNCTION_NAMES = new Map([["telegram", "telegram-gateway"]]);

function upstreamHeaders(request, env) {
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "x-client-info", "x-telegram-bot-api-secret-token", "x-internal-worker-secret"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (env.SUPABASE_PUBLISHABLE_KEY) headers.set("apikey", env.SUPABASE_PUBLISHABLE_KEY);
  return headers;
}

export async function proxySupabaseFunction(request, env, functionKey) {
  const functionName = FUNCTION_NAMES.get(functionKey);
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!functionName || !base || !env.SUPABASE_PUBLISHABLE_KEY) {
    return new Response(JSON.stringify({ error: "proxy_not_configured" }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const target = new URL(`${base}/functions/v1/${functionName}`);
  target.search = new URL(request.url).search;
  const upstream = await fetch(target, { method: request.method, headers: upstreamHeaders(request, env), body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body, redirect: "manual" });
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  return new Response(upstream.body, { status: upstream.status, headers });
}
