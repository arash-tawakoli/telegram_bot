const api = globalThis.browser ?? globalThis.chrome;
const TELEGRAM_CONNECTED = 'https://t.me/traumwohnunghamburgbot?start=ka_connected';
const TELEGRAM_FAILED = 'https://t.me/traumwohnunghamburgbot?start=ka_failed';

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
  if (document.body) draw(); else document.addEventListener('DOMContentLoaded', draw, { once: true });
}

function sendRuntimeMessage(message) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value || { ok: false, error: 'bridge_failed' });
    };
    try {
      const result = api.runtime.sendMessage(message, finish);
      if (result && typeof result.then === 'function') result.then(finish).catch(() => finish({ ok: false, error: 'bridge_failed' }));
    } catch {
      finish({ ok: false, error: 'bridge_failed' });
    }
  });
}

renderStatus('Kleinanzeigen wird verbunden …', 'Die Anmeldung wird sicher abgeschlossen. Du musst nichts kopieren oder teilen.');

sendRuntimeMessage({
  type: 'complete-kleinanzeigen-login',
  callbackUrl: location.href
}).then(response => {
  if (response?.ok !== true) {
    renderStatus('Verbindung fehlgeschlagen', 'Bitte kehre zu Traumwohnung Hamburg zurück und starte die Kleinanzeigen-Verbindung erneut.');
    setTimeout(() => location.replace(TELEGRAM_FAILED), 900);
    return;
  }
  renderStatus('Kleinanzeigen verbunden', 'Die Verbindung wurde gespeichert. Du wirst zurück zu Telegram geführt.');
  setTimeout(() => location.replace(TELEGRAM_CONNECTED), 600);
});
