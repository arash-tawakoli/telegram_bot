import "jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts";

const SEARCH_URL = "https://www.immobilienscout24.de/Suche/de/hamburg/hamburg/wohnung-mieten";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function uniqueExposeIds(html: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /\/expose\/(\d+)/g,
    /["']exposeId["']\s*:\s*["']?(\d+)/g,
    /["']realEstateId["']\s*:\s*["']?(\d+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

function totalHits(html: string): number | null {
  const patterns = [
    /([\d.]+)\s+(?:Wohnungen|Treffer|Ergebnisse)/i,
    /["']total(?:Hits|Results|Count)?["']\s*:\s*(\d+)/i,
    /["']resultCount["']\s*:\s*(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const n = Number(match[1].replace(/\./g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

Deno.serve(async () => {
  const started = Date.now();
  try {
    const response = await fetch(SEARCH_URL, {
      headers: {
        "user-agent": UA,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "de-DE,de;q=0.9,en;q=0.7",
      },
      redirect: "follow",
    });
    const html = await response.text();
    const exposeIds = uniqueExposeIds(html);
    return Response.json({
      connector: "immoscout_html_public_test",
      production: false,
      url: SEARCH_URL,
      status: response.status,
      ok: response.ok,
      total_reported: totalHits(html),
      expose_ids_found_in_html: exposeIds.length,
      expose_ids: exposeIds,
      html_bytes: new TextEncoder().encode(html).byteLength,
      elapsed_ms: Date.now() - started,
      blocked_hint: /captcha|access denied|unusual traffic|robot/i.test(html),
    });
  } catch (error) {
    return Response.json({ connector: "immoscout_html_public_test", production: false, ok: false, error: error instanceof Error ? error.message : String(error), elapsed_ms: Date.now() - started }, { status: 500 });
  }
});
