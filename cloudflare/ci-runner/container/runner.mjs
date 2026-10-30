import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const TELEGRAM_REPOSITORY = "arash-tawakoli/telegram_bot";
const WEBSITE_REPOSITORY = "arash-tawakoli/website_traumwohnung";
const MAX_LOG_CHARS = 120000;
const COMMAND_TIMEOUT_MS = 24 * 60 * 1000;

export function planForRepository(repository, workspace) {
  const at = (...parts) => join(workspace, ...parts);

  if (repository === TELEGRAM_REPOSITORY) {
    return [
      {
        name: "Install locked Node.js dependencies",
        command: "npm",
        args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd: workspace
      },
      {
        name: "Run architecture and regression tests",
        command: "npm",
        args: ["test"],
        cwd: workspace
      },
      {
        name: "Validate runtime manifest and migration registry",
        command: "node",
        args: ["scripts/check-runtime.mjs"],
        cwd: workspace,
        env: { RUNTIME_HASH_STRICT: "1" }
      },
      {
        name: "Test Cloudflare CI runner contracts",
        command: "node",
        args: [
          "--test",
          "cloudflare/ci-runner/test/shared.test.mjs",
          "cloudflare/ci-runner/test/runner.test.mjs"
        ],
        cwd: workspace
      },
      {
        name: "Validate repository architecture invariants",
        command: "node",
        args: ["cloudflare/ci-runner/scripts/verify-telegram-repo.mjs"],
        cwd: workspace
      }
    ];
  }

  if (repository === WEBSITE_REPOSITORY) {
    return [
      {
        name: "Coach Portal build, UI tests and release verification",
        command: "node",
        args: ["scripts/cloudflare-build.mjs"],
        cwd: at("coach-portal")
      },
      {
        name: "Generate Platform Connect lockfile",
        command: "npm",
        args: ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd: at("cloudflare", "platform-connect")
      },
      {
        name: "Install Platform Connect dependencies",
        command: "npm",
        args: ["ci", "--no-audit", "--no-fund"],
        cwd: at("cloudflare", "platform-connect")
      },
      {
        name: "Check Platform Connect syntax",
        command: "node",
        args: ["--check", "src/index.js"],
        cwd: at("cloudflare", "platform-connect")
      },
      {
        name: "Test Platform Connect",
        command: "node",
        args: ["--test", "test.mjs"],
        cwd: at("cloudflare", "platform-connect")
      },
      {
        name: "Check Coach Portal Bridge syntax",
        command: "node",
        args: ["--check", "worker.js"],
        cwd: at("cloudflare", "coach-portal-bridge")
      },
      {
        name: "Test Coach Portal Bridge",
        command: "node",
        args: ["--test", "test.mjs"],
        cwd: at("cloudflare", "coach-portal-bridge")
      },
      {
        name: "Install public website dependencies",
        command: "npm",
        args: ["ci", "--no-audit", "--no-fund"],
        cwd: at("independent")
      },
      {
        name: "Build and verify public website release",
        command: "npm",
        args: ["run", "verify:release"],
        cwd: at("independent")
      }
    ];
  }

  throw new Error("Repository is not allowlisted for Cloudflare CI");
}

async function execute(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });

    const append = (chunk) => {
      if (output.length < MAX_LOG_CHARS) {
        output += chunk.toString().slice(0, MAX_LOG_CHARS - output.length);
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }, 5000).unref();
    }, COMMAND_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, output: String(error), timedOut: false });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        output,
        timedOut
      });
    });
  });
}

async function readRuntimeManifest(workspace) {
  try {
    const manifest = JSON.parse(await readFile(join(workspace, "supabase/runtime-manifest.json"), "utf8"));
    return {
      project_id: manifest.project_id ?? null,
      functions: (manifest.functions ?? []).map((fn) => ({
        slug: fn.slug,
        version: Number(fn.observed_live_version ?? fn.version),
        verify_jwt: Boolean(fn.observed_live_verify_jwt ?? fn.verify_jwt)
      })),
      archived_functions: (manifest.archived_functions ?? []).map((fn) => ({
        slug: fn.slug,
        version: Number(fn.version),
        verify_jwt: Boolean(fn.verify_jwt)
      }))
    };
  } catch {
    return null;
  }
}

async function scanForCommittedSecrets(root) {
  const pattern = /(sk-proj-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|[0-9]{8,12}:[A-Za-z0-9_-]{30,})/;
  const ignoredDirectories = new Set([".git", "node_modules", ".astro", "dist", "coverage"]);
  const ignoredExtensions = new Set([
    ".md", ".lock", ".png", ".jpg", ".jpeg", ".webp", ".pdf", ".wasm", ".map", ".zip", ".gz"
  ]);
  const findings = [];
  let scanned = 0;

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await walk(join(directory, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;
      const extension = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "";
      if (ignoredExtensions.has(extension)) continue;
      const path = join(directory, entry.name);
      const content = await readFile(path);
      if (content.length > 1024 * 1024) continue;
      scanned++;
      if (pattern.test(content.toString("utf8"))) findings.push(relative(root, path));
    }
  }

  await walk(root);
  return { scanned, findings };
}

export async function runRepositoryChecks(repository, workspace) {
  const plan = planForRepository(repository, workspace);
  const steps = [];
  let logs = "";

  for (const item of plan) {
    const result = await execute(item.command, item.args, item.cwd, item.env);
    const step = {
      name: item.name,
      exitCode: result.exitCode,
      timedOut: result.timedOut
    };
    steps.push(step);
    logs += `\n$ ${item.command} ${item.args.join(" ")}\n${result.output}\n`;

    if (result.exitCode !== 0) {
      return {
        ok: false,
        summary: `${item.name} failed (exit ${result.exitCode})`,
        steps,
        logs: logs.slice(-MAX_LOG_CHARS),
        runtimeManifest: await readRuntimeManifest(workspace)
      };
    }
  }

  const secretScan = await scanForCommittedSecrets(workspace);
  if (secretScan.findings.length) {
    return {
      ok: false,
      summary: `Potential committed secret detected in ${secretScan.findings.length} file(s)`,
      steps,
      logs: logs.slice(-MAX_LOG_CHARS),
      secretFindings: secretScan.findings.slice(0, 20),
      runtimeManifest: await readRuntimeManifest(workspace)
    };
  }

  steps.push({
    name: "Scan committed source for high-confidence secret patterns",
    exitCode: 0,
    filesScanned: secretScan.scanned
  });

  return {
    ok: true,
    summary: `${repository}: ${steps.length} CI steps passed`,
    steps,
    logs: logs.slice(-MAX_LOG_CHARS),
    runtimeManifest: await readRuntimeManifest(workspace)
  };
}
