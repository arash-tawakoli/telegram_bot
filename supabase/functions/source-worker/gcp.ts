import {
  Candidate,
  Connector,
  Source,
  absolute,
  deNum,
  fetchText,
  hhZip,
  imageFromHtml,
  iso,
  markFailure,
  markSuccess,
  strip,
  upsertCandidates,
} from "./shared.ts";
const DEFAULT_PRIMARY_URL =
  "https://www.grandcityproperty.de/wohnungssuche?city=&cityField=Hamburg&type=&price=&rooms=&size=&radius=100000&cityText=";
function adapter(c: Connector | undefined) {
  return String(c?.config?.adapter || "");
}
function connectorByAdapter(cs: Connector[], name: string) {
  return cs.find((c) => adapter(c) === name);
}
function urlOf(c: Connector | undefined, fallback: string) {
  return String(c?.config?.url || fallback).trim() || fallback;
}
function keyFromUrl(url: string) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).at(-1) || null;
  } catch {
    return null;
  }
}
function detailUrls(html: string, base: string) {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const url = absolute(base, m[1]);
    if (!url) continue;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (!/(?:^|\.)grandcityproperty\.de$/i.test(u.hostname)) continue;
    const path = u.pathname.replace(/\/+$/, "");
    if (!/^\/wohnungssuche\/hamburg\/.+\/(?:expose\/)?[^/]+$/i.test(path))
      continue;
    const key = keyFromUrl(url);
    if (key) out.set(key, url);
  }
  return [...out.entries()].map(([key, url]) => ({ key, url }));
}
function moneyAfter(text: string, labels: string) {
  return deNum(
    text.match(
      new RegExp(
        `(?:${labels})\\s*:?\\s*([\\d.]+(?:,\\d{1,2})?)\\s*(?:€|EUR)`,
        "i",
      ),
    )?.[1],
  );
}
async function parseDetail(
  url: string,
  key: string,
  lane: string,
): Promise<Candidate | null> {
  const r = await fetchText(url, undefined, 10000);
  if (/\/objekt-vermietet(?:\?|$)/i.test(r.url)) return null;
  const plain = strip(r.text);
  if (/Dieses Objekt ist bereits vermietet/i.test(plain)) return null;
  const title =
    strip(r.text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").slice(
      0,
      240,
    ) || "Grand City Property Wohnungsangebot";
  if (
    /\b(?:Gewerbe|Gewerbeeinheit|Gewerbefläche|Verkaufsfläche|Einzelhandelsfläche|Büro|Praxis|Laden|Ladenfläche|Lager|Stellplatz|Garage)\b/i.test(
      title,
    )
  )
    return null;
  const zip = r.text.match(/\b(2\d{4})\s+Hamburg\b/i)?.[1] || null;
  if (zip && !hhZip(zip)) return null;
  const cold = moneyAfter(
      plain,
      "Kaltmiete|Nettokaltmiete|Grundmiete|Nettomiete",
    ),
    warm = moneyAfter(
      plain,
      "Gesamtmiete|Warmmiete|Bruttowarmmiete|Bruttomiete",
    ),
    additional = moneyAfter(
      plain,
      "Nebenkosten|Nebenkostenvorauszahlung|sonstige Kosten",
    ),
    operating = moneyAfter(plain, "Betriebskosten|Betriebskostenvorauszahlung"),
    heating = moneyAfter(
      plain,
      "Heizkosten|Heizungskosten|Heizkostenvorauszahlung",
    ),
    deposit = moneyAfter(plain, "Kaution|Mietkaution|Mietsicherheit"),
    rooms = deNum(plain.match(/([\d.,]+)\s*[-–]?\s*Zimmer/i)?.[1]),
    area = deNum(plain.match(/([\d.,]+)\s*m(?:²|2)/i)?.[1]);
  return {
    key,
    url: r.url,
    title,
    zip,
    warm,
    cold,
    additional,
    operating,
    heating,
    deposit,
    rooms,
    area,
    available: null,
    type: "Wohnung",
    wbs: /\bWBS\b|Wohnberechtigungsschein/i.test(plain),
    image: imageFromHtml(r.text, r.url),
    raw: { provider: "grand_city_property", discovery_lane: lane },
  };
}
async function discover(url: string, lane: string) {
  const r = await fetchText(url, undefined, 10000),
    links = detailUrls(r.text, r.url),
    out: Candidate[] = [],
    errors: string[] = [];
  for (let i = 0; i < links.length; i += 8) {
    const batch = links.slice(i, i + 8),
      rs = await Promise.allSettled(
        batch.map((x) => parseDetail(x.url, x.key, lane)),
      );
    rs.forEach((x, j) => {
      if (x.status === "fulfilled") {
        if (x.value) out.push(x.value);
      } else
        errors.push(
          `${batch[j].key}: ${x.reason instanceof Error ? x.reason.message : String(x.reason)}`,
        );
    });
  }
  return { url: r.url, discovered: links.length, candidates: out, errors };
}
export async function runGcp(source: Source, connectors: Connector[]) {
  const started = iso();
  try {
    connectors = connectors.filter((c) => !c.shadow_only);
    const primaryConnector =
      connectorByAdapter(connectors, "source-worker/gcp-primary") ||
      connectorByAdapter(connectors, "source-worker/gcp") ||
      connectors.find((c) => c.priority === 1);
    if (!primaryConnector) throw new Error("GCP primary connector missing");
    const primary = await discover(
        urlOf(primaryConnector, DEFAULT_PRIMARY_URL),
        "gcp_primary",
      );
    if(primary.errors.length && !primary.candidates.length)
      throw new Error(`GCP detail retrieval failed: ${primary.errors.join('; ')}`);
    const saved = await upsertCandidates(
        source,
        primary.candidates,
        !!source.baseline_completed_at,
      );
    await markSuccess(
      source,
      started,
      primaryConnector,
      primary.candidates.length,
      saved.fresh,
      { strategy: "gcp_primary", complete: false, discovered: primary.discovered, detail_errors: primary.errors },
    );
    return {
      ok: true,
      source_id: source.id,
      fetched: primary.candidates.length,
      new: saved.fresh,
      complete: false,
    };
  } catch (e) {
    return markFailure(source, started, e);
  }
}
