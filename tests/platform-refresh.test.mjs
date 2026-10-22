import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImmomioHomepageFallbacks,
} from '../supabase/functions/source-worker/immomio-inventory.ts';
import {
  claimPlatformRefresh,
  classifyOAuthRefreshFailure,
  parsePlatformRefreshLease,
  releasePlatformRefresh,
} from '../supabase/functions/_shared/platform-refresh.ts';

function memoryDb(initial) {
  let row = structuredClone(initial);
  const matches = filters => row && Object.entries(filters).every(([key, value]) => row[key] === value);
  return {
    get row() { return structuredClone(row); },
    from(table) {
      assert.equal(table, 'platform_connections');
      const query = {
        op: 'idle',
        filters: {},
        patch: null,
        update(value) { this.op = 'update'; this.patch = value; return this; },
        select() { if (this.op === 'idle') this.op = 'select'; return this; },
        eq(key, value) { this.filters[key] = value; return this; },
        async maybeSingle() {
          return { data: matches(this.filters) ? structuredClone(row) : null, error: null };
        },
        then(resolve, reject) {
          try {
            let result;
            if (this.op === 'update') {
              if (matches(this.filters)) {
                row = { ...row, ...this.patch };
                result = { data: [{ user_id: row.user_id }], error: null };
              } else {
                result = { data: [], error: null };
              }
            } else {
              result = { data: matches(this.filters) ? structuredClone(row) : null, error: null };
            }
            return Promise.resolve(result).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      };
      return query;
    },
  };
}

const connection = () => ({
  user_id: 'user-1',
  provider: 'immomio',
  status: 'connected',
  updated_at: '2026-10-22T10:00:00.000Z',
  last_refresh_error: null,
  credential_ciphertext: 'cipher',
  credential_iv: 'iv',
});

test('OAuth refresh errors distinguish revoked user tokens from configuration failures', () => {
  const revoked = classifyOAuthRefreshFailure(400, { error: 'invalid_grant', error_description: 'do not persist this text' });
  assert.equal(revoked.requiresLogin, true);
  assert.equal(revoked.diagnostic, 'refresh_http_400:invalid_grant');
  assert.equal(revoked.diagnostic.includes('do not persist'), false);

  const configuration = classifyOAuthRefreshFailure(401, { error: 'invalid_client' });
  assert.equal(configuration.configuration, true);
  assert.equal(configuration.requiresLogin, false);
  assert.equal(configuration.diagnostic, 'refresh_config_error:invalid_client');

  assert.equal(classifyOAuthRefreshFailure(429, {}).transient, true);
  assert.equal(classifyOAuthRefreshFailure(503, {}).transient, true);
});

test('refresh lease markers are parsed without treating stale leases as active', () => {
  const token = '12345678-1234-4234-8234-123456789abc';
  const active = parsePlatformRefreshLease(`refresh_in_progress:${Date.now() + 10000}:${token}`);
  assert.equal(active?.active, true);
  assert.equal(active?.token, token);

  const stale = parsePlatformRefreshLease(`refresh_in_progress:${Date.now() - 10000}:${token}`);
  assert.equal(stale?.active, false);
  assert.equal(parsePlatformRefreshLease('refresh_http_400:invalid_grant'), null);
});

test('a refresh lease is acquired with compare-and-swap and released only by its owner', async () => {
  const db = memoryDb(connection());
  const lease = await claimPlatformRefresh(db, 'user-1', 'immomio', db.row.updated_at, { waitMs: 0 });
  assert.match(db.row.last_refresh_error, /^refresh_in_progress:/);
  assert.equal(lease.marker, db.row.last_refresh_error);
  assert.equal(lease.changedSinceObservation, false);

  await assert.rejects(
    claimPlatformRefresh(db, 'user-1', 'immomio', db.row.updated_at, { waitMs: 0 }),
    /temporary_network_error/,
  );

  await releasePlatformRefresh(db, 'user-1', 'immomio', { marker: 'refresh_in_progress:1:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  assert.equal(db.row.last_refresh_error, lease.marker);

  await releasePlatformRefresh(db, 'user-1', 'immomio', lease);
  assert.equal(db.row.last_refresh_error, null);
});

test('expired refresh leases can be reclaimed', async () => {
  const row = connection();
  row.last_refresh_error = `refresh_in_progress:${Date.now() - 1000}:12345678-1234-4234-8234-123456789abc`;
  const db = memoryDb(row);
  const lease = await claimPlatformRefresh(db, 'user-1', 'immomio', row.updated_at, { waitMs: 0 });
  assert.equal(db.row.last_refresh_error, lease.marker);
  assert.notEqual(db.row.last_refresh_error, row.last_refresh_error);
  await releasePlatformRefresh(db, 'user-1', 'immomio', lease);
});

test('Immomio sources without a configured tenant fallback rediscover from their official pages', () => {
  const primary = {
    priority: 1,
    label: 'Immomio Tenant GraphQL',
    connector_kind: 'immomio_tenant',
    enabled: true,
    shadow_only: false,
    config: { url: 'https://homepage.immomio.com/?token=old-token' },
  };
  const source = {
    homepage_url: 'https://www.bgfg.de',
    search_url: 'https://www.bgfg.de/zuhause-finden/aktuelle-angebote',
  };
  const fallbacks = buildImmomioHomepageFallbacks(primary, [], source);
  assert.equal(fallbacks.length, 2);
  assert.equal(fallbacks[0].config.url, source.search_url);
  assert.equal(fallbacks[1].config.url, new URL(source.homepage_url).href);
  assert.ok(fallbacks.every(item => item.connector_kind === 'immomio_tenant' && item.enabled && !item.shadow_only));
});

test('configured Immomio tenant fallbacks remain authoritative and cross-host URLs are rejected', () => {
  const primary = { priority: 1, connector_kind: 'immomio_tenant', config: { url: 'https://homepage.immomio.com/?token=old' } };
  const configured = { priority: 2, connector_kind: 'immomio_tenant', enabled: true, shadow_only: false, config: { url: 'https://www.vhw-hamburg.de/wohnungen/' } };
  const result = buildImmomioHomepageFallbacks(primary, [configured], {
    homepage_url: 'https://www.vhw-hamburg.de',
    search_url: 'https://different.example/listings',
  });
  assert.deepEqual(result, [configured]);
  const discovered = buildImmomioHomepageFallbacks(primary, [], {
    homepage_url: 'https://www.vhw-hamburg.de',
    search_url: 'https://different.example/listings',
  });
  assert.deepEqual(discovered.map(item => item.config.url), ['https://www.vhw-hamburg.de/']);
});
