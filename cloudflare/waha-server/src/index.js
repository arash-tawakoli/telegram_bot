import { DurableObject } from "cloudflare:workers";

// Preview-only until resource usage, snapshot recovery and pairing are verified.
// Enabling the minute cron keeps one browser-free WAHA session active and billable.
const INSTANCE = { vcpu: 0.125, memoryMib: 512, diskMb: 2000 };
const SESSION = "default";
const PORT = 3000;

function enabled(env) {
  return env.WAHA_ENABLED === "1" && Boolean(env.WAHA_API_KEY)
    && Boolean(env.WAHA_WEBHOOK_HMAC_KEY);
}
function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export class WahaHost extends DurableObject {
  starting;

  async ensureReady() {
    const container = this.ctx.container;
    if (!container.running) {
      const snapshot = await this.ctx.storage.get("waha_snapshot");
      container.start({
        ...(snapshot ? { containerSnapshot: snapshot } : { image: container.images.base }),
        instance: INSTANCE,
        enableInternet: true,
        env: {
          WAHA_API_KEY: this.env.WAHA_API_KEY,
          WAHA_DASHBOARD_ENABLED: "false",
          WHATSAPP_DEFAULT_ENGINE: "GOWS",
          WHATSAPP_START_SESSION: SESSION,
          WHATSAPP_HOOK_URL: "https://intern.traumwohnunghamburg.de/edge/whatsapp/webhook",
          WHATSAPP_HOOK_EVENTS: "message",
          WHATSAPP_HOOK_HMAC_KEY: this.env.WAHA_WEBHOOK_HMAC_KEY,
          WAHA_PRINT_QR: "False",
          WAHA_LOG_LEVEL: "warn"
        }
      });
    }
    await container.setInactivityTimeout(2 * 60 * 1000);
    const port = container.getTcpPort(PORT);
    for (let n = 0; n < 40; n++) {
      try {
        const response = await port.fetch("http://container/api/server/version", {
          headers: { "x-api-key": this.env.WAHA_API_KEY },
          signal: AbortSignal.timeout(1500)
        });
        await response.body?.cancel();
        if (response.ok) return;
      } catch { /* Container may still be starting. */ }
      await scheduler.wait(250);
    }
    throw new Error("waha_not_ready");
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.starting ??= this.ensureReady().finally(() => { this.starting = undefined; });
    await this.starting;

    if (url.pathname === "/internal/tick") {
      return json({ ok: true, running: this.ctx.container.running });
    }
    if (url.pathname === "/internal/snapshot") {
      // Snapshot beta: save the session filesystem (not process memory).
      const handle = await this.ctx.container.snapshotContainer({ name: "waha-session" });
      await this.ctx.storage.put("waha_snapshot", handle);
      return json({ ok: true, saved: true });
    }

    const forwarded = new Request("http://container" + url.pathname + url.search, request);
    forwarded.headers.delete("host");
    return this.ctx.container.getTcpPort(PORT).fetch(forwarded);
  }
}

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/health") return json({ ok: true, enabled: env.WAHA_ENABLED === "1" });
    if (!enabled(env)) return json({ error: "waha_disabled" }, 503);
    // Never expose the dashboard, Swagger or arbitrary WAHA endpoints.
    if (!path.startsWith("/api/")) return json({ error: "not_found" }, 404);
    if (request.headers.get("x-api-key") !== env.WAHA_API_KEY)
      return json({ error: "unauthorized" }, 401);
    return env.WAHA.getByName("sender").fetch(request);
  },
  async scheduled(controller, env, ctx) {
    if (!enabled(env)) return;
    ctx.waitUntil((async () => {
      const instance = env.WAHA.getByName("sender");
      const minute = Math.floor((controller.scheduledTime || Date.now()) / 60000);
      const path = minute % 15 === 0 ? "/internal/snapshot" : "/internal/tick";
      const response = await instance.fetch("https://internal" + path);
      if (!response.ok) throw new Error("waha_container_unavailable");
    })());
  }
};
