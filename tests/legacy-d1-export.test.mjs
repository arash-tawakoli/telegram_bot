import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(
  new URL("../cloudflare/immoscout-central-token-staging/index.js", import.meta.url),
  "utf8",
);

test("legacy migration export is authenticated before reading D1", () => {
  const internalStart = worker.indexOf("async function internal(request, env, path)");
  const authStart = worker.indexOf("if (!await authorize(request, env))", internalStart);
  const exportStart = worker.indexOf('if (request.method === "GET" && path === "/internal/export")', internalStart);
  const statusStart = worker.indexOf('if (path === "/internal/status"', exportStart);
  assert.ok(internalStart >= 0 && authStart > internalStart && exportStart > authStart && statusStart > exportStart);
  assert.match(worker.slice(internalStart, exportStart), /authorize\(request, env\)/);
});

test("legacy migration export contains ciphertext only and fingerprints the encryption key", () => {
  const start = worker.indexOf('if (request.method === "GET" && path === "/internal/export")');
  const end = worker.indexOf('if (path === "/internal/status"', start);
  const route = worker.slice(start, end);
  assert.match(route, /ciphertext/);
  assert.match(route, /verifier_ciphertext/);
  assert.match(route, /key_fingerprint/);
  assert.match(route, /digest\(env\.TOKEN_ENCRYPTION_KEY\)/);
  assert.doesNotMatch(route, /access_token|refresh_token|decrypt\(/);
  assert.match(route, /oauth_flows/);
  assert.match(route, /audit_events/);
});
