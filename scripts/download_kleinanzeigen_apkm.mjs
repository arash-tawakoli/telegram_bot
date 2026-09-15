import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const VARIANT = 'https://www.apkmirror.com/apk/kleinanzeigen-de-gmbh/ebay-kleinanzeigen-for-germany/kleinanzeigen-marketplace-2026-37-1-release/kleinanzeigen-marketplace-2026-37-1-3-android-apk-download/';
const OUTDIR = process.env.KA_ANALYSIS_DIR || 'tmp/ka-analysis';
const OUT = path.join(OUTDIR, 'kleinanzeigen-2026.37.1.apkm');
const EXPECTED = 'ebc40294eb9e9568ef3c0eb5e29b38bcbeb103c8af40573ad07495aa867dafd0';
const UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

await fs.mkdir(OUTDIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true, userAgent: UA, locale: 'de-DE' });
const page = await context.newPage();

async function dump(tag) {
  const html = await page.content();
  await fs.writeFile(path.join(OUTDIR, `playwright-${tag}.html`), html);
  const links = await page.locator('a').evaluateAll((els) => els.map((a) => ({
    text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
    href: a.href || '',
    cls: a.className || '',
  })).filter((x) => x.href));
  await fs.writeFile(path.join(OUTDIR, `playwright-${tag}-links.json`), JSON.stringify(links, null, 2));
  return links;
}

function score(link) {
  const u = String(link.href || '').toLowerCase();
  const t = String(link.text || '').toLowerCase();
  let s = 0;
  if (u.includes('/wp-content/themes/apkmirror/download.php')) s += 1000;
  if (/downloadr\d*\.apkmirror\.com/.test(u)) s += 900;
  if (u.includes('/wp-content/uploads/')) s += 800;
  if (/\.(apkm|apk|xapk)(\?|$)/.test(u)) s += 700;
  if (u.includes('/download/?key=') && !u.includes('#')) s += 500;
  if (u.includes('key=')) s += 70;
  if (t.includes('download apk bundle')) s += 100;
  if (t.includes('download apk')) s += 90;
  if (t.includes('download')) s += 30;
  if (u.includes('facebook') || u.includes('twitter') || u.includes('google') || u.includes('#disqus_thread')) s -= 600;
  return s;
}

async function bestLink(tag) {
  const links = await dump(tag);
  const ranked = links.map((x) => ({ ...x, score: score(x) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  await fs.writeFile(path.join(OUTDIR, `playwright-${tag}-ranked.json`), JSON.stringify(ranked.slice(0, 80), null, 2));
  return ranked[0] || null;
}

async function saveWithRequest(url, referer) {
  const response = await context.request.get(url, { headers: { Referer: referer, Accept: '*/*' }, timeout: 120000, failOnStatusCode: false });
  const ctype = response.headers()['content-type'] || '';
  const disposition = response.headers()['content-disposition'] || '';
  console.log(`request ${response.status()} ${ctype} ${disposition} ${response.url()}`);
  if (!response.ok()) return false;
  if (ctype.includes('text/html')) {
    const text = await response.text();
    await fs.writeFile(path.join(OUTDIR, 'playwright-binary-candidate.html'), text);
    return false;
  }
  const body = await response.body();
  await fs.writeFile(OUT, body);
  return true;
}

try {
  await page.goto(VARIANT, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(17000);
  let candidate = await bestLink('variant');
  if (!candidate) throw new Error('no download link on variant page');

  let saved = false;
  for (let hop = 0; hop < 6 && !saved; hop++) {
    console.log(`hop=${hop} candidate=${candidate.href} text=${candidate.text}`);
    if (/\/wp-content\/themes\/apkmirror\/download\.php|downloadr\d*\.apkmirror\.com|\/wp-content\/uploads\/|\.(?:apkm|apk|xapk)(?:\?|$)/i.test(candidate.href)) {
      saved = await saveWithRequest(candidate.href, page.url());
      if (saved) break;
    }

    const target = candidate.href.split('#')[0];
    if (!target || target === page.url()) throw new Error(`stalled at ${target}`);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(hop === 0 ? 17000 : 2500);
    candidate = await bestLink(`hop-${hop}`);
    if (!candidate) throw new Error(`no download candidate at hop ${hop}`);
  }
  if (!saved) throw new Error('binary download was not reached');

  const bytes = await fs.readFile(OUT);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  console.log(`downloaded_bytes=${bytes.length}`);
  console.log(`sha256=${sha}`);
  if (sha !== EXPECTED) throw new Error(`unexpected sha256 ${sha}`);
} finally {
  await browser.close();
}
