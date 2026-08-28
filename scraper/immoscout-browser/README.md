# ImmoScout browser scraper probe

Deterministic Playwright/Chromium probe. No AI is used.

It opens the public Hamburg rental search in a real browser runtime, follows result pages, extracts unique `/expose/<id>` links, and prints JSON. It does not write to production or deliver Telegram messages.

Run:

```bash
npm install
npx playwright install chromium
MAX_PAGES=5 npm run scrape
```

Environment:
- `IMMOSCOUT_SEARCH_URL`: optional public search URL.
- `MAX_PAGES`: 1-50, defaults to 5.

If the site returns 401/403/429 or a CAPTCHA/access-denied page, the probe stops and reports `blocked: true`. It does not attempt to bypass access controls.