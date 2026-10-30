import { DurableObject, WorkflowEntrypoint } from "cloudflare:workers";
import {
  ALLOWED_REPOSITORIES,
  compareLiveRuntime,
  jobFromWebhook,
  verifyGitHubWebhook,
  workflowIdFromDelivery
} from "./shared.mjs";
import {
  createCommitStatus,
  fetchGitHubArchive,
  getGitHubInstallationToken
} from "./github.mjs";

const TELEGRAM_REPOSITORY = "arash-tawakoli/telegram_bot";

export class CIContainer extends DurableObject {
  starting;

  async fetch(request) {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container.getTcpPort(8080).fetch(forwarded);
  }

  async startAndWaitForPort() {
    const container = this.ctx.container;
    if (!container) throw new Error("CI Container binding is unavailable");

    if (!container.running) {
      await container.start({
        image: container.images.base,
        instance: "standard-2",
        enableInternet: true
      });
    }

    await container.setInactivityTimeout(30_000);
    const port = container.getTcpPort(8080);
    let lastError;

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1000)
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error("Container health check returned " + response.status);
        return;
      } catch (error) {
        lastError = error;
        await scheduler.wait(200);
      }
    }

    throw new Error("CI Container did not become ready on port 8080", { cause: lastError });
  }
}

export class CIRunWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const job = event.payload;
    let result;

    try {
      result = await step.do(
        "run-isolated-repository-checks",
        {
          timeout: "30 minutes",
          retries: { limit: 2, delay: "15 seconds", backoff: "exponential" }
        },
        async () => {
          const token = await getGitHubInstallationToken(this.env);
          const archive = await fetchGitHubArchive(token, job);
          const container = this.env.CI_CONTAINER.getByName(`ci-${job.workflowId}`);

          const response = await container.fetch(new Request("http://container/run", {
            method: "POST",
            headers: {
              "Content-Type": "application/gzip",
              "X-CI-Repository": job.repository,
              "X-CI-SHA": job.sha,
              "X-CI-Event": job.eventName,
              "X-CI-Delivery": job.deliveryId
            },
            body: archive.body
          }));

          if (!response.ok) {
            throw new Error(`Cloudflare CI container returned HTTP ${response.status}`);
          }

          return response.json();
        }
      );

      if (!result?.ok) {
        throw new Error(result?.summary || "Repository checks failed");
      }

      if (
        job.repository === TELEGRAM_REPOSITORY &&
        this.env.SUPABASE_ACCESS_TOKEN &&
        result.runtimeManifest
      ) {
        await step.do(
          "compare-live-supabase-runtime",
          {
            timeout: "2 minutes",
            retries: { limit: 1, delay: "10 seconds", backoff: "exponential" }
          },
          async () => {
            const project = result.runtimeManifest.project_id || "dpmohkrwdlicexwcrqfy";
            const response = await fetch(
              `https://api.supabase.com/v1/projects/${encodeURIComponent(project)}/functions`,
              {
                headers: {
                  Authorization: `Bearer ${this.env.SUPABASE_ACCESS_TOKEN}`,
                  Accept: "application/json"
                }
              }
            );

            if (!response.ok) {
              throw new Error(`Supabase Management API returned HTTP ${response.status}`);
            }

            const body = await response.json();
            const liveFunctions = Array.isArray(body)
              ? body
              : Array.isArray(body.functions)
                ? body.functions
                : null;

            if (!liveFunctions) throw new Error("Unexpected Supabase functions inventory response");
            return compareLiveRuntime(liveFunctions, result.runtimeManifest);
          }
        );
      }

      await step.do("publish-success-status", async () => {
        const token = await getGitHubInstallationToken(this.env);
        await createCommitStatus(token, job, "success", "Cloudflare CI checks passed");
        return true;
      });

      return {
        ok: true,
        repository: job.repository,
        sha: job.sha,
        summary: result.summary,
        steps: result.steps
      };
    } catch (error) {
      const message = String(error?.message || error || "Unknown CI failure").slice(0, 140);

      await step.do(
        "publish-failure-status",
        {
          timeout: "2 minutes",
          retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }
        },
        async () => {
          const token = await getGitHubInstallationToken(this.env);
          await createCommitStatus(token, job, "failure", message);
          return true;
        }
      ).catch(() => null);

      throw error;
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "nexalabs-cloudflare-ci",
        repositories: [...ALLOWED_REPOSITORIES],
        executor: "cloudflare-containers",
        paidPlanRequiredForExecution: true
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/runs/")) {
      const id = url.pathname.slice("/runs/".length);
      if (!/^[A-Za-z0-9-]{1,90}$/.test(id)) {
        return new Response("Invalid workflow ID", { status: 400 });
      }

      try {
        const instance = await env.CI_WORKFLOW.get(id);
        const status = await instance.status();
        return Response.json({
          id,
          status: status.status ?? "unknown",
          createdAt: status.createdAt ?? null,
          endedAt: status.endedAt ?? null
        });
      } catch {
        return new Response("Workflow not found", { status: 404 });
      }
    }

    if (request.method !== "POST" || url.pathname !== "/github/webhook") {
      return new Response("Not found", { status: 404 });
    }

    if (
      !env.GITHUB_APP_ID ||
      !env.GITHUB_APP_PRIVATE_KEY ||
      !env.GITHUB_INSTALLATION_ID ||
      !env.GITHUB_WEBHOOK_SECRET
    ) {
      return Response.json({ error: "GitHub App secrets are not configured" }, { status: 503 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get("X-Hub-Signature-256");

    if (!(await verifyGitHubWebhook(rawBody, signature, env.GITHUB_WEBHOOK_SECRET))) {
      return new Response("Invalid webhook signature", { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    const deliveryId = request.headers.get("X-GitHub-Delivery");
    const eventName = request.headers.get("X-GitHub-Event");
    let workflowId;

    try {
      workflowId = workflowIdFromDelivery(deliveryId);
    } catch {
      return new Response("Invalid GitHub delivery ID", { status: 400 });
    }

    const targetUrl = new URL(`/runs/${workflowId}`, request.url).toString();
    const job = jobFromWebhook(eventName, payload, deliveryId, targetUrl);

    if (!job) {
      return Response.json({ accepted: true, ignored: true }, { status: 202 });
    }

    try {
      const token = await getGitHubInstallationToken(env);
      await createCommitStatus(token, job, "pending", "Cloudflare CI queued");

      const instance = await env.CI_WORKFLOW.create({
        id: workflowId,
        params: job
      });

      return Response.json({
        accepted: true,
        workflowId: instance.id,
        repository: job.repository,
        sha: job.sha
      }, { status: 202 });
    } catch (error) {
      try {
        const existing = await env.CI_WORKFLOW.get(workflowId);
        const status = await existing.status();
        if (status) {
          return Response.json({ accepted: true, duplicate: true, workflowId }, { status: 202 });
        }
      } catch {
        // The instance does not exist; report the original failure below.
      }

      return Response.json({
        accepted: false,
        error: String(error?.message || error).slice(0, 200)
      }, { status: 502 });
    }
  }
};
