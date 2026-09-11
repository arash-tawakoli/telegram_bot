// The same handler serves direct worker calls and the compatibility endpoint.
export async function handle(request: Request): Promise<Response> {
  // Cancel every provider request when the caller's deadline expires.
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}) => globalThis.fetch(input, {
    ...init, signal: AbortSignal.any([request.signal, ...(init.signal ? [init.signal] : [])]),
  });

const BASE = "https://wunderflats.com/de/moeblierte-wohnungen-auf-zeit/hamburg";
const UPSTREAM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const KEY_SHA256 = "b0fb36eb62b559402c0f1607367b735f76982a88272669c84d4fe973a9026972";
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

function normalizeMissingLinks(html: string) {
  const encoded = html.match(/<script[^>]+id=["']data-hydrant["'][^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!encoded) return html;
  let items: any[] = [];
  try { items = JSON.parse(encoded)?.pageData?.listingResults?.items || []; } catch { return html; }
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]);
  const anchors: string[] = [];
  for (const item of items) {
    const id = String(item?._id || "");
    if (!/^[a-f0-9]{24}$/.test(id) || item?.address?.city !== "Hamburg") continue;
    if (hrefs.some((href) => href.includes("/de/moebliertes-apartment/") && href.split("?")[0].endsWith(`/${id}`))) continue;
    anchors.push(`<a hidden href="/de/moebliertes-apartment/wohnung/${id}"></a>`);
  }
  return anchors.length ? `${html}\n${anchors.join("\n")}` : html;
}


return await (async (req) => {
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const requestUrl = new URL(req.url);
  const supplied = requestUrl.searchParams.get("k") || "";
  const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied)));
  if (digest !== KEY_SHA256) return new Response("unauthorized", { status: 401 });
  const match = requestUrl.pathname.match(/\/wunderflats-transport(?:\/(\d+))?\/?$/);
  if (!match) return new Response("invalid path", { status: 400 });
  const page = match[1] ? Number(match[1]) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 100) return new Response("invalid page", { status: 400 });
  const upstream = page === 1 ? BASE : `${BASE}/${page}`;
  try {
    const response = await fetch(upstream, {
      redirect: "follow",
      headers: {
        "user-agent": UPSTREAM_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "de-DE,de;q=0.9,en;q=0.7",
        referer: BASE,
      },
      signal: AbortSignal.timeout(12000),
    });
    let body = await response.text();
    if (response.ok) body = normalizeMissingLinks(body);
    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-upstream-status": String(response.status),
      },
    });
  } catch {
    return new Response("upstream transport failed", { status: 502 });
  }
})(request);
}
