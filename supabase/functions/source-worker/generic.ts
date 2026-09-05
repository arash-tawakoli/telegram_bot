// Database failures are fatal to a crawl, unlike recoverable connector HTTP errors.
class CrawlDatabaseError extends Error {}
async function databaseQuery(query: PromiseLike<any>) {
  try {
    const result = await query;
    if (result.error) throw result.error;
    return result;
  } catch (error) {
    throw new CrawlDatabaseError(
      `Database operation failed: ${error instanceof Error ? error.message : (error as any)?.message || String(error)}`,
    );
  }
}
async function persistCandidates(...args: Parameters<typeof upsertCandidates>) {
  try {
    return await upsertCandidates(...args);
  } catch (error) {
    throw new CrawlDatabaseError(
      `Listing persistence failed: ${error instanceof Error ? error.message : (error as any)?.message || String(error)}`,
    );
  }
}
import {
  Candidate,
  Connector,
  HH_ZIPS,
  Source,
  absolute,
  collectJson,
  db,
  deNum,
  fetchText,
  imageFromHtml,
  iso,
  markFailure,
  markSuccess,
  parseFields,
  parseHtml,
  strongUrl,
  strip,
  upsertCandidates,
} from "./shared.ts";
const IMMOWELT_HAMBURG_AREAS = [
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg/hamburg-20095/ad08de1113",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/altona-22589/ad09de70",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/bergedorf-21035/ad09de74",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/eimsbuttel-22457/ad09de71",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/harburg-21077/ad09de75",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/mitte-22119/ad09de69",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/nord-22415/ad09de72",
  "https://www.immowelt.de/suche/mieten/wohnung/hamburg-20095/wandsbek-22159/ad09de73",
];
const IMMOWELT_ROOM_SITEMAPS = [1, 2, 3, 4, 5, 6].map(
  (n) =>
    `https://www.immowelt.de/sitemaps/RENT_APARTMENT_ROOMS-MIN${n}-MAX${n}_FLATSHARING-NEW-BUILD-STOCK-SWAP-APARTMENT/rent_apartment_rooms-min${n}-max${n}_flatsharing-new-build-stock-swap-apartment_1.xml`,
);
function pageUrl(base: string, page: number, sourceId: number) {
  const u = new URL(base);
  if (sourceId === 21)
    u.searchParams.set("page", String(Math.max(0, page - 1)));
  else u.searchParams.set("page", String(page));
  return u.href;
}
function maxPage(html: string) {
  let n = 1;
  for (const m of html.matchAll(/[?&](?:page|pagenumber)=(\d+)/gi))
    n = Math.max(n, Number(m[1]));
  return Math.min(n, 250);
}
function sourceTitle(sourceId: number, c: Candidate) {
  const t = String(c.raw?.text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return c.title || null;
  if (sourceId === 12) {
    const m = t.match(
      /Monatsrate\s+ca\.\s*[\d.]+(?:,\d+)?\s*€\s+(.{8,220}?)\s+\d{5}\s+Hamburg\b/i,
    );
    if (m) return m[1].trim();
  }
  if (sourceId === 15) {
    const m = t.match(
      /(?:Etage\s+\d+\s+)?(?:Balkon\s+)?(?:Einbauküche\s+)?(?:Garten\s+)?\d{1,2}\s+(.{8,220}?)\s+(?:(?:[\d.]+(?:,\d+)?\s*€\s+inkl\s+NK\s+)?[\d.]+(?:,\d+)?\s*€\s+Kaltmiete)\b/i,
    );
    if (m) return m[1].trim();
  }
  if (sourceId === 49) {
    const m = t.match(
      /(\d+(?:[.,]\d+)?\s+Zimmer\s+Hamburg\s+.{3,80}?,\s*Hamburg)\b/i,
    );
    if (m) return m[1].trim();
  }
  return c.title || null;
}
function refine(source: Source, cands: Candidate[]) {
  let out = cands;
  if (source.id === 12)
    out = out.filter((c) => /\/immobilie\/\d+\/?(?:[?#].*)?$/i.test(c.url));
  if ([12, 15, 49].includes(source.id))
    out = out.map((c) => ({ ...c, title: sourceTitle(source.id, c) }));
  return out;
}
function immoweltCardImage(card: string, base: string) {
  const raw = card.match(
    /data-testid=["']card-mfe-picture-box-gallery-test-id["'][\s\S]*?<img\b[^>]*\bsrc=["']([^"']+)["']/i,
  )?.[1];
  return (raw ? absolute(base, raw) : null) || imageFromHtml(card, base);
}
function immoweltCards(html: string, base: string) {
  const out: Candidate[] = [];
  for (const v of html.split('<div id="classified-card-').slice(1)) {
    const link = v.match(
      /<a\b[^>]*href=["']([^"']*\/expose\/[^"']+)["'][^>]*>/i,
    );
    if (!link) continue;
    const href = absolute(base, link[1]);
    if (!href) continue;
    const titleAttr = link[0].match(/\btitle=["']([^"']+)["']/i)?.[1] || "",
      imgAlt =
        [...v.matchAll(/<img\b[^>]*alt=["']([^"']+)["'][^>]*>/gi)]
          .map((x) => x[1])
          .find(
            (x) => /€/.test(x) && /(Zimmer|m²|Wohnung|Apartment)/i.test(x),
          ) || "",
      text = strip(v).slice(0, 8000),
      f = parseFields(`${titleAttr} ${imgAlt} ${text}`),
      image = immoweltCardImage(v, base),
      isNew = /data-testid=["']cardmfe-tag-testid-new["']/i.test(v),
      title = (titleAttr || imgAlt || "Wohnungsangebot").slice(0, 240);
    out.push({
      url: href,
      title,
      zip: f.zip,
      warm: f.warm,
      cold: f.cold,
      additional: f.additional,
      operating: f.operating,
      heating: f.heating,
      deposit: f.deposit,
      rooms: f.rooms,
      area: f.area,
      wbs: f.wbs,
      image,
      raw: {
        provider: "immowelt",
        title: titleAttr,
        alt: imgAlt,
        is_new: isNew,
      },
    });
  }
  return out;
}
function immoweltTotal(html: string) {
  const t = html.match(/<title>([^<]+)<\/title>/i)?.[1] || "",
    m = t.match(/-\s*([\d.]+)\s+Angebote/i);
  return m ? Number(m[1].replace(/\./g, "")) : null;
}
async function immoweltDeepUrls() {
  const pages = await Promise.all(
    IMMOWELT_ROOM_SITEMAPS.map((u) =>
      fetchText(u, "application/xml,text/xml,*/*", 15000),
    ),
  );
  const urls: string[] = [];
  for (const p of pages)
    for (const m of p.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
      const u = m[1];
      if (/\/hamburg-20095\/.*\/nbh2de/i.test(u)) urls.push(u);
    }
  return [...new Set(urls)];
}
async function parseOne(source: Source, c: Connector, url: string) {
  const isJson = ["json_endpoint", "wp_rest"].includes(c.connector_kind),
    r = await fetchText(
      url,
      isJson ? "application/json,text/plain,*/*" : undefined,
    );
  const low = r.text.toLowerCase();
  if (
    (c.config?.no_offer_patterns || []).some((p: string) =>
      low.includes(String(p).toLowerCase()),
    )
  )
    return { cands: [] as Candidate[], url: r.url, total: null };
  if (isJson) {
    const out: Candidate[] = [];
    collectJson(JSON.parse(r.text), r.url, out);
    return { cands: refine(source, out), url: r.url, total: null };
  }
  if (c.connector_kind === "sitemap") {
    const out = [...r.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
      .map((m) => absolute(r.url, m[1]))
      .filter((x): x is string => !!x && strongUrl(x))
      .map((u) => ({ url: u }) as Candidate);
    return { cands: refine(source, out), url: r.url, total: null };
  }
  const jsonLd: Candidate[] = [];
  for (const m of r.text.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ))
    try {
      collectJson(JSON.parse(m[1]), r.url, jsonLd);
    } catch {}
  const out =
    source.id === 3
      ? immoweltCards(r.text, r.url)
      : jsonLd.length
        ? jsonLd
        : parseHtml(r.text, r.url);
  return {
    cands: refine(source, out),
    url: r.url,
    total: source.id === 3 ? immoweltTotal(r.text) : null,
  };
}
function targetFor(source: Source, c: Connector) {
  const base = String(source.homepage_url || source.search_url || "");
  if (c.config?.url) return String(c.config.url);
  if (c.config?.path && base) {
    try {
      return new URL(String(c.config.path), base).href;
    } catch {}
  }
  return String(source.search_url || source.homepage_url || "");
}
function yahooUrl(q: string, start = 1) {
  const u = new URL("https://de.search.yahoo.com/search");
  u.searchParams.set("p", q);
  u.searchParams.set("nojs", "1");
  if (start > 1) {
    u.searchParams.set("b", String(start));
    u.searchParams.set("pz", "7");
    u.searchParams.set("xargs", "0");
  }
  return u.href;
}
function indexBlocks(html: string) {
  return html.match(/<li><div class="dd algo[\s\S]*?<\/li>/gi) || [];
}
function indexedSaga(html: string, query: string) {
  const out: Candidate[] = [];
  for (const b of indexBlocks(html)) {
    const id =
      b.match(/immowelt\.de%2fexpose%2f([a-f0-9-]{36})/i)?.[1] ||
      b.match(/›\s*expose\s*›\s*([a-f0-9-]{36})/i)?.[1];
    if (!id) continue;
    const text = strip(b);
    if (
      !/\bHamburg\b/i.test(text) ||
      !/(Wohnung|Apartment)/i.test(text) ||
      !/zur\s+Miete/i.test(text)
    )
      continue;
    if (
      /Tauschangebot|Wohnungstausch|\btausche\b|Garage|Stellplatz|Parkplatz|Gewerbe|Büro|Praxis|Lager|zum\s+Kauf/i.test(
        text,
      )
    )
      continue;
    const f = parseFields(text),
      zip = f.zip || text.match(/\b(2\d{4})\b/)?.[1] || null;
    if (zip && !HH_ZIPS.has(zip)) continue;
    const cold =
      f.cold ??
      deNum(text.match(/([\d.]+(?:,\d{1,2})?)\s*€\s+zur\s+Miete/i)?.[1]);
    const after =
      text.match(
        new RegExp(
          `${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(.{5,220}?)(?:www\\.immowelt\\.de|$)`,
          "i",
        ),
      )?.[1] || text;
    out.push({
      key: id,
      url: `https://www.immowelt.de/expose/${id}`,
      title: after.slice(0, 220),
      zip,
      cold,
      additional: f.additional,
      operating: f.operating,
      heating: f.heating,
      deposit: f.deposit,
      rooms: f.rooms,
      area: f.area,
      raw: {
        provider: "saga_public_index",
        index: "yahoo",
        query,
        snippet: text.slice(0, 2500),
      },
    });
  }
  return out;
}
async function runSagaIndex(source: Source, connectors: Connector[]) {
  const queries = [
    'site:immowelt.de/expose "Vermietungshotline der SAGA Unternehmensgruppe" Hamburg Wohnung',
    'site:immowelt.de/expose "SAGA Unternehmensgruppe Gewerblicher Anbieter" Hamburg Wohnung',
  ];
  let cands: Candidate[] = [],
    requests = 0;
  for (const q of queries)
    for (const start of [1, 8]) {
      try {
        const r = await fetchText(yahooUrl(q, start));
        requests++;
        cands.push(...indexedSaga(r.text, q));
      } catch {
        requests++;
      }
    }
  cands = [...new Map(cands.map((x) => [x.key || x.url, x])).values()];
  if (!cands.length)
    throw new Error(
      "SAGA public provider index returned no verified Hamburg rental apartments",
    );
  const saved = await persistCandidates(source, cands, false),
    picked = connectors.find((c) => !c.shadow_only) || connectors[0] || null,
    started = iso();
  await markSuccess(source, started, picked, cands.length, saved.fresh, {
    strategy: "provider_public_index_fallback",
    provider: "saga",
    requests,
    complete: false,
  });
  if (!source.baseline_completed_at)
    await databaseQuery(
      db
        .from("sources")
        .update({
          baseline_completed_at: iso(),
          coverage_status: "partial",
          warmed_up: true,
          updated_at: iso(),
        })
        .eq("id", source.id),
    );
  return {
    ok: true,
    source_id: source.id,
    fetched: cands.length,
    new: saved.fresh,
    complete: false,
    fallback: "provider_public_index",
  };
}
async function runGwgMirrorMonitor(source: Source, connectors: Connector[]) {
  const q =
      'site:immowelt.de/expose "GWG Gesellschaft für Wohnungs- und Gewerbebau Baden-Württemberg AG" Hamburg Wohnung "zur Miete"',
    r = await fetchText(yahooUrl(q));
  let candidates = 0;
  for (const b of indexBlocks(r.text)) {
    const text = strip(b),
      zip = text.match(/\b(2\d{4})\b/)?.[1] || null;
    if (
      !/\bHamburg\b/i.test(text) ||
      !/(Wohnung|Apartment)/i.test(text) ||
      !/zur\s+Miete/i.test(text)
    )
      continue;
    if (
      /Garage|Stellplatz|Parkplatz|Gewerbe|Büro|Praxis|Lager|zum\s+Kauf|Tauschangebot|Wohnungstausch/i.test(
        text,
      )
    )
      continue;
    if (zip && !HH_ZIPS.has(zip)) continue;
    candidates++;
  }
  await databaseQuery(
    db
      .from("source_coverage_state")
      .upsert({
        source_id: source.id,
        cycle_id: crypto.randomUUID(),
        strategy: "provider_portal_monitor",
        status: "running",
        cursor: {
          portals: ["immowelt", "immoscout", "kleinanzeigen"],
          index: "yahoo",
        },
        expected_count: null,
        seen_count: 0,
        request_count: 1,
        last_error:
          "GWG direct site TLS chain is invalid from the worker. Provider listings are mirrored on public portals; attribution is monitored but not inserted until independently verified.",
        updated_at: iso(),
      }),
  );
  const picked =
      connectors.find((c) => !c.shadow_only) || connectors[0] || null,
    started = iso();
  await markSuccess(source, started, picked, 0, 0, {
    strategy: "provider_portal_monitor",
    indexed_candidate_count: candidates,
    complete: false,
  });
  return {
    ok: true,
    source_id: source.id,
    fetched: 0,
    new: 0,
    complete: false,
    indexed_candidate_count: candidates,
  };
}
async function runMeinestadtMirrorMonitor(
  source: Source,
  connectors: Connector[],
) {
  const q = "site:meinestadt.de/hamburg/immobilien Hamburg Wohnung Kaltmiete",
    r = await fetchText(yahooUrl(q)),
    blocks = indexBlocks(r.text);
  let max = 0;
  for (const b of blocks) {
    const text = strip(b);
    if (!/meinestadt\.de|meinestadt/i.test(text)) continue;
    const n = deNum(text.match(/Anzahl von Angeboten:\s*([\d.]+)/i)?.[1]);
    if (n != null) max = Math.max(max, n);
  }
  if (!max)
    throw new Error(
      "meinestadt public index monitor returned no inventory count",
    );
  await databaseQuery(
    db
      .from("source_coverage_state")
      .upsert({
        source_id: source.id,
        cycle_id: crypto.randomUUID(),
        strategy: "partner_mirror_monitor",
        status: "running",
        cursor: { partner_source_id: 3, index: "yahoo" },
        expected_count: max,
        seen_count: 0,
        request_count: 1,
        last_error:
          "Direct meinestadt transport unavailable; Immowelt-backed inventory is covered by source 3, unique private meinestadt listings remain unverified.",
        updated_at: iso(),
      }),
  );
  const picked =
      connectors.find((c) => !c.shadow_only) || connectors[0] || null,
    started = iso();
  await markSuccess(source, started, picked, 0, 0, {
    strategy: "partner_mirror_monitor",
    partner_source_id: 3,
    indexed_inventory_count: max,
    complete: false,
  });
  return {
    ok: true,
    source_id: source.id,
    fetched: 0,
    new: 0,
    complete: false,
    mirror_source_id: 3,
    indexed_inventory_count: max,
  };
}
export async function runGeneric(source: Source, connectors: Connector[]) {
  const started = iso();
  try {
    if (source.id === 4) return await runSagaIndex(source, connectors);
    if (source.id === 31) return await runGwgMirrorMonitor(source, connectors);
    if (source.id === 14)
      return await runMeinestadtMirrorMonitor(source, connectors);
    let picked: Connector | null = null,
      cands: Candidate[] = [],
      complete = true,
      meta: any = { connector_attempts: [] },
      savedOverride: { seen: number; fresh: number } | null = null,
      primaryTrustedSnapshot = false,
      successfulLaneCount = 0;
    const attempted = new Set<string>(),
      livePriorities = connectors
        .filter((c) => !c.shadow_only)
        .map((c) => c.priority),
      effectivePrimaryPriority = livePriorities.length
        ? Math.min(...livePriorities)
        : Infinity;
    const candidateKey = (c: Candidate) =>
      String(c.key || c.url.split("/").filter(Boolean).at(-1) || "").slice(
        0,
        500,
      );
    const upsertAdditive = async (batch: Candidate[], allowNew: boolean) => {
      const keyed = batch
          .map((c) => ({ c, key: candidateKey(c) }))
          .filter((x) => x.key),
        old = new Map<string, boolean>();
      const keys = [...new Set(keyed.map((x) => x.key))];
      for (let i = 0; i < keys.length; i += 300) {
        const { data } = await databaseQuery(
          db
            .from("listings")
            .select("source_listing_key,fresh_delivery_eligible")
            .eq("source_id", source.id)
            .in("source_listing_key", keys.slice(i, i + 300)),
        );
        for (const x of data || [])
          old.set(
            String(x.source_listing_key),
            x.fresh_delivery_eligible === true,
          );
      }
      const yes: Candidate[] = [],
        no: Candidate[] = [],
        fresh: Candidate[] = [];
      for (const x of keyed) {
        if (old.has(x.key)) (old.get(x.key) ? yes : no).push(x.c);
        else fresh.push(x.c);
      }
      let seen = 0,
        created = 0;
      for (const [rows, eligible] of [
        [yes, true],
        [no, false],
        [fresh, allowNew],
      ] as [Candidate[], boolean][]) {
        if (!rows.length) continue;
        const r = await persistCandidates(source, rows, eligible);
        seen += r.seen;
        created += r.fresh;
      }
      return { seen, fresh: created };
    };
    const laneWasWarmed = async (c: Connector) => {
      const { data } = await databaseQuery(
        db
          .from("crawl_runs")
          .select("id")
          .eq("source_id", source.id)
          .eq("connector_priority", c.priority)
          .eq("connector_label", c.label)
          .eq("success", true)
          .limit(1),
      );
      return !!data?.length;
    };
    const recordLane = async (
      c: Connector,
      laneStarted: string,
      success: boolean,
      fetched: number,
      fresh: number,
      error: string | null,
      extra: any = {},
    ) => {
      await databaseQuery(
        db
          .from("crawl_runs")
          .insert({
            source_id: source.id,
            started_at: laneStarted,
            finished_at: iso(),
            success,
            connector_priority: c.priority,
            connector_label: c.label,
            fetched_count: fetched,
            inserted_count: fresh,
            error_message: error ? error.slice(0, 1500) : null,
            metadata: {
              architecture: "v3",
              additive_connector: true,
              ...extra,
            },
          }),
      );
    };
    for (const c of connectors) {
      if (c.shadow_only) continue;
      const target = targetFor(source, c);
      if (!target) continue;
      const laneKey = `${c.connector_kind}|${target}`;
      if (attempted.has(laneKey)) {
        meta.connector_attempts.push({
          priority: c.priority,
          label: c.label,
          status: "duplicate_target",
        });
        continue;
      }
      attempted.add(laneKey);
      const laneStarted = iso();
      try {
        if (source.coverage_strategy === "pagination") {
          if (source.id === 3) {
            let { data: st } = await databaseQuery(
              db
                .from("source_coverage_state")
                .select("*")
                .eq("source_id", 3)
                .maybeSingle(),
            );
            const valid =
              st?.strategy === "immowelt_sitemap_room_coverage" &&
              Number(st?.cursor?.v || 0) === 1;
            let queue: string[] =
                valid && Array.isArray(st?.cursor?.queue)
                  ? st.cursor.queue
                  : [],
              cycle =
                valid && st?.cycle_id
                  ? String(st.cycle_id)
                  : crypto.randomUUID(),
              processed = valid ? Number(st?.cursor?.processed || 0) : 0,
              saturated = valid ? Number(st?.cursor?.saturated || 0) : 0,
              baselineDone = valid && Boolean(st?.cursor?.baseline_done),
              newCycle = !valid || queue.length === 0,
              sitemapRequests = 0;
            if (newCycle) {
              queue = await immoweltDeepUrls();
              cycle = crypto.randomUUID();
              processed = 0;
              saturated = 0;
              sitemapRequests = IMMOWELT_ROOM_SITEMAPS.length;
            }
            const work = queue.splice(0, 8),
              [frontRs, deepRs] = await Promise.all([
                Promise.all(
                  IMMOWELT_HAMBURG_AREAS.map((u) => parseOne(source, c, u)),
                ),
                Promise.all(work.map((u) => parseOne(source, c, u))),
              ]),
              eligibility = new Map<
                string,
                { c: Candidate; eligible: boolean }
              >();
            for (const r of deepRs)
              for (const x of r.cands) {
                const prev = eligibility.get(x.url);
                eligibility.set(x.url, {
                  c: x,
                  eligible: prev?.eligible || false || baselineDone,
                });
              }
            for (const r of frontRs)
              for (const x of r.cands) {
                const prev = eligibility.get(x.url);
                eligibility.set(x.url, {
                  c: x.raw?.is_new === true || !prev ? x : prev.c,
                  eligible: prev?.eligible || false || x.raw?.is_new === true,
                });
              }
            const all = [...eligibility.values()],
              rest = all.filter((x) => !x.eligible).map((x) => x.c),
              deliverable = all.filter((x) => x.eligible).map((x) => x.c),
              restSaved = await persistCandidates(source, rest, false),
              deliverableSaved = await persistCandidates(
                source,
                deliverable,
                true,
              ),
              deepSaturated = deepRs.filter(
                (x) => x.total != null && Number(x.total) > x.cands.length,
              ).length,
              t = iso();
            processed += work.length;
            saturated += deepSaturated;
            const cycleDone = queue.length === 0,
              baselineDoneNext = baselineDone || cycleDone;
            complete = cycleDone && saturated === 0;
            savedOverride = {
              seen: restSaved.seen + deliverableSaved.seen,
              fresh: restSaved.fresh + deliverableSaved.fresh,
            };
            cands = all.map((x) => x.c);
            meta = {
              ...meta,
              strategy: "immowelt_sitemap_room_coverage",
              freshness_mode: "front_native_new_then_deep_after_baseline",
              pages_checked: IMMOWELT_HAMBURG_AREAS.length,
              deliverable_candidates: deliverable.length,
              deep_baseline_done: baselineDoneNext,
              deep_pages_checked: work.length,
              deep_remaining: queue.length,
              deep_processed: processed,
              deep_saturated: saturated,
              deep_queue_size: processed + queue.length,
              sitemap_requests: sitemapRequests,
              complete,
            };
            await databaseQuery(
              db
                .from("source_coverage_state")
                .upsert({
                  source_id: 3,
                  cycle_id: cycle,
                  strategy: "immowelt_sitemap_room_coverage",
                  status: cycleDone ? "complete" : "running",
                  cursor: {
                    v: 1,
                    queue,
                    processed,
                    saturated,
                    baseline_done: baselineDoneNext,
                  },
                  cycle_started_at: newCycle
                    ? started
                    : st?.cycle_started_at || started,
                  cycle_finished_at: cycleDone ? t : null,
                  last_complete_at: cycleDone
                    ? t
                    : st?.last_complete_at || null,
                  seen_count:
                    (newCycle ? 0 : Number(st?.seen_count || 0)) + cands.length,
                  request_count:
                    (newCycle ? 0 : Number(st?.request_count || 0)) +
                    IMMOWELT_HAMBURG_AREAS.length +
                    work.length +
                    sitemapRequests,
                  last_error: saturated
                    ? `${saturated} saturated neighborhood-room pages`
                    : null,
                  updated_at: t,
                }),
            );
            picked = c;
            successfulLaneCount = 1;
            break;
          }
          let { data: st } = await databaseQuery(
            db
              .from("source_coverage_state")
              .select("*")
              .eq("source_id", source.id)
              .maybeSingle(),
          );
          let page = Math.max(2, Number(st?.cursor?.page || 2)),
            cycle = st?.cycle_id || crypto.randomUUID();
          const front = await parseOne(
            source,
            c,
            pageUrl(target, 1, source.id),
          );
          const frontHtml = (await fetchText(pageUrl(target, 1, source.id)))
              .text,
            detected = maxPage(frontHtml);
          let deep: Candidate[] = [];
          if (detected > 1) {
            for (let p = page; p <= Math.min(detected, page + 3); p++) {
              const x = await parseOne(
                source,
                c,
                pageUrl(target, p, source.id),
              );
              deep.push(...x.cands);
            }
          }
          const frontFresh =
            String(c.config?.freshness_mode || "") === "newest_first";
          const frontSaved = await persistCandidates(
              source,
              front.cands,
              frontFresh,
            ),
            deepSaved = await persistCandidates(source, deep, false);
          savedOverride = {
            seen: frontSaved.seen + deepSaved.seen,
            fresh: frontSaved.fresh + deepSaved.fresh,
          };
          cands = [...front.cands, ...deep];
          const next = page + 4,
            done = detected <= 1 || next > detected;
          await databaseQuery(
            db
              .from("source_coverage_state")
              .upsert({
                source_id: source.id,
                cycle_id: cycle,
                strategy: "pagination",
                status: done ? "complete" : "running",
                cursor: { page: done ? 2 : next, max: detected },
                cycle_started_at: st?.cycle_started_at || started,
                cycle_finished_at: done ? iso() : null,
                last_complete_at: done ? iso() : st?.last_complete_at || null,
                updated_at: iso(),
              }),
          );
          complete = done;
          meta = {
            ...meta,
            pages_detected: detected,
            next_page: done ? 2 : next,
            freshness_mode: frontFresh ? "newest_first" : "unverified",
          };
          picked = c;
          successfulLaneCount = 1;
          break;
        }
        const x = await parseOne(source, c, target),
          isFallbackLane = c.priority !== effectivePrimaryPriority;
        if (!picked) {
          if (isFallbackLane) {
            const warmed = await laneWasWarmed(c),
              allowNew = !!source.baseline_completed_at && warmed,
              r = await upsertAdditive(x.cands, allowNew);
            picked = c;
            complete = !!c.enumerable;
            primaryTrustedSnapshot = false;
            savedOverride = r;
            cands = [...x.cands];
            successfulLaneCount = 1;
            meta.connector_attempts.push({
              priority: c.priority,
              label: c.label,
              status: "ok",
              fetched: x.cands.length,
              role: "fallback_primary",
              warmed,
              delivery_mode: allowNew ? "new_only" : "warmup",
            });
            await recordLane(
              c,
              laneStarted,
              true,
              x.cands.length,
              r.fresh,
              null,
              {
                warmed,
                delivery_mode: allowNew ? "new_only" : "warmup",
                fallback_primary: true,
              },
            );
          } else {
            picked = c;
            complete = !!c.enumerable;
            primaryTrustedSnapshot =
              complete &&
              c.enumerable &&
              ["tenant_api", "full_page"].includes(source.coverage_strategy);
            const newestFirst =
                String(c.config?.freshness_mode || "") === "newest_first",
              allowNewest = !!source.baseline_completed_at && newestFirst;
            const r = await persistCandidates(
              source,
              x.cands,
              primaryTrustedSnapshot || allowNewest,
            );
            savedOverride = r;
            cands = [...x.cands];
            successfulLaneCount = 1;
            meta.connector_attempts.push({
              priority: c.priority,
              label: c.label,
              status: "ok",
              fetched: x.cands.length,
              role: "primary",
              freshness_mode: newestFirst ? "newest_first" : undefined,
            });
          }
          continue;
        }
        const warmed = await laneWasWarmed(c),
          allowNew = !!source.baseline_completed_at && warmed,
          r = await upsertAdditive(x.cands, allowNew);
        savedOverride = {
          seen: (savedOverride?.seen || 0) + r.seen,
          fresh: (savedOverride?.fresh || 0) + r.fresh,
        };
        cands.push(...x.cands);
        successfulLaneCount++;
        meta.connector_attempts.push({
          priority: c.priority,
          label: c.label,
          status: "ok",
          fetched: x.cands.length,
          role: "additive",
          warmed,
          delivery_mode: allowNew ? "new_only" : "warmup",
        });
        await recordLane(c, laneStarted, true, x.cands.length, r.fresh, null, {
          warmed,
          delivery_mode: allowNew ? "new_only" : "warmup",
        });
      } catch (e) {
        if (e instanceof CrawlDatabaseError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        meta.last_connector_error = msg;
        meta.connector_attempts.push({
          priority: c.priority,
          label: c.label,
          status: "error",
          error: msg,
        });
        if (picked) await recordLane(c, laneStarted, false, 0, 0, msg);
      }
    }
    if (!picked)
      throw new Error(meta.last_connector_error || "no connector succeeded");
    // A generic parser accepting zero listings does not prove an empty inventory.
    // Keep existing listings until a structured adapter verifies their removal.
    if (!cands.length) {
      complete = false;
      primaryTrustedSnapshot = false;
      meta.empty_result_unverified = true;
    }
    const trustedSnapshot =
      primaryTrustedSnapshot ||
      (complete &&
        picked.enumerable &&
        ["tenant_api", "full_page"].includes(source.coverage_strategy) &&
        picked.priority === effectivePrimaryPriority);
    const saved =
      savedOverride || (await persistCandidates(source, cands, trustedSnapshot));
    if (
      successfulLaneCount <= 1 &&
      complete &&
      picked.enumerable &&
      source.baseline_completed_at &&
      picked.priority === effectivePrimaryPriority
    )
      await databaseQuery(
        db
          .from("listings")
          .update({ is_active: false })
          .eq("source_id", source.id)
          .eq("is_active", true)
          .lt("last_seen_at", started),
      );
    const freshDeliveryMode =
      source.coverage_strategy === "pagination"
        ? meta.freshness_mode
        : successfulLaneCount > 1
          ? "primary_plus_additive_new_only"
          : trustedSnapshot
            ? "complete_snapshot"
            : picked.config?.freshness_mode === "newest_first"
              ? "newest_first"
              : "blocked_unverified";
    await markSuccess(source, started, picked, cands.length, saved.fresh, {
      strategy: source.coverage_strategy,
      fresh_delivery_mode: freshDeliveryMode,
      complete,
      multi_connector: successfulLaneCount > 1,
      connector_success_count: successfulLaneCount,
      ...meta,
    });
    return {
      ok: true,
      source_id: source.id,
      fetched: cands.length,
      new: saved.fresh,
      complete,
      multi_connector: successfulLaneCount > 1,
      connector_success_count: successfulLaneCount,
    };
  } catch (e) {
    return markFailure(source, started, e);
  }
}
