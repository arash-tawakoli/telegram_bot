import { chromium } from 'playwright';

const START_URL = process.env.IMMOSCOUT_SEARCH_URL || 'https://www.immobilienscout24.de/Suche/de/hamburg/hamburg/wohnung-mieten';
const MAX_PAGES = Math.max(1, Math.min(Number(process.env.MAX_PAGES || 5), 50));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const found = new Map();
let blocked = false;
let pagesVisited = 0;

try {
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const url = new URL(START_URL);
    if (pageNo > 1) url.searchParams.set('pagenumber', String(pageNo));
    const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    pagesVisited++;
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if ((response && [401, 403, 429].includes(response.status())) || /captcha|access denied|unusual traffic/i.test(bodyText)) {
      blocked = true;
      break;
    }
    const links = await page.locator('a[href*="/expose/"]').evaluateAll((els) => els.map((a) => ({ href: a.href, text: (a.textContent || '').trim() })));
    for (const link of links) {
      const match = link.href.match(/\/expose\/(\d+)/);
      if (match) found.set(match[1], { expose_id: match[1], url: link.href.split('?')[0], title_hint: link.text || null, page: pageNo });
    }
    if (!links.length) break;
  }
  console.log(JSON.stringify({ connector: 'immoscout_playwright_browser', production: false, start_url: START_URL, pages_visited: pagesVisited, blocked, expose_count: found.size, exposes: [...found.values()] }, null, 2));
} finally {
  await browser.close();
}
