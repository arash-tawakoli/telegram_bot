/**
 * The only source families admitted by the housing cutover.
 * Keep the list explicit so a newly inserted source cannot become live by default.
 */
export const HOUSING_SOURCES = Object.freeze([
  { id: 1, name: "ImmobilienScout24 Hamburg", family: "immoscout24", connector: "mcp", delivery_mode: "live" },
  { id: 2, name: "Kleinanzeigen Hamburg", family: "kleinanzeigen", connector: "mcp", delivery_mode: "live" },
  { id: 3, name: "Immowelt Hamburg", family: "immowelt", connector: "html_discovery", delivery_mode: "live" },
  { id: 23, name: "Hamburger Wohnen", family: "immomio", connector: "immomio_tenant", delivery_mode: "live" },
  { id: 29, name: "VHW", family: "immomio", connector: "immomio_tenant", delivery_mode: "live" },
  { id: 35, name: "Walddörfer", family: "immomio", connector: "immomio_tenant", delivery_mode: "live" },
  { id: 66, name: "GEWOBA Nord", family: "immomio", connector: "immomio_tenant", delivery_mode: "live" },
  { id: 69, name: "ImmobilienScout24 Schleswig-Holstein", family: "immoscout24", connector: "mcp", delivery_mode: "live" },
  { id: 72, name: "ImmobilienScout24 Berlin", family: "immoscout24", connector: "mcp", delivery_mode: "live" },
]);

const BY_ID = new Map(HOUSING_SOURCES.map((source) => [source.id, source]));

export function sourceForId(sourceId) {
  const source = BY_ID.get(Number(sourceId));
  return source ? { ...source } : null;
}

export function assertAllowedSource(sourceId) {
  const source = sourceForId(sourceId);
  if (!source) throw new Error("source_not_allowlisted");
  return source;
}

function required(value, field) {
  const result = String(value ?? "").trim();
  if (!result || result.length > 2048) throw new Error(`offer_${field}_invalid`);
  return result;
}

export function normalizeCanonicalUrl(value) {
  const url = new URL(required(value, "url"));
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|msclkid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href.replace(/\/$/, "");
}

export async function offerIdentity({ sourceId, externalId, canonicalUrl }) {
  const source = assertAllowedSource(sourceId);
  const external = externalId == null ? "" : String(externalId).trim();
  const identity = external
    ? `${source.id}:external:${external}`
    : `${source.id}:url:${normalizeCanonicalUrl(canonicalUrl)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { source, identity, hash };
}

export function deliveryIdempotencyKey(participantId, offerIdentityHash) {
  return `${required(participantId, "participant_id")}:${required(offerIdentityHash, "identity_hash")}`;
}

export function applicationIdempotencyKey(participantId, provider, offerIdentityHash) {
  const p = required(provider, "provider").toLowerCase();
  if (!["immoscout24", "immowelt", "immomio", "kleinanzeigen"].includes(p)) throw new Error("provider_not_allowlisted");
  return `${required(participantId, "participant_id")}:${p}:${required(offerIdentityHash, "identity_hash")}`;
}
