export const ALLOWED_REPOSITORIES = new Set([
  "arash-tawakoli/telegram_bot",
  "arash-tawakoli/website_traumwohnung"
]);

const SUPPORTED_PULL_REQUEST_ACTIONS = new Set([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review"
]);

export async function verifyGitHubWebhook(rawBody, signature, secret, cryptoImpl = globalThis.crypto) {
  if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;

  const key = await cryptoImpl.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const bytes = Uint8Array.from(
    signature.slice("sha256=".length).match(/.{2}/g) ?? [],
    (value) => Number.parseInt(value, 16)
  );

  return cryptoImpl.subtle.verify(
    "HMAC",
    key,
    bytes,
    new TextEncoder().encode(rawBody)
  );
}

export function workflowIdFromDelivery(deliveryId) {
  if (typeof deliveryId !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(deliveryId)) {
    throw new Error("Invalid GitHub delivery identifier");
  }
  return `gh-${deliveryId}`;
}

export function jobFromWebhook(eventName, payload, deliveryId, targetUrl) {
  const workflowId = workflowIdFromDelivery(deliveryId);

  if (eventName === "push") {
    const repository = payload?.repository?.full_name;
    if (!ALLOWED_REPOSITORIES.has(repository)) return null;
    if (payload?.ref !== "refs/heads/main") return null;

    const sha = payload?.after;
    if (!/^[0-9a-f]{40}$/i.test(sha ?? "") || /^0{40}$/i.test(sha)) return null;

    return {
      workflowId,
      deliveryId,
      eventName,
      repository,
      sha,
      ref: payload.ref,
      targetUrl
    };
  }

  if (eventName !== "pull_request") return null;
  if (!SUPPORTED_PULL_REQUEST_ACTIONS.has(payload?.action)) return null;

  const repository = payload?.repository?.full_name;
  const baseRepository = payload?.pull_request?.base?.repo?.full_name;
  const headRepository = payload?.pull_request?.head?.repo?.full_name;

  if (!ALLOWED_REPOSITORIES.has(repository)) return null;
  if (baseRepository !== repository || headRepository !== repository) return null;

  const sha = payload?.pull_request?.head?.sha;
  if (!/^[0-9a-f]{40}$/i.test(sha ?? "")) return null;

  return {
    workflowId,
    deliveryId,
    eventName,
    action: payload.action,
    repository,
    sha,
    ref: payload.pull_request.head.ref,
    pullRequestNumber: Number(payload.pull_request.number),
    targetUrl
  };
}

export function compareLiveRuntime(liveFunctions, manifest) {
  const expected = new Map();

  for (const fn of manifest?.functions ?? []) {
    expected.set(fn.slug, {
      version: Number(fn.observed_live_version ?? fn.version),
      verify_jwt: Boolean(fn.observed_live_verify_jwt ?? fn.verify_jwt)
    });
  }

  for (const fn of manifest?.archived_functions ?? []) {
    if (expected.has(fn.slug)) throw new Error(`Duplicate runtime manifest function: ${fn.slug}`);
    expected.set(fn.slug, {
      version: Number(fn.version),
      verify_jwt: Boolean(fn.verify_jwt)
    });
  }

  const actual = new Map((liveFunctions ?? []).map((fn) => [
    fn.slug ?? fn.name,
    { version: Number(fn.version), verify_jwt: Boolean(fn.verify_jwt) }
  ]));

  const missing = [...expected.keys()].filter((slug) => !actual.has(slug));
  const extra = [...actual.keys()].filter((slug) => !expected.has(slug));
  const mismatched = [];

  for (const [slug, expectedValue] of expected) {
    const actualValue = actual.get(slug);
    if (
      actualValue &&
      (actualValue.version !== expectedValue.version ||
        actualValue.verify_jwt !== expectedValue.verify_jwt)
    ) {
      mismatched.push(slug);
    }
  }

  if (missing.length || extra.length || mismatched.length) {
    throw new Error(
      `Live Supabase runtime drift: missing=${missing.join(",")} extra=${extra.join(",")} mismatched=${mismatched.join(",")}`
    );
  }

  return { expected: expected.size, actual: actual.size, matched: actual.size };
}
