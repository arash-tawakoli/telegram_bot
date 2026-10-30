import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import {
  compareLiveRuntime,
  jobFromWebhook,
  verifyGitHubWebhook,
  workflowIdFromDelivery
} from "../src/shared.mjs";

const sha = "a".repeat(40);
const delivery = "7b2f1d4c-9f6e-4e4a-8f2e-9b7d9a3f0c11";

test("GitHub HMAC-SHA256 webhook signatures are verified", async () => {
  const body = JSON.stringify({ hello: "world" });
  const secret = "test-secret";
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(await verifyGitHubWebhook(body, signature, secret, webcrypto), true);
  assert.equal(await verifyGitHubWebhook(body, signature, "wrong-secret", webcrypto), false);
  assert.equal(await verifyGitHubWebhook(body, "sha1=bad", secret, webcrypto), false);
});

test("main branch pushes are accepted only for allowlisted repositories", () => {
  const job = jobFromWebhook("push", {
    ref: "refs/heads/main",
    after: sha,
    repository: { full_name: "arash-tawakoli/telegram_bot" }
  }, delivery, "https://ci.example/runs/gh-test");

  assert.equal(job.repository, "arash-tawakoli/telegram_bot");
  assert.equal(job.sha, sha);
  assert.equal(job.eventName, "push");

  assert.equal(jobFromWebhook("push", {
    ref: "refs/heads/feature",
    after: sha,
    repository: { full_name: "arash-tawakoli/telegram_bot" }
  }, delivery, "https://ci.example/runs/gh-test"), null);

  assert.equal(jobFromWebhook("push", {
    ref: "refs/heads/main",
    after: sha,
    repository: { full_name: "someone/other-repo" }
  }, delivery, "https://ci.example/runs/gh-test"), null);
});

test("same-repository pull requests are accepted and fork pull requests are rejected", () => {
  const base = {
    action: "synchronize",
    repository: { full_name: "arash-tawakoli/website_traumwohnung" },
    pull_request: {
      number: 42,
      head: { sha, ref: "feature", repo: { full_name: "arash-tawakoli/website_traumwohnung" } },
      base: { repo: { full_name: "arash-tawakoli/website_traumwohnung" } }
    }
  };

  const job = jobFromWebhook("pull_request", base, delivery, "https://ci.example/runs/gh-test");
  assert.equal(job.pullRequestNumber, 42);
  assert.equal(job.sha, sha);

  const fork = structuredClone(base);
  fork.pull_request.head.repo.full_name = "contributor/website_traumwohnung";
  assert.equal(jobFromWebhook("pull_request", fork, delivery, "https://ci.example/runs/gh-test"), null);
});

test("workflow IDs reject malformed delivery identifiers", () => {
  assert.equal(workflowIdFromDelivery(delivery), `gh-${delivery}`);
  assert.throws(() => workflowIdFromDelivery("../invalid"), /Invalid GitHub delivery/);
});

test("live Supabase inventory comparison detects missing and mismatched functions", () => {
  const manifest = {
    functions: [{ slug: "source-worker", version: 12, verify_jwt: false }],
    archived_functions: [{ slug: "old-worker", version: 3, verify_jwt: true }]
  };

  assert.deepEqual(
    compareLiveRuntime([
      { slug: "source-worker", version: 12, verify_jwt: false },
      { slug: "old-worker", version: 3, verify_jwt: true }
    ], manifest),
    { expected: 2, actual: 2, matched: 2 }
  );

  assert.throws(() => compareLiveRuntime([
    { slug: "source-worker", version: 13, verify_jwt: false }
  ], manifest), /Live Supabase runtime drift/);
});
