import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const ENV_KEYS = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = ENV_KEYS.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const BUCKET = 'debug-artifacts';
const VERSION = '2026.37.1';
const APKMIRROR_PAGE = 'https://www.apkmirror.com/apk/kleinanzeigen-de-gmbh/ebay-kleinanzeigen-for-germany/kleinanzeigen-marketplace-2026-37-1-release/kleinanzeigen-marketplace-2026-37-1-3-android-apk-download/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function secret(name: string) {
  const { data, error } = await db.rpc('get_bot_secret', { secret_name: name });
  if (error || !data) throw new Error('configuration_unavailable');
  return String(data);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

function storageHeaders(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, ...extra };
}

function objectUrl(path: string) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(BUCKET)}/${encoded}`;
}

async function ensureBucket() {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: storageHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 1073741824 }),
  });
  if (r.ok || r.status === 409 || r.status === 400) return;
  throw new Error(`bucket_create_${r.status}`);
}

async function uploadStream(path: string, body: ReadableStream<Uint8Array>, contentType: string) {
  await ensureBucket();
  const r = await fetch(objectUrl(path), {
    method: 'POST',
    headers: storageHeaders({ 'content-type': contentType, 'x-upsert': 'true' }),
    body,
    duplex: 'half',
  } as RequestInit & { duplex: string });
  if (!r.ok) throw new Error(`storage_upload_${r.status}:${(await r.text()).slice(0, 180)}`);
}

function cookiesFrom(response: Response, jar: Map<string, string>) {
  const h: any = response.headers;
  let rows: string[] = [];
  try { if (typeof h.getSetCookie === 'function') rows = h.getSetCookie(); } catch {}
  if (!rows.length) {
    const one = response.headers.get('set-cookie');
    if (one) rows = [one];
  }
  for (const row of rows) {
    for (const piece of row.split(/,(?=\s*[^;,=\s]+=[^;,]+)/)) {
      const m = piece.trim().match(/^([^=;\s]+)=([^;]*)/);
      if (m) jar.set(m[1], m[2]);
    }
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function mirrorFetch(url: string, jar: Map<string, string>, referer?: string, redirect: RequestRedirect = 'follow') {
  const headers: Record<string, string> = {
    'user-agent': UA,
    accept: 'text/html,application/xhtml+xml,application/octet-stream;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9,de;q=0.8',
  };
  const cookie = cookieHeader(jar);
  if (cookie) headers.cookie = cookie;
  if (referer) headers.referer = referer;
  const r = await fetch(url, { headers, redirect, signal: AbortSignal.timeout(60000) });
  cookiesFrom(r, jar);
  return r;
}

function absoluteHref(raw: string, base: string) {
  const decoded = raw.replace(/&amp;/g, '&');
  try { return new URL(decoded, base).href; } catch { return ''; }
}

function findDownloadHref(html: string, base: string) {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => absoluteHref(m[1], base)).filter(Boolean);
  return hrefs.find((u) => /\/download\/\?key=/i.test(u))
    || hrefs.find((u) => /downloadr\d*\.apkmirror\.com/i.test(u) && /\.(?:apkm|apk)(?:\?|$)/i.test(u))
    || hrefs.find((u) => /\.(?:apkm|apk)(?:\?|$)/i.test(u))
    || '';
}

function looksBinary(r: Response) {
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  const cd = (r.headers.get('content-disposition') || '').toLowerCase();
  return !ct.includes('text/html') && (ct.includes('octet-stream') || ct.includes('android.package') || /\.apkm|\.apk/.test(cd));
}

async function openApkmirrorBinary() {
  const jar = new Map<string, string>();
  const page = await mirrorFetch(APKMIRROR_PAGE, jar);
  if (!page.ok) throw new Error(`mirror_page_${page.status}`);
  const html = await page.text();
  let href = findDownloadHref(html, page.url || APKMIRROR_PAGE);
  if (!href) throw new Error('mirror_download_link_missing');
  if (/\/download\/\?key=/i.test(href)) await sleep(16000);
  let r = await mirrorFetch(href, jar, page.url || APKMIRROR_PAGE, 'manual');
  for (let hop = 0; hop < 5; hop++) {
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get('location');
      if (!loc) throw new Error('mirror_redirect_missing');
      const next = absoluteHref(loc, href);
      href = next;
      r = await mirrorFetch(next, jar, href, 'manual');
      continue;
    }
    if (looksBinary(r)) return r;
    const text = await r.text();
    const next = findDownloadHref(text, r.url || href);
    if (!next) throw new Error(`mirror_binary_missing_${r.status}`);
    href = next;
    r = await mirrorFetch(next, jar, r.url || href, 'manual');
  }
  throw new Error('mirror_redirect_loop');
}

async function stageBundle() {
  const r = await openApkmirrorBinary();
  if (!r.body) throw new Error('mirror_body_missing');
  const path = `kleinanzeigen/${VERSION}/bundle.apkm`;
  await uploadStream(path, r.body, r.headers.get('content-type') || 'application/octet-stream');
  return { ok: true, path, sourceStatus: r.status, sourceLength: r.headers.get('content-length') };
}

async function objectSize(path: string) {
  const h = await fetch(objectUrl(path), { method: 'HEAD', headers: storageHeaders() });
  const n = Number(h.headers.get('content-length') || 0);
  if (h.ok && n > 0) return n;
  const r = await fetch(objectUrl(path), { headers: storageHeaders({ Range: 'bytes=0-0' }) });
  if (!r.ok && r.status !== 206) throw new Error(`storage_size_${r.status}`);
  const m = (r.headers.get('content-range') || '').match(/\/(\d+)$/);
  if (!m) throw new Error('storage_size_missing');
  await r.body?.cancel();
  return Number(m[1]);
}

async function rangeBytes(path: string, start: number, end: number) {
  const r = await fetch(objectUrl(path), { headers: storageHeaders({ Range: `bytes=${start}-${end}` }) });
  if (!(r.ok || r.status === 206)) throw new Error(`storage_range_${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

type ZipEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number };

