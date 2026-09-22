const BRIDGE_ENDPOINT = 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-callback-bridge';
const COACH_FALLBACK = 'https://intern.traumwohnunghamburg.de';
const TELEGRAM_CONNECTED = 'https://t.me/traumwohnunghamburgbot?start=ka_connected';
const TELEGRAM_FAILED = 'https://t.me/traumwohnunghamburgbot?start=ka_failed';
const CALLBACK_ORIGIN = 'https://login.kleinanzeigen.de';
const CALLBACK_PATH = '/android/com.ebay.kleinanzeigen/callback';

function validCallback(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  if (url.origin !== CALLBACK_ORIGIN || url.pathname !== CALLBACK_PATH) return null;
  if (url.username || url.password || url.port) return null;
  if (!url.searchParams.get('state')) return null;
  if (!url.searchParams.get('code') && !url.searchParams.get('error')) return null;
  return url.href;
}

function safeRedirect(value, fallback) {
  let url;
  try { url = new URL(String(value || '')); } catch { return fallback; }
  const coach = url.origin === 'https://intern.traumwohnunghamburg.de';
  const telegram = url.origin === 'https://t.me' && url.pathname === '/traumwohnunghamburgbot';
  return coach || telegram ? url.href : fallback;
}

function renderStatus(title, detail) {
  const draw = () => {
    if (!document.body) return;
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.style.fontFamily = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';
    document.body.style.background = '#ffffff';
    document.body.style.color = '#111111';

    const wrap = document.createElement('main');
    wrap.style.minHeight = '100vh';
    wrap.style.display = 'grid';
    wrap.style.placeItems = 'center';
    wrap.style.padding = '24px';

    const card = document.createElement('section');
    card.style.maxWidth = '440px';
    card.style.textAlign = 'center';

    const heading = document.createElement('h1');
    heading.textContent = title;
    heading.style.fontSize = '22px';

    const text = document.createElement('p');
    text.textContent = detail;
    text.style.fontSize = '16px';
    text.style.lineHeight = '1.45';

    card.append(heading, text);
    wrap.append(card);
    document.body.append(wrap);
  };

  if (document.body) draw();
  else document.addEventListener('DOMContentLoaded', draw, { once: true });
}

function finishNavigation(body, ok) {
  const target = body?.returnTarget === 'coach' ? 'coach' : 'telegram';
  if (target === 'coach') {
    const redirect = safeRedirect(body?.redirectUrl, COACH_FALLBACK);
    setTimeout(() => {
      try { window.close(); } catch {}
      setTimeout(() => location.replace(redirect), 350);
    }, ok ? 500 : 900);
    return;
  }

  const fallback = ok ? TELEGRAM_CONNECTED : TELEGRAM_FAILED;
  const redirect = safeRedirect(body?.redirectUrl, fallback);
  setTimeout(() => location.replace(redirect), ok ? 600 : 900);
}

async function complete() {
  const callbackUrl = validCallback(location.href);
  if (!callbackUrl) return;

  renderStatus(
    'Kleinanzeigen wird verbunden …',
    'Die Anmeldung wird automatisch abgeschlossen. Du musst nichts kopieren oder teilen.'
  );

  let body = null;
  try {
    const response = await fetch(BRIDGE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callbackUrl }),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error'
    });

    body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      throw new Error(String(body?.error || 'bridge_failed'));
    }

    renderStatus(
      'Kleinanzeigen verbunden',
      body?.returnTarget === 'coach'
        ? 'Die Verbindung wurde gespeichert. Dieses Fenster wird geschlossen.'
        : 'Die Verbindung wurde gespeichert. Du wirst zurück zu Telegram geführt.'
    );
    finishNavigation(body, true);
  } catch {
    renderStatus(
      'Verbindung fehlgeschlagen',
      'Bitte kehre zu TraumWohnungHamburg zurück und starte die Kleinanzeigen-Verbindung erneut.'
    );
    finishNavigation(body || {}, false);
  }
}

void complete();
