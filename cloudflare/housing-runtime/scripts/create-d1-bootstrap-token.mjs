import { randomBytes, createHash } from "node:crypto";
import { writeFile, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const output = process.env.BOOTSTRAP_TOKEN_FILE || "/tmp/traumwohnung-d1-bootstrap-token.txt";
const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("base64url");
const sql = `INSERT INTO bootstrap_tokens (id, token_hash, expires_at) VALUES (lower(hex(randomblob(16))), '${hash}', datetime('now','+30 minutes'));`;
execFileSync("npx", ["wrangler", "d1", "execute", "traumwohnung-housing-core", "--remote", "--command", sql], { stdio: "ignore" });
await writeFile(output, token + "\n", { mode: 0o600 });
await chmod(output, 0o600);
console.log(JSON.stringify({ ok: true, token_file: output, expires_in_minutes: 30 }));
