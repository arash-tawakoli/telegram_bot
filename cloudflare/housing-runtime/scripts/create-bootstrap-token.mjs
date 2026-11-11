import { randomBytes, createHash } from "node:crypto";
import postgres from "postgres";

const targetUrl = process.env.TARGET_DATABASE_URL;
const output = process.env.BOOTSTRAP_TOKEN_FILE || "bootstrap-token.txt";
if (!targetUrl) throw new Error("TARGET_DATABASE_URL is required");

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("base64url");
const sql = postgres(targetUrl, { max: 1, prepare: true });
try {
  await sql`
    INSERT INTO housing.bootstrap_tokens (id, token_hash, expires_at)
    VALUES (gen_random_uuid(), ${hash}, now() + interval '30 minutes')
  `;
} finally {
  await sql.end({ timeout: 5 });
}

const { writeFile, chmod } = await import("node:fs/promises");
await writeFile(output, token + "\n", { mode: 0o600 });
await chmod(output, 0o600);
console.log(JSON.stringify({ ok: true, token_file: output, expires_in_minutes: 30 }));
