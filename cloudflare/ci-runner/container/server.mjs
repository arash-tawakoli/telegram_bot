import { createServer } from "node:http";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { runRepositoryChecks } from "./runner.mjs";

const ALLOWED_REPOSITORIES = new Set([
  "arash-tawakoli/telegram_bot",
  "arash-tawakoli/website_traumwohnung"
]);
const MAX_ARCHIVE_BYTES = Number(process.env.CI_MAX_ARCHIVE_BYTES || 314572800);
const MAX_CHUNK_BYTES = 50 * 1024 * 1024;

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function jobDirectory(jobId) {
  if (!/^[A-Za-z0-9-]{1,90}$/.test(jobId)) throw new Error("Invalid CI job ID");
  return join(tmpdir(), `nexalabs-ci-${jobId}`);
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

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error("JSON request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readChunk(request, expectedLength) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_CHUNK_BYTES) throw new Error("Archive chunk exceeds 50 MiB");
    chunks.push(chunk);
  }
  if (size !== expectedLength) {
    throw new Error(`Archive chunk length mismatch: expected=${expectedLength} actual=${size}`);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  const jobId = String(request.headers["x-ci-job-id"] || "");
  let directory = null;
  let removeAfter = false;

  try {
    if (request.method === "GET" && request.url === "/health") {
      return send(response, 200, { ok: true, service: "nexalabs-ci-container" });
    }

    if (!jobId || !/^[A-Za-z0-9-]{1,90}$/.test(jobId)) {
      return send(response, 400, { ok: false, summary: "Invalid CI job ID" });
    }
    directory = jobDirectory(jobId);
    const archivePath = join(directory, "source.tar.gz");
    const metadataPath = join(directory, "job.json");
    const workspace = join(directory, "workspace");

    if (request.method === "POST" && request.url === "/begin") {
      const metadata = await readJson(request);
      if (!ALLOWED_REPOSITORIES.has(metadata.repository)) {
        return send(response, 403, { ok: false, summary: "Repository is not allowlisted" });
      }
      if (!/^[0-9a-f]{40}$/i.test(metadata.sha || "")) {
        return send(response, 400, { ok: false, summary: "Invalid commit SHA" });
      }
      if (!["push", "pull_request"].includes(metadata.eventName)) {
        return send(response, 400, { ok: false, summary: "Unsupported GitHub event" });
      }
      if (!Number.isSafeInteger(metadata.archiveBytes) ||
          metadata.archiveBytes <= 0 ||
          metadata.archiveBytes > MAX_ARCHIVE_BYTES) {
        return send(response, 413, { ok: false, summary: "Repository archive size is outside the allowed range" });
      }

      await rm(directory, { recursive: true, force: true });
      await mkdir(workspace, { recursive: true });
      await writeFile(archivePath, Buffer.alloc(0));
      await writeFile(metadataPath, JSON.stringify(metadata));
      return send(response, 200, { ok: true, archiveBytes: metadata.archiveBytes });
    }

    if (request.method === "POST" && request.url === "/chunk") {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      const offset = Number(request.headers["x-ci-offset"]);
      const expectedLength = Number(request.headers["x-ci-chunk-length"]);
      const current = (await stat(archivePath)).size;

      if (!Number.isSafeInteger(offset) || offset !== current) {
        return send(response, 409, { ok: false, summary: "Archive chunk offset is not contiguous" });
      }
      if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0 ||
          expectedLength > MAX_CHUNK_BYTES || offset + expectedLength > metadata.archiveBytes) {
        return send(response, 400, { ok: false, summary: "Invalid archive chunk length" });
      }

      const chunk = await readChunk(request, expectedLength);
      await appendFile(archivePath, chunk);
      return send(response, 200, { ok: true, receivedBytes: current + chunk.length });
    }

    if (request.method === "POST" && request.url === "/abort") {
      await rm(directory, { recursive: true, force: true });
      return send(response, 200, { ok: true });
    }

    if (request.method === "POST" && request.url === "/finish") {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      const archiveSize = (await stat(archivePath)).size;
      if (archiveSize !== metadata.archiveBytes) {
        return send(response, 409, {
          ok: false,
          summary: `Archive incomplete: expected=${metadata.archiveBytes} actual=${archiveSize}`
        });
      }

      await extractArchive(archivePath, workspace);
      const result = await runRepositoryChecks(metadata.repository, workspace);
      removeAfter = true;
      return send(response, result.ok ? 200 : 422, {
        ...result,
        repository: metadata.repository,
        sha: metadata.sha,
        eventName: metadata.eventName,
        archiveBytes: archiveSize
      });
    }

    return send(response, 404, { ok: false, summary: "Not found" });
  } catch (error) {
    removeAfter = true;
    return send(response, 500, {
      ok: false,
      summary: String(error?.message || error).slice(0, 500)
    });
  } finally {
    if (removeAfter && directory) {
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  }
});

server.requestTimeout = 30 * 60 * 1000;
server.headersTimeout = 60 * 1000;
server.listen(8080, "0.0.0.0", () => {
  console.log("NexaLabs CI container listening on :8080");
});
