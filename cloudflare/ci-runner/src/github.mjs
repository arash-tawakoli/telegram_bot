const encoder = new TextEncoder();

function base64Url(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function concatenate(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function der(tag, content) {
  const length = content.length;
  let lengthBytes;
  if (length < 128) {
    lengthBytes = new Uint8Array([length]);
  } else {
    const bytes = [];
    let remaining = length;
    while (remaining > 0) {
      bytes.unshift(remaining & 255);
      remaining = Math.floor(remaining / 256);
    }
    lengthBytes = new Uint8Array([0x80 | bytes.length, ...bytes]);
  }
  return concatenate([new Uint8Array([tag]), lengthBytes, content]);
}

function privateKeyBytes(pem) {
  const text = String(pem ?? "").trim();
  const match = text.match(/-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/);
  if (!match) throw new Error("GitHub App private key PEM is invalid");

  const label = match[1];
  const body = match[2].replace(/\s+/g, "");
  const binary = atob(body);
  const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  if (label === "PRIVATE KEY") return decoded;
  if (label !== "RSA PRIVATE KEY") {
    throw new Error("GitHub App key must be an RSA PRIVATE KEY or PKCS8 PRIVATE KEY");
  }

  // Web Crypto imports PKCS#8. GitHub commonly downloads PKCS#1 RSA PEM keys,
  // so wrap the PKCS#1 payload in the standard PKCS#8 PrivateKeyInfo structure.
  const version = der(0x02, new Uint8Array([0]));
  const rsaEncryptionOid = new Uint8Array([
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01
  ]);
  const algorithm = der(0x30, concatenate([
    der(0x06, rsaEncryptionOid),
    der(0x05, new Uint8Array())
  ]));
  const privateKey = der(0x04, decoded);
  return der(0x30, concatenate([version, algorithm, privateKey]));
}

export async function createGitHubAppJwt(env, now = Date.now()) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GitHub App credentials are not configured");
  }

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const issuedAt = Math.floor(now / 1000) - 60;
  const payload = base64Url(JSON.stringify({
    iat: issuedAt,
    exp: issuedAt + 540,
    iss: String(env.GITHUB_APP_ID)
  }));
  const unsigned = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(unsigned)
  );

  return `${unsigned}.${base64Url(signature)}`;
}

export async function getGitHubInstallationToken(env) {
  if (!env.GITHUB_INSTALLATION_ID) throw new Error("GitHub App installation ID is missing");

  const jwt = await createGitHubAppJwt(env);
  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NexaLabs-Cloudflare-CI"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub App installation token request failed: HTTP ${response.status}`);
  }

  const body = await response.json();
  if (!body.token) throw new Error("GitHub App did not return an installation token");
  return body.token;
}

export async function createCommitStatus(token, job, state, description) {
  const [owner, repository] = job.repository.split("/");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/statuses/${encodeURIComponent(job.sha)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "NexaLabs-Cloudflare-CI"
    },
    body: JSON.stringify({
      state,
      context: "Cloudflare CI / tests",
      description: String(description).slice(0, 140),
      target_url: job.targetUrl
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub commit status update failed: HTTP ${response.status}`);
  }

  return response.json();
}

export async function fetchGitHubArchive(token, job) {
  const [owner, repository] = job.repository.split("/");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/tarball/${encodeURIComponent(job.sha)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "NexaLabs-Cloudflare-CI"
    },
    redirect: "follow"
  });

  if (!response.ok || !response.body) {
    throw new Error(`GitHub source archive download failed: HTTP ${response.status}`);
  }

  return response;
}
