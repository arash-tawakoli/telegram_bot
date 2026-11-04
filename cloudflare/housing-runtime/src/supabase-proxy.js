const FUNCTION_NAMES = new Map([
  ["coach", "coach-api"],
  ["telegram", "telegram-gateway"],
  ["source", "source-worker"],
  ["application", "application-worker"],
  ["immoscout-application", "application-worker"],
]);

function upstreamHeaders(request, env) {
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "x-client-info", "x-telegram-bot-api-secret-token", "x-internal-worker-secret"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (env.SUPABASE_PUBLISHABLE_KEY) headers.set("apikey", env.SUPABASE_PUBLISHABLE_KEY);
  if (env.INTERNAL_WORKER_SECRET && request.headers.get("x-internal-worker-secret")) {
    headers.set("x-internal-worker-secret", env.INTERNAL_WORKER_SECRET);
  }
  return headers;
}

export async function proxySupabaseFunction(request, env, functionKey) {
  const functionName = FUNCTION_NAMES.get(functionKey);
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!functionName || !base || !env.SUPABASE_PUBLISHABLE_KEY) {
    return new Response(JSON.stringify({ error: "proxy_not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const target = new URL(`${base}/functions/v1/${functionName}`);
  const incoming = new URL(request.url);
  target.search = incoming.search;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
  const upstream = await fetch(target, {
    method: request.method,
    headers: upstreamHeaders(request, env),
    body,
    redirect: "manual",
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("cache-control", "no-store, max-age=0");
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set("referrer-policy", "no-referrer");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
