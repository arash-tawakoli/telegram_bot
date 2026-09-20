import { fetchListingPage } from "../kleinanzeigen-transport/fetch-page.ts";
import { Candidate, Source, db, deNum, decode, iso, strip, upsertCandidates } from "./shared.ts";

type CategoryStream = {
  source_id: number;
  category: "house" | "room";
  adapter: string;
  url: string | null;
  baseline_at: string | null;
  cursor: any;
  lease_token: string;
};

function berlinNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function ageMinutes(label: string | null) {
  if (!label) return null;
  const now = berlinNow();
  const time = label.match(/(\d{1,2}):(\d{2})/);
  if (!time) return null;
  const adMinutes = Number(time[1]) * 60 + Number(time[2]);
  let dayDiff: number;
  if (/^Heute\b/i.test(label)) dayDiff = 0;
  else if (/^Gestern\b/i.test(label)) dayDiff = 1;
  else {
    const d = label.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (!d) return null;
    dayDiff = Math.round(
      (Date.UTC(now.year, now.month - 1, now.day) -
        Date.UTC(Number(d[3]), Number(d[2]) - 1, Number(d[1]))) /
        86400000,
    );
  }
  return dayDiff * 1440 + now.hour * 60 + now.minute - adMinutes;
}

function sourcePublishedAt(label: string | null) {
  const age = ageMinutes(label);
  if (age == null || age < -5 || age > 7 * 1440) return null;
  return new Date(Date.now() - age * 60_000).toISOString();
}

function listingDates(html: string) {
  const out = new Map<string, string>();
  const decoded = decode(html);
  for (const chunk of decoded.split('"organicAdPreview"').slice(1)) {
    const id = chunk.match(/"id":\[0,(\d+)\]/)?.[1];
    const date = chunk.match(/"sortingDate":\[0,"([^"]+)"\]/)?.[1];
    if (id && date) out.set(id, date);
  }
  return out;
}

