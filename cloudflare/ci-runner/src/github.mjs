const encoder = new TextEncoder();

function base64Url(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\\+/g, "-").replace(/\\//g, "_");
}

function privateKeyBytes(pem) {
  const body = String(pem ?? "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\s+/g, "");
  if (!body) throw new Error("GitHub App private key is missing");

  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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
