const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH_RE = new RegExp(`^/(?:de/)?apply/(${UUID})/?$`, 'i');
const TEXT_RE = new RegExp(`https:\\/\\/tenant\\.immomio\\.com\\/(?:de\\/)?apply\\/(${UUID})(?:\\/?(?:[?#][^\\s\\"'<>\\\\]*)?)`, 'ig');
const RDR_TEXT_RE = /https:\/\/rdr\.immomio\.com\/[A-Za-z0-9_-]{3,128}(?:\/?(?:[?#][^\s\"'<>\\]*)?)?/ig;

function cleanText(value) {
  return String(value ?? '')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*47;|&#x0*2f;/gi, '/');
}

export function normalizeImmomioApply(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) return null;
  const cleaned = cleanText(value.trim());
  try {
    const u = new URL(cleaned);
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'tenant.immomio.com' || u.port || u.username || u.password) return null;
    const m = u.pathname.match(PATH_RE);
    if (!m) return null;
    const id = m[1].toLowerCase();
    return {sourceIdentifier:id,url:`https://tenant.immomio.com/apply/${id}`};
  } catch {
    return null;
  }
}

export function extractImmomioApplyUrlsFromText(value, finalUrl = null) {
  const out = new Map();
  const direct = normalizeImmomioApply(finalUrl);
  if (direct) out.set(direct.sourceIdentifier, direct.url);
  if (typeof value !== 'string' || !value) return [...out.entries()].map(([sourceIdentifier,url])=>({sourceIdentifier,url}));
  const text = cleanText(value.slice(0, 2_000_000));
  TEXT_RE.lastIndex = 0;
  for (const m of text.matchAll(TEXT_RE)) {
    const hit = normalizeImmomioApply(m[0]);
    if (hit) out.set(hit.sourceIdentifier, hit.url);
    if (out.size > 8) break;
  }
  return [...out.entries()].map(([sourceIdentifier,url])=>({sourceIdentifier,url}));
}

export function collectImmomioApplyUrls(value, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 8;
  const maxStrings = Number.isInteger(options.maxStrings) ? options.maxStrings : 4000;
  const out = new Map();
  let strings = 0;
  const visit = (v, depth) => {
    if (v == null || depth > maxDepth || strings >= maxStrings || out.size > 8) return;
    if (typeof v === 'string') {
      strings++;
      for (const hit of extractImmomioApplyUrlsFromText(v)) out.set(hit.sourceIdentifier, hit.url);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (typeof v === 'object') for (const x of Object.values(v)) visit(x, depth + 1);
  };
  visit(value, 0);
  return [...out.entries()].map(([sourceIdentifier,url])=>({sourceIdentifier,url}));
}


export function normalizeImmomioRedirect(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) return null;
  try {
    const u = new URL(cleanText(value.trim()));
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'rdr.immomio.com' || u.port || u.username || u.password) return null;
    if (!/^\/[A-Za-z0-9_-]{3,128}\/?$/.test(u.pathname)) return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

export function extractImmomioRedirectUrlsFromText(value) {
  if (typeof value !== 'string' || !value) return [];
  const text = cleanText(value.slice(0, 2_000_000));
  const out = new Set();
  RDR_TEXT_RE.lastIndex = 0;
  for (const m of text.matchAll(RDR_TEXT_RE)) {
    const url = normalizeImmomioRedirect(m[0]);
    if (url) out.add(url);
    if (out.size >= 8) break;
  }
  return [...out];
}
