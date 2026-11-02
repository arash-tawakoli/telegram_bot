const LEASE_PREFIX = 'refresh_in_progress:';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sameInstant(a: unknown, b: unknown) {
  if (a == null || b == null) return a === b;
  const left = Date.parse(String(a)), right = Date.parse(String(b));
  return Number.isFinite(left) && Number.isFinite(right)
    ? left === right
    : String(a) === String(b);
}

export function parsePlatformRefreshLease(value: unknown, now = Date.now()) {
  const match = String(value ?? '').match(/^refresh_in_progress:(\d{10,16}):([0-9a-f-]{36})$/i);
  if (!match) return null;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt)) return null;
  return { expiresAt, token: match[2], active: expiresAt > now };
}

export function classifyOAuthRefreshFailure(status: number, body: any = {}) {
  const rawCode = body?.error ?? body?.error_code ?? body?.errorCode ?? body?.code ?? '';
  const code = String(rawCode).trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 64);
  const transient = status === 408 || status === 425 || status === 429 || status >= 500;
  const configurationCodes = new Set([
    'invalid_client',
    'unauthorized_client',
    'unsupported_grant_type',
    'invalid_request',
    'invalid_scope',
  ]);
  const configuration = !transient && configurationCodes.has(code);
  const requiresLogin = !transient && !configuration && status >= 400 && status < 500;
  const diagnostic = configuration
    ? `refresh_config_error:${code}`
    : `refresh_http_${status}:${code || 'unknown'}`;
  return { code, transient, configuration, requiresLogin, diagnostic };
}

/**
 * Atomically leases a provider connection using existing columns.
 * The timestamp compare-and-swap prevents two refresh calls from using the
 * same stale row. A short bounded wait lets the second caller reuse the
 * first caller's refreshed token instead of rotating it again.
 */
export async function claimPlatformRefresh(
  db: any,
  userId: string,
  provider: string,
  observedUpdatedAt: string | null = null,
  options: { waitMs?: number; pollMs?: number; leaseMs?: number } = {},
) {
  const waitMs = Math.max(0, Number(options.waitMs ?? 5000));
  const pollMs = Math.max(10, Number(options.pollMs ?? 125));
  const leaseMs = Math.max(1000, Number(options.leaseMs ?? 40000));
  const deadline = Date.now() + waitMs;

  for (let attempt = 0; attempt < 100; attempt++) {
    const { data: row, error } = await db
      .from('platform_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();
    if (error) throw Error('temporary_network_error');
    if (!row) throw Error('needs_login');

    const existing = parsePlatformRefreshLease(row.last_refresh_error);
    if (existing?.active) {
      if (Date.now() >= deadline) throw Error('temporary_network_error');
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
      continue;
    }

    const token = crypto.randomUUID();
    const claimedAt = new Date().toISOString();
    const marker = `${LEASE_PREFIX}${Date.now() + leaseMs}:${token}`;
    const { data, error: claimError } = await db
      .from('platform_connections')
      .update({ last_refresh_error: marker, updated_at: claimedAt })
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('updated_at', row.updated_at)
      .select('user_id');
    if (claimError) throw Error('temporary_network_error');
    if (Array.isArray(data) && data.length === 1) {
      return {
        marker,
        claimedAt,
        row: { ...row, last_refresh_error: marker, updated_at: claimedAt },
        changedSinceObservation: Boolean(
          observedUpdatedAt && !sameInstant(row.updated_at, observedUpdatedAt),
        ),
      };
    }
    if (Date.now() >= deadline) throw Error('temporary_network_error');
    await sleep(Math.min(25, Math.max(1, deadline - Date.now())));
  }
  throw Error('temporary_network_error');
}

export async function releasePlatformRefresh(
  db: any,
  userId: string,
  provider: string,
  lease: { marker: string } | null | undefined,
) {
  if (!lease?.marker) return;
  const { error } = await db
    .from('platform_connections')
    .update({ last_refresh_error: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('last_refresh_error', lease.marker);
  if (error) throw Error('refresh_lock_release_failed');
}
