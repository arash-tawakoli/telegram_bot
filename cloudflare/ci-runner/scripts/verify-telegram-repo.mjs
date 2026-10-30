import { access, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();

const requiredFiles = [
  "docs/ARCHITECTURE.md",
  "docs/source-connectors.md",
  "supabase/seed.sql",
  "supabase/functions/source-worker/index.ts",
  "supabase/functions/source-worker/deno.json",
  "supabase/functions/source-worker/shared.ts",
  "supabase/functions/source-worker/scout.ts",
  "supabase/functions/source-worker/klein.ts",
  "supabase/functions/source-worker/immomio.ts",
  "supabase/functions/source-worker/hpm.ts",
  "supabase/functions/source-worker/generic.ts",
  "supabase/functions/kleinanzeigen-transport/index.ts",
  "supabase/functions/notification-dispatcher/index.ts",
  "supabase/functions/telegram-ui/index.ts",
  "supabase/functions/telegram-gateway/index.ts"
];

const forbiddenPaths = [
  "supabase/functions/mini-app",
  "supabase/static/mini-app",
  ".github/workflows/kleinanzeigen-public-inventory.yml",
  "scripts/kleinanzeigen-public-inventory.mjs",
  "data/source_catalog.json"
];

for (const path of requiredFiles) {
  try {
    await access(join(root, path));
  } catch {
    throw new Error("Required architecture file missing: " + path);
  }
}

for (const path of forbiddenPaths) {
  try {
    await access(join(root, path));
    throw new Error("Forbidden legacy path exists: " + path);
  } catch (error) {
    if (error?.message?.startsWith("Forbidden legacy path")) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
}

const seed = await readFile(join(root, "supabase/seed.sql"), "utf8");
for (const marker of [
  "Architecture-v3 bootstrap registry",
  "runtime_mode",
  "source-worker",
  "adaptive_partition",
  "district_hybrid",
  "district_pagination",
  "immomio_tenant",
  "immosolve_api"
]) {
  if (!seed.includes(marker)) throw new Error("Required source seed marker missing: " + marker);
}
if (seed.includes("immomio_graphql")) {
  throw new Error("Legacy Immomio connector kind remains in supabase/seed.sql");
}

const legacyPattern = /(source-job-runner|source-worker-v3|source-immoscout-fast|source-immoscout-rolling|source-kleinanzeigen-fast|source-kleinanzeigen-rolling|listing_enrichment)/;
const miniAppPattern = /(MINI_APP_URL|functions\/v1\/mini-app|traumwohnung-mini-app\.vercel\.app)/;
const ignoredDirectories = new Set([".git", "node_modules", "migrations", ".astro", "dist"]);

async function walk(directory, callback) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await walk(join(directory, entry.name), callback);
    } else if (entry.isFile() && !entry.name.endsWith(".md")) {
      await callback(join(directory, entry.name));
    }
  }
}

const legacyRoots = ["supabase/functions", ".github", "scripts"];
for (const path of legacyRoots) {
  await walk(join(root, path), async (file) => {
    if (relative(root, file) === ".github/workflows/architecture-check.yml") return;
    const text = await readFile(file, "utf8");
    if (legacyPattern.test(text)) {
      throw new Error("Legacy runtime reference found: " + relative(root, file));
    }
  });
}

const miniAppFiles = [
  "supabase/functions/telegram-ui",
  "supabase/functions/telegram-gateway",
  "supabase/config.toml",
  "docs/product-releases-2026-09-01.md"
];
for (const path of miniAppFiles) {
  try {
    const fullPath = join(root, path);
    const info = await import("node:fs/promises").then(({ stat }) => stat(fullPath));
    if (info.isDirectory()) {
      await walk(fullPath, async (file) => {
        const text = await readFile(file, "utf8");
        if (miniAppPattern.test(text)) throw new Error("Mini App runtime reference found: " + relative(root, file));
      });
    } else {
      const text = await readFile(fullPath, "utf8");
      if (miniAppPattern.test(text)) throw new Error("Mini App runtime reference found: " + path);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

console.log("Telegram Bot architecture invariants passed.");