async function zipIndex(path: string): Promise<ZipEntry[]> {
  const size = await objectSize(path);
  const tailLen = Math.min(size, 131072);
  const tail = await rangeBytes(path, size - tailLen, size - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip_eocd_missing');
  const ev = new DataView(tail.buffer, tail.byteOffset + eocd, tail.byteLength - eocd);
  const cdSize = u32(ev, 12), cdOffset = u32(ev, 16);
  if (cdSize <= 0 || cdSize > 16 * 1024 * 1024) throw new Error('zip_cd_invalid');
  const cd = await rangeBytes(path, cdOffset, cdOffset + cdSize - 1);
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length) {
    if (u32(view, p) !== 0x02014b50) break;
    const method = u16(view, p + 10), compressedSize = u32(view, p + 20), uncompressedSize = u32(view, p + 24);
    const nameLen = u16(view, p + 28), extraLen = u16(view, p + 30), commentLen = u16(view, p + 32), localOffset = u32(view, p + 42);
    const name = dec.decode(cd.slice(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function entryStream(path: string, e: ZipEntry) {
  const header = await rangeBytes(path, e.localOffset, e.localOffset + 29);
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (u32(hv, 0) !== 0x04034b50) throw new Error('zip_local_header_invalid');
  const nameLen = u16(hv, 26), extraLen = u16(hv, 28), start = e.localOffset + 30 + nameLen + extraLen;
  const r = await fetch(objectUrl(path), { headers: storageHeaders({ Range: `bytes=${start}-${start + e.compressedSize - 1}` }) });
  if (!(r.ok || r.status === 206) || !r.body) throw new Error(`zip_entry_read_${r.status}`);
  if (e.method === 0) return r.body;
  if (e.method === 8) return r.body.pipeThrough(new DecompressionStream('deflate-raw'));
  throw new Error(`zip_method_${e.method}`);
}

async function extractEntry(sourcePath: string, entryName: string, targetPath: string) {
  const entries = await zipIndex(sourcePath);
  const e = entries.find((x) => x.name === entryName) || entries.find((x) => x.name.endsWith('/' + entryName));
  if (!e) throw new Error('zip_entry_missing');
  const stream = await entryStream(sourcePath, e);
  const type = targetPath.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream';
  await uploadStream(targetPath, stream, type);
  return { ok: true, sourcePath, entry: e, targetPath };
}

async function scanAscii(path: string, patterns: string[]) {
  const size = await objectSize(path);
  const needles = patterns.map((p) => new TextEncoder().encode(p));
  const hits: { pattern: string; offset: number; context: string }[] = [];
  const chunk = 1024 * 1024;
  let carry = new Uint8Array(0);
  const maxNeedle = Math.max(...needles.map((n) => n.length), 1);
  for (let start = 0; start < size && hits.length < 200; start += chunk) {
    const end = Math.min(size - 1, start + chunk - 1);
    const part = await rangeBytes(path, start, end);
    const data = new Uint8Array(carry.length + part.length); data.set(carry); data.set(part, carry.length);
    for (let ni = 0; ni < needles.length; ni++) {
      const n = needles[ni];
      outer: for (let i = 0; i <= data.length - n.length; i++) {
        for (let j = 0; j < n.length; j++) if (data[i + j] !== n[j]) continue outer;
        const from = Math.max(0, i - 160), to = Math.min(data.length, i + n.length + 220);
        const context = [...data.slice(from, to)].map((b) => b >= 32 && b < 127 ? String.fromCharCode(b) : ' ').join('').replace(/\s+/g, ' ').trim();
        hits.push({ pattern: patterns[ni], offset: start - carry.length + i, context });
        i += n.length;
        if (hits.length >= 200) break;
      }
      if (hits.length >= 200) break;
    }
    carry = data.slice(Math.max(0, data.length - (maxNeedle + 512)));
  }
  return { ok: true, path, size, hits };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (req.headers.get('x-internal-secret') !== await secret('internal_worker_secret')) return json({ error: 'unauthorized' }, 401);
    const body = await req.json();
    const action = String(body?.action || '');
    if (action === 'stage_bundle') return json(await stageBundle());
    if (action === 'zip_index') {
      const path = String(body?.path || ''); if (!path.startsWith('kleinanzeigen/')) return json({ error: 'invalid_path' }, 400);
      const entries = await zipIndex(path); return json({ ok: true, path, entries });
    }
    if (action === 'extract') {
      const sourcePath = String(body?.sourcePath || ''), entryName = String(body?.entryName || ''), targetPath = String(body?.targetPath || '');
      if (![sourcePath, targetPath].every((p) => p.startsWith('kleinanzeigen/')) || !entryName) return json({ error: 'invalid_request' }, 400);
      return json(await extractEntry(sourcePath, entryName, targetPath));
    }
    if (action === 'scan_ascii') {
      const path = String(body?.path || ''); if (!path.startsWith('kleinanzeigen/')) return json({ error: 'invalid_path' }, 400);
      const patterns = Array.isArray(body?.patterns) ? body.patterns.map(String).filter((x: string) => x.length >= 3 && x.length <= 100).slice(0, 40) : [];
      if (!patterns.length) return json({ error: 'patterns_required' }, 400);
      return json(await scanAscii(path, patterns));
    }
    return json({ error: 'invalid_action' }, 400);
  } catch (e: any) {
    return json({ error: String(e?.message || e).slice(0, 300) }, 500);
  }
});