export function parseKleinCategoryPage(
  html: string,
  category: "house" | "room",
) {
  const dates = listingDates(html);
  const items: Candidate[] = [];
  let opens = 0;
  for (const m of html.matchAll(
    /<article\b[^>]*data-adid=["'](\d+)["'][^>]*data-href=["']([^"']+)["'][^>]*>/gi,
  )) {
    opens++;
    const start = m.index || 0;
    const end = html.indexOf("</article>", start);
    if (end < 0) continue;
    const block = html.slice(start, end + 10);
    const plain = strip(block);
    const title = strip(
      block.match(
        /<a\b[^>]*class=["'][^"']*ellipsis[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
      )?.[1] ||
        block.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1] ||
        "",
    );
    if (!title) continue;
    let location = strip(
      block.match(/aditem-main--top--left[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
        block.match(/<span\b[^>]*>\s*(\d{5}\s+Hamburg[^<]*)<\/span>/i)?.[1] ||
        "",
    );
    const zip =
      location.match(/\b(\d{5})\b/)?.[1] ||
      plain.match(/\b(\d{5})\s+Hamburg\b/i)?.[1];
    if (!zip) continue;
    if (!location) location = `${zip} Hamburg`;
    const tags = strip(
      block.match(/aditem-main--middle--tags[^>]*>([\s\S]*?)<\/(?:div|p)>/i)?.[1] ||
        block,
    );
    const price = strip(
      block.match(
        /aditem-main--middle--price-shipping--price[^>]*>([\s\S]*?)<\/p>/i,
      )?.[1] ||
        block.match(
          /<p\b[^>]*>\s*([\d.]+(?:,\d{1,2})?\s*€(?:\s*VB)?)\s*<\/p>/i,
        )?.[1] ||
        "",
    );
    const image =
      block.match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["']/i)?.[1] || null;
    const district = location
      .replace(/^\d{5}\s+/, "")
      .replace(/^Hamburg\s+/i, "")
      .replace(/\s*\(Stadtteil\)$/i, "")
      .trim();
    const sortingDate =
      dates.get(m[1]) ||
      plain.match(/(?:Heute|Gestern|\d{1,2}\.\d{1,2}\.\d{4})[^\d]{0,3}\d{1,2}:\d{2}/i)?.[0] ||
      null;
    const publishedAt = sourcePublishedAt(sortingDate);
    const kind = category === "house" ? "house" : "room";
    if (category === "room") {
      const roomText = `${title} ${plain}`;
      const positiveRoom = /\b(?:WG(?:[- ]?Zimmer)?|Privatzimmer|Mitbewohner|Untermiet(?:e|er)?|Zimmer)\b/i.test(roomText);
      const wholeUnit = /\b(?:gesamte|komplette)\s+(?:Unterkunft|Wohnung)\b|\b\d+[ -]?Zimmer[ -]?Wohnung\b|\bApartment\b/i.test(roomText);
      if (!positiveRoom || (wholeUnit && !/\b(?:WG(?:[- ]?Zimmer)?|Privatzimmer|Mitbewohner|Untermiet(?:e|er)?)\b/i.test(roomText)))
        continue;
    }
    items.push({
      key: m[1],
      url: m[2].startsWith("http")
        ? m[2]
        : "https://www.kleinanzeigen.de" + m[2],
      title,
      district,
      zip,
      cold: deNum(price),
      rooms: deNum(tags.match(/([\d.,]+)\s*Zi/i)?.[1]),
      area: deNum(tags.match(/([\d.,]+)\s*m²/i)?.[1]),
      type: category === "house" ? "Haus" : "WG",
      image,
      raw: {
        provider: "kleinanzeigen",
        native_offer: true,
        location,
        price_text: price,
        sorting_date: sortingDate,
        category_stream: category,
        _classification: { version: "1", kind, mode: "rent" },
        ...(publishedAt
          ? {
              _newness: {
                method: "source_timestamp",
                source_published_at: publishedAt,
              },
            }
          : {}),
      },
    });
  }
  return { items, opens };
}

function isRecent(c: Candidate) {
  const value = c.raw?._newness?.source_published_at;
  if (!value) return false;
  const age = Date.now() - new Date(value).getTime();
  return age >= -5 * 60_000 && age <= 24 * 60 * 60_000;
}

async function finish(
  stream: CategoryStream,
  success: boolean,
  cursor: any,
  requests: number,
  candidates: number,
  error: string | null = null,
) {
  const { data, error: rpcError } = await db.rpc("finish_source_category_stream", {
    p_source_id: stream.source_id,
    p_category: stream.category,
    p_token: stream.lease_token,
    p_success: success,
    p_cursor: cursor || {},
    p_requests: requests,
    p_candidates: candidates,
    p_error: error,
  });
  if (rpcError) throw rpcError;
  if (data !== true) throw new Error("category stream lease lost");
}

async function runKleinanzeigen(source: Source, stream: CategoryStream) {
  if (!stream.url) throw new Error("category stream URL missing");
  const response = await fetchListingPage(
    stream.url,
    AbortSignal.timeout(15_000),
  );
  if (!response.ok)
    throw new Error(`Kleinanzeigen transport HTTP ${response.status}`);
  const upstream = Number(response.headers.get("x-upstream-status") || 0);
  const html = await response.text();
  if (upstream !== 200)
    throw new Error(`Kleinanzeigen upstream HTTP ${upstream || "unknown"}`);
  const parsed = parseKleinCategoryPage(html, stream.category);
  if (parsed.opens === 0)
    throw new Error(`Kleinanzeigen ${stream.category} inventory missing`);
  if (parsed.items.length === 0)
    throw new Error(
      `Kleinanzeigen ${stream.category} parser accepted 0/${parsed.opens}`,
    );

  const eligible = stream.baseline_at
    ? parsed.items.filter(isRecent)
    : [];
  const eligibleKeys = new Set(eligible.map((x) => String(x.key || x.url)));
  const blocked = parsed.items.filter(
    (x) => !eligibleKeys.has(String(x.key || x.url)),
  );
  const a = eligible.length
    ? await upsertCandidates(source, eligible, true)
    : { seen: 0, fresh: 0, keys: [] as string[] };
  const b = blocked.length
    ? await upsertCandidates(source, blocked, false)
    : { seen: 0, fresh: 0, keys: [] as string[] };
  const cursor = {
    version: 1,
    checked_at: iso(),
    visible_keys: [...new Set([...a.keys, ...b.keys])].slice(0, 100),
  };
  await finish(
    stream,
    true,
    cursor,
    1,
    a.seen + b.seen,
    null,
  );
  return {
    category: stream.category,
    ok: true,
    fetched: a.seen + b.seen,
    fresh: a.fresh,
    eligible: eligible.length,
  };
}

async function runOne(source: Source, stream: CategoryStream) {
  try {
    if (stream.adapter !== "kleinanzeigen")
      throw new Error(`unsupported category adapter ${stream.adapter}`);
    return await runKleinanzeigen(source, stream);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish(stream, false, stream.cursor || {}, 1, 0, message).catch(
      (finishError) =>
        console.error("category_stream_finish", String(finishError)),
    );
    return {
      category: stream.category,
      ok: false,
      error: message,
    };
  }
}

export async function runCategoryStreams(source: Source) {
  const { data, error } = await db.rpc("claim_source_category_streams", {
    p_source_id: source.id,
  });
  if (error) throw error;
  const streams = Array.isArray(data) ? (data as CategoryStream[]) : [];
  if (!streams.length) return [];
  return Promise.all(streams.map((stream) => runOne(source, stream)));
}
