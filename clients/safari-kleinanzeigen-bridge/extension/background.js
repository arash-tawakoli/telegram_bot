const api = globalThis.browser ?? globalThis.chrome;
const BRIDGE_ENDPOINT = 'https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/application-worker?oauth_bridge=kleinanzeigen';
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

async function completeCallback(callbackUrl) {
  const safeUrl = validCallback(callbackUrl);
  if (!safeUrl) return { ok: false, error: 'invalid_callback_url' };

  try {
    const response = await fetch(BRIDGE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callbackUrl: safeUrl }),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error'
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      return { ok: false, error: String(body?.error || 'bridge_failed').slice(0, 80) };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'bridge_unreachable' };
  }
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'complete-kleinanzeigen-login') return false;
  const senderUrl = validCallback(sender?.url || '');
  const callbackUrl = validCallback(message?.callbackUrl || '');
  if (!senderUrl || !callbackUrl || senderUrl !== callbackUrl) {
    sendResponse({ ok: false, error: 'invalid_sender' });
    return false;
  }
  completeCallback(callbackUrl).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'bridge_failed' }));
  return true;
});
