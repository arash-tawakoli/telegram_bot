import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PROVIDER = 'immoscout';
const ISSUER = 'https://login.immobilienscout24.de/oauth2/aus1227au6oBg6hGH417';
const AUTHORIZE = `${ISSUER}/v1/authorize`;
const TOKEN = `${ISSUER}/v1/token`;
const USERINFO = `${ISSUER}/v1/userinfo`;
const CLIENT_ID = 'is24-android-de';
const REDIRECT_URI = 'immobilienscout24.de:/loginCallback';
const SCOPE = 'openid profile offline_access';
const OAUTH_USER_AGENT = 'okta-oauth2-kotlin/2.0.3 Android/34';
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes: Uint8Array) => {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};
const unb64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const clean = (value: unknown, max = 320) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const uuid = (value: unknown) => {
  const text = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) throw new Error('invalid_user');
  return text;
};
const validEmail = (value: unknown) => {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};
async function challenge(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
}

async function secret(name: string) {
  const { data, error } = await db.rpc('get_bot_secret', { secret_name: name });
  if (error || !data) throw new Error('configuration_unavailable');
  return String(data);
}
async function eligible(userId: string) {
  const { data, error } = await db.rpc('application_user_eligible', { p_user: userId });
  if (error || data !== true) throw new Error('premium_required');
}
async function keyMaterial(version = 1) {
  const raw = unb64(await secret(`application_credential_key_v${version}`));
  if (raw.length !== 32) throw new Error('credential_key_invalid');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
}
async function encryptCredentials(userId: string, value: unknown, version = 1) {
  const key = await keyMaterial(version);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = enc.encode(`${userId}:${PROVIDER}:v${version}`);
  const plain = enc.encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain));
  return { credential_ciphertext: b64(cipher), credential_iv: b64(iv), key_version: version };
}
async function connectionHint(userId: string) {
  const { data } = await db.from('platform_connections').select('account_hint').eq('user_id', userId).eq('provider', PROVIDER).maybeSingle();
  return validEmail(data?.account_hint);
}
async function markPending(userId: string) {
  const hint = await connectionHint(userId);
  const { error } = await db.from('platform_connections').upsert({
    user_id: userId,
    provider: PROVIDER,
    status: 'pending',
    account_hint: hint,
    credential_ciphertext: null,
    credential_iv: null,
    key_version: 1,
    expires_at: null,
    last_verified_at: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' });
  if (error) throw new Error('connection_update_failed');
}

async function begin(userId: string) {
  await eligible(userId);
  await db.from('platform_auth_flows').delete().eq('user_id', userId).eq('provider', PROVIDER).is('consumed_at', null);
  const verifier = random();
  const state = random().slice(0, 43);
  const { error } = await db.from('platform_auth_flows').insert({ user_id: userId, provider: PROVIDER, state, code_verifier: verifier });
  if (error) throw new Error('auth_flow_create_failed');
  await markPending(userId);

  const url = new URL(AUTHORIZE);
  const params: Record<string, string> = {
    source: 'myaccount',
    utm_medium: 'app',
    utm_source: 'android',
    utm_campaign: 'sso_entrance',
    app_name: CLIENT_ID,
    consent: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    nonce: crypto.randomUUID(),
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'login',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { status: 'login', url: url.href, transport: 'native-callback-helper', expiresInSeconds: 1800 };
}

function callbackParts(value: string) {
  let url: URL;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('invalid_callback_url'); }
  if (url.protocol !== 'immobilienscout24.de:' || url.hostname || url.port || url.username || url.password || url.pathname !== '/loginCallback') throw new Error('invalid_callback_url');
  const fragment = new URLSearchParams(url.hash.replace(/^#/, '').replace(/^\?/, ''));
  return {
    state: fragment.get('state') || url.searchParams.get('state'),
    code: fragment.get('code') || url.searchParams.get('code'),
    oauthError: fragment.get('error') || url.searchParams.get('error'),
  };
}
async function flowByState(state: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(state)) throw new Error('invalid_state');
  const { data, error } = await db.from('platform_auth_flows').select('*').eq('provider', PROVIDER).eq('state', state).is('consumed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error || !data) throw new Error('auth_flow_expired');
  return data;
}
async function claimFlow(flow: any) {
  const { data, error } = await db.from('platform_auth_flows').update({ consumed_at: new Date().toISOString() }).eq('id', flow.id).is('consumed_at', null).select('id').maybeSingle();
  if (error || !data) throw new Error('auth_flow_expired');
}
async function tokenRequest(payload: Record<string, string>) {
  try {
    const response = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': OAUTH_USER_AGENT },
      body: new URLSearchParams({ ...payload, client_id: CLIENT_ID }),
      signal: AbortSignal.timeout(25000),
    });
    return { response, body: await response.json().catch(() => null) };
  } catch { throw new Error('temporary_network_error'); }
}
async function userInfo(accessToken: string) {
  try {
    const response = await fetch(USERINFO, { headers: { accept: 'application/json', authorization: `Bearer ${accessToken}`, 'user-agent': OAUTH_USER_AGENT }, signal: AbortSignal.timeout(25000) });
    return { response, body: await response.json().catch(() => null) };
  } catch { throw new Error('temporary_network_error'); }
}
async function saveConnected(userId: string, credentials: any, accountHint: string | null, expiresAt: string) {
  const encrypted = await encryptCredentials(userId, credentials);
  const { error } = await db.from('platform_connections').upsert({
    user_id: userId,
    provider: PROVIDER,
    status: 'connected',
    account_hint: accountHint,
    ...encrypted,
    expires_at: expiresAt,
    last_verified_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' });
  if (error) throw new Error('connection_save_failed');
}
async function complete(callbackUrl: string) {
  const parsed = callbackParts(callbackUrl);
  if (!parsed.state) throw new Error('invalid_callback_url');
  if (parsed.oauthError) throw new Error('oauth_login_failed');
  if (!parsed.code) throw new Error('invalid_callback_url');
  const flow = await flowByState(parsed.state);
  const userId = uuid(flow.user_id);
  await eligible(userId);
  await claimFlow(flow);

  const { response, body } = await tokenRequest({
    grant_type: 'authorization_code',
    code: parsed.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: String(flow.code_verifier || ''),
  });
  if (!response.ok || !body?.access_token) {
    await db.from('platform_connections').update({ status: 'needs_login', last_error: clean(`${body?.error || 'token_exchange_failed'}:${body?.error_description || response.status}`, 160), updated_at: new Date().toISOString() }).eq('user_id', userId).eq('provider', PROVIDER);
    throw new Error('token_exchange_failed');
  }
  if (!body?.refresh_token) throw new Error('refresh_token_missing');

  const info = await userInfo(String(body.access_token));
  if (!info.response.ok || !info.body?.sub) throw new Error('userinfo_failed');
  const hint = validEmail(info.body?.email) || await connectionHint(userId);
  const expiresAt = new Date(Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000).toISOString();
  await saveConnected(userId, {
    access_token: String(body.access_token),
    refresh_token: String(body.refresh_token),
    id_token: body.id_token ? String(body.id_token) : null,
    expires_at: expiresAt,
    token_type: String(body.token_type || 'Bearer'),
    scope: String(body.scope || SCOPE),
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    issuer: ISSUER,
    sub: String(info.body.sub),
  }, hint, expiresAt);
  return { status: 'connected', authenticated: true, accountReady: true, accountHint: hint };
}

const PUBLIC_SAFE = new Set(['invalid_callback_url', 'invalid_state', 'auth_flow_expired', 'oauth_login_failed', 'token_exchange_failed', 'refresh_token_missing', 'userinfo_failed', 'temporary_network_error']);
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = await req.json().catch(() => ({}));

    if (body.action === 'complete') {
      try { return Response.json(await complete(String(body.callbackUrl || '')), { headers: { 'cache-control': 'no-store' } }); }
      catch (error: any) {
        const code = String(error?.message || 'immoscout_operation_failed');
        return Response.json({ error: PUBLIC_SAFE.has(code) ? code : 'immoscout_operation_failed' }, { status: code === 'auth_flow_expired' || code === 'invalid_state' ? 410 : 400, headers: { 'cache-control': 'no-store' } });
      }
    }

    if (req.headers.get('x-internal-secret') !== await secret('internal_worker_secret')) return new Response('unauthorized', { status: 401 });
    if (body.action === 'health') return Response.json({ ok: true, mode: 'provider-hosted-pkce-native-handoff', clientId: CLIENT_ID, redirectUri: REDIRECT_URI, expiresInSeconds: 1800, passwordHandledByUs: false, mfaHandledByUs: false });
    if (body.action === 'begin') return Response.json(await begin(uuid(body.userId)));
    throw new Error('invalid_action');
  } catch (error: any) {
    const code = String(error?.message || 'immoscout_operation_failed');
    const safe = new Set(['configuration_unavailable', 'credential_key_invalid', 'premium_required', 'invalid_user', 'invalid_action', 'auth_flow_create_failed', 'connection_update_failed']);
    return Response.json({ error: safe.has(code) ? code : 'immoscout_operation_failed' }, { status: 503 });
  }
});
