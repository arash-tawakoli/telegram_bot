import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { runRepositoryChecks } from "./runner.mjs";

const ALLOWED_REPOSITORIES = new Set([
  "arash-tawakoli/telegram_bot",
  "arash-tawakoli/website_traumwohnung"
]);
const MAX_ARCHIVE_BYTES = Number(process.env.CI_MAX_ARCHIVE_BYTES || 104857600);

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function extractArchive(archivePath, workspace) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", [
      "-xzf", archivePath,
      "--strip-components=1",
      "--no-same-owner",
      "--no-same-permissions",
      "-C", workspace
    ], { stdio: ["ignore", "ignore", "pipe"] });

    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      if (errorOutput.length < 8000) errorOutput += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Source archive extraction failed: ${errorOutput.slice(-2000)}`));
    });
  });
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return send(response, 200, { ok: true, service: "nexalabs-ci-container" });
  }

  if (request.method !== "POST" || request.url !== "/run") {
    return send(response, 404, { ok: false, summary: "Not found" });
  }

  const repository = String(request.headers["x-ci-repository"] || "");
  const sha = String(request.headers["x-ci-sha"] || "");
  const eventName = String(request.headers["x-ci-event"] || "");

  if (!ALLOWED_REPOSITORIES.has(repository)) {
    return send(response, 403, { ok: false, summary: "Repository is not allowlisted" });
  }
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    return send(response, 400, { ok: false, summary: "Invalid commit SHA" });
  }
  if (!["push", "pull_request"].includes(eventName)) {
    return send(response, 400, { ok: false, summary: "Unsupported GitHub event" });
  }

  const declaredSize = Number(request.headers["content-length"] || 0);
  if (declaredSize > MAX_ARCHIVE_BYTES) {
    return send(response, 413, { ok: false, summary: "Repository archive exceeds 100 MB" });
  }

  let directory;
  try {
    directory = await mkdtemp(join(tmpdir(), "nexalabs-ci-"));
    const archivePath = join(directory, "source.tar.gz");
    const workspace = join(directory, "workspace");

    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of request) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_ARCHIVE_BYTES) {
        return send(response, 413, { ok: false, summary: "Repository archive exceeds 100 MB" });
      }
      chunks.push(chunk);
    }

    if (!totalBytes) return send(response, 400, { ok: false, summary: "Empty source archive" });

    await writeFile(archivePath, Buffer.concat(chunks));
    await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace, { recursive: true }));
    await extractArchive(archivePath, workspace);

    const result = await runRepositoryChecks(repository, workspace);
    return send(response, result.ok ? 200 : 422, {
      ...result,
      repository,
      sha,
      eventName,
      archiveBytes: totalBytes
    });
  } catch (error) {
    return send(response, 500, {
      ok: false,
      summary: String(error?.message || error).slice(0, 500)
    });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
});

server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 60 * 1000;
server.listen(8080, "0.0.0.0", () => {
  console.log("NexaLabs CI container listening on :8080");
});
