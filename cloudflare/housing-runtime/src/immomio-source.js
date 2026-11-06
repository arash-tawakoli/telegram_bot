import { queueMatches } from "./matching.js";

const GRAPHQL_URL = "https://gql-hp.immomio.com/homepage/graphql";
const QUERY = `query propertyList($input: HomepagePropertySearchRequest!) { propertyList(input:$input){ page{page size totalElements totalPages} nodes{name totalRooms size totalRentGross externalId wbs applicationLink objectId propertyType marketingType status address{city street houseNumber zipCode district} availableFrom{dateAvailable stringAvailable} titleImage{url}}}}`;

function tokenFrom(value) {
  try {
    const url = new URL(String(value));
    return url.hostname === "homepage.immomio.com" ? url.searchParams.get("token") : null;
  } catch {
    return null;
  }
}

function tenantFrom(token) {
  try {
    return String(JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).customerId || "");
  } catch {
    return "";
  }
}

export function validateImmomioPage(payload, page) {
  const list = payload?.data?.propertyList;
  const info = list?.page;
  if (payload?.errors?.length || !info || !Array.isArray(list.nodes)) throw new Error("immomio_incomplete_response");
  if (!Number.isInteger(info.page) || info.page !== page || !Number.isInteger(info.totalElements) || info.totalElements < 0 || !Number.isInteger(info.totalPages) || info.totalPages < 0 || info.totalPages > 50 || !Number.isInteger(info.size) || info.size < 1 || info.totalPages !== Math.ceil(info.totalElements / info.size)) throw new Error("immomio_pagination_invalid");
  if (list.nodes.length !== Math.min(info.size, Math.max(0, info.totalElements - page * info.size))) throw new Error("immomio_truncated_page");
  return list;
}

async function resolveHomepage(url) {
  const direct = tokenFrom(url);
  if (direct) return { url: String(url), token: direct };
  const response = await fetch(String(url), { headers: { accept: "text/html", "user-agent": "TraumWohnungHamburg/1.0" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`immomio_homepage_${response.status}`);
  const html = await response.text();
  const match = html.match(/(?:src|href)=["']([^"']*homepage\.immomio\.com[^"']+)["']/i);
  const resolved = match ? new URL(match[1], response.url).href : "";
  const token = tokenFrom(resolved);
  if (!token) throw new Error("immomio_token_missing");
  return { url: resolved, token };
}

function normalizeNode(node, sourceId) {
  if (node?.propertyType !== "FLAT" || node?.marketingType !== "RENT" || String(node?.status || "") === "RENTED") return null;
  const key = String(node.objectId || node.externalId || "").trim();
  const applicationUrl = String(node.applicationLink || "");
  if (!key || !/^https:\/\/tenant\.immomio\.com\/(?:de\/)?apply\/[0-9a-f-]{36}$/i.test(applicationUrl)) return null;
  const address = node.address || {};
  return {
    source_id: sourceId,
    identity: key,
    canonical_url: applicationUrl,
    facts: {
      title: String(node.name || "Wohnungsangebot").slice(0, 240),
      city: String(address.city || "").slice(0, 120),
      district: String(address.district || "").slice(0, 120),
      postal_code: String(address.zipCode || "").slice(0, 16),
      address: [address.street, address.houseNumber].filter(Boolean).join(" ").slice(0, 240),
      warm_rent: Number.isFinite(Number(node.totalRentGross)) ? Number(node.totalRentGross) : null,
      rooms: Number.isFinite(Number(node.totalRooms)) ? Number(node.totalRooms) : null,
      area_sqm: Number.isFinite(Number(node.size)) ? Number(node.size) : null,
      wbs_required: node.wbs === true,
      available_from: node.availableFrom?.dateAvailable || null,
      image_url: typeof node.titleImage?.url === "string" ? node.titleImage.url.slice(0, 2000) : null,
      property_type: "Wohnung",
      provider_object_ref: String(node.externalId || node.objectId),
    },
  };
}

export async function fetchImmomioSource(source, config = {}) {
  const resolved = await resolveHomepage(config.url || source.homepage_url || source.search_url);
  const expectedTenant = tenantFrom(tokenFrom(config.url || source.homepage_url || source.search_url));
  const actualTenant = tenantFrom(resolved.token);
  if (expectedTenant && actualTenant && expectedTenant !== actualTenant) throw new Error("immomio_tenant_mismatch");
  const nodes = [];
  const seen = new Set();
  let total = 0;
  let totalPages = 1;
  for (let page = 0; page < totalPages; page++) {
    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { input: { page, size: 250, token: resolved.token, sort: ["created,desc"], marketingType: "RENT" } } }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`immomio_http_${response.status}`);
    const list = validateImmomioPage(await response.json(), page);
    if (page && (list.page.totalElements !== total || Math.max(1, list.page.totalPages) !== totalPages)) throw new Error("immomio_inventory_changed");
    total = list.page.totalElements;
    totalPages = Math.max(1, list.page.totalPages);
    for (const node of list.nodes) {
      const item = normalizeNode(node, source.id);
      if (!item) continue;
      if (seen.has(item.identity)) throw new Error("immomio_duplicate_identity");
      seen.add(item.identity);
      nodes.push(item);
    }
  }
  return { nodes, fetched: total, pages: totalPages };
}

export async function ingestImmomioSource(sql, source, config = {}) {
  const result = await fetchImmomioSource(source, config);
  let inserted = 0;
  for (const node of result.nodes) {
    const rows = await sql`
      INSERT INTO housing.offer_identities (id, source_id, identity_hash, external_id, canonical_url, facts, last_seen_at, expires_at)
      VALUES (gen_random_uuid(), ${node.source_id}, ${node.source_id + ":external:" + node.identity}, ${node.identity}, ${node.canonical_url}, ${JSON.stringify(node.facts)}::jsonb, now(), now() + interval '24 hours')
      ON CONFLICT (identity_hash) DO UPDATE SET canonical_url = EXCLUDED.canonical_url, facts = EXCLUDED.facts, last_seen_at = now(), expires_at = EXCLUDED.expires_at
      RETURNING id
    `;
    if (rows.length) {
      inserted++;
      await queueMatches(sql, rows[0].id, node.source_id, node.source_id + ":external:" + node.identity, { ...node.facts, canonical_url: node.canonical_url });
    }
  }
  return { fetched: result.fetched, valid: result.nodes.length, inserted, pages: result.pages };
}
