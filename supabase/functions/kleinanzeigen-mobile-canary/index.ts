import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const base = Deno.env.get('SUPABASE_URL')!;
const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const serviceKey = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const ADMIN_TELEGRAM_USER_ID = 8538226539;
const CLIENT_ID = 'uV5j90myVPc2XzEOFuWUD2At17OACEGQ';
const REDIRECT_URI = 'https://login.kleinanzeigen.de/android/com.ebay.kleinanzeigen/callback';
const AUTHORIZE_ENDPOINT = 'https://login.kleinanzeigen.de/authorize';
const SCOPE = 'openid email profile offline_access';
const APP_SCHEME = 'traumwohnung-ka-canary';
const STATE_RE = /^[A-Za-z0-9_-]{20,80}$/;

const HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...HEADERS, 'content-type': 'application/json; charset=utf-8' }
  });
}

function b64url(bytes: Uint8Array) {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

async function loadAdminFlow(state: string) {
  if (!STATE_RE.test(state)) throw Error('invalid_state');

  const { data: flow, error } = await db
    .from('platform_auth_flows')
    .select('id,user_id,state,code_verifier,expires_at,consumed_at,origin,return_target,context')
    .eq('provider', 'kleinanzeigen')
    .eq('state', state)
    .is('consumed_at', null)
    .maybeSingle();

  if (error || !flow || !flow.code_verifier) throw Error('auth_flow_expired');
  if (Date.parse(String(flow.expires_at || '')) <= Date.now()) throw Error('auth_flow_expired');

  const { data: user, error: userError } = await db
    .from('bot_users')
    .select('telegram_user_id')
    .eq('id', flow.user_id)
    .maybeSingle();

  if (userError || Number(user?.telegram_user_id) !== ADMIN_TELEGRAM_USER_ID) {
    throw Error('canary_not_allowed');
  }

  if (flow?.context?.mobile_canary !== true) throw Error('canary_not_allowed');

  return flow;
}

async function authorizationUrl(flow: any) {
  const challenge = await pkceChallenge(String(flow.code_verifier));
  const url = new URL(AUTHORIZE_ENDPOINT);
  const params: Record<string, string> = {
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: String(flow.state),
    prompt: 'login'
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

function handoffPage(state: string, loginUrl: string) {
  const deepLink = `${APP_SCHEME}://start?state=${encodeURIComponent(state)}`;
  const telegramFallback = 'https://t.me/traumwohnunghamburgbot';

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Kleinanzeigen Admin-Canary</title>
<style>
  :root { color-scheme: light; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  body { margin:0; background:#f7f5f2; color:#171717; }
  main { max-width:560px; margin:0 auto; padding:28px 20px 40px; }
  .card { background:#fff; border-radius:22px; padding:24px; box-shadow:0 10px 35px rgba(0,0,0,.08); }
  h1 { font-size:24px; margin:0 0 10px; }
  p { line-height:1.5; margin:8px 0 18px; }
  a { display:block; text-align:center; text-decoration:none; padding:14px 16px; border-radius:999px; margin-top:12px; font-weight:650; }
  .primary { background:#171717; color:#fff; }
  .secondary { background:#efefef; color:#171717; }
  .small { font-size:13px; color:#666; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>🧪 Kleinanzeigen Admin-Canary</h1>
    <p>Die mobile Test-App wird geöffnet. Nach dem Kleinanzeigen-Login soll der Rücksprung automatisch an Telegram übergeben werden.</p>
    <a class="primary" href="${deepLink}">Canary-App öffnen</a>
    <a class="secondary" href="${loginUrl}">Fallback: normalen Login öffnen</a>
    <a class="secondary" href="${telegramFallback}">Zurück zu Telegram</a>
    <p class="small">Nur für den Admin-Test. Der bestehende Share-Flow bleibt als Fallback erhalten.</p>
  </div>
</main>
<script>
  const deepLink = ${JSON.stringify(deepLink)};
  setTimeout(() => { try { window.location.href = deepLink; } catch {} }, 80);
</script>
</body>
</html>`;
}

Deno.serve(async (request) => {
  if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const url = new URL(request.url);
  const state = String(url.searchParams.get('state') || '');

  try {
    const flow = await loadAdminFlow(state);
    const loginUrl = await authorizationUrl(flow);

    if (url.searchParams.get('api') === 'login') {
      return json({ ok: true, url: loginUrl, expiresAt: flow.expires_at });
    }

    return new Response(handoffPage(state, loginUrl), {
      status: 200,
      headers: {
        ...HEADERS,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      }
    });
  } catch (error: any) {
    const code = String(error?.message || 'canary_unavailable');
    const safe = ['invalid_state', 'auth_flow_expired', 'canary_not_allowed'].includes(code) ? code : 'canary_unavailable';
    return json({ ok: false, error: safe }, safe === 'canary_not_allowed' ? 403 : 400);
  }
});
