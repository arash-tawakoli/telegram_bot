const BRIDGE_URL =
  "https://dpmohkrwdlicexwcrqfy.supabase.co/functions/v1/kleinanzeigen-callback-bridge";
const CALLBACK_ORIGIN = "https://login.kleinanzeigen.de";
const CALLBACK_PATH = "/android/com.ebay.kleinanzeigen/callback";
const MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCallback(raw) {
  const url = new URL(String(raw || ""));
  if (
    url.origin !== CALLBACK_ORIGIN ||
    url.pathname !== CALLBACK_PATH ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error("invalid_callback_url");
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!state || (!code && !error)) throw new Error("invalid_callback_url");

  return { url, state };
}

async function setBadge(text) {
  try {
    await chrome.action.setBadgeText({ text });
  } catch {}
}

async function relay(callbackUrl) {
  const { url, state } = parseCallback(callbackUrl);
  const key = `ka_callback_relay:${state}`;

  const previous = await chrome.storage.local.get(key);
  if (previous[key]?.status === "ok") {
    await setBadge("OK");
    return { ok: true, deduplicated: true };
  }

  let lastError = "relay_failed";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(BRIDGE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callbackUrl: url.href }),
        cache: "no-store"
      });

      const result = await response.json().catch(() => null);

      if (response.ok && result?.ok === true) {
        await chrome.storage.local.set({
          [key]: { status: "ok", completedAt: Date.now() }
        });
        await setBadge("OK");
        return result;
      }

      const code = String(result?.error || `http_${response.status}`);
      lastError = code;

      // These are terminal outcomes. Retrying the same authorization code will not help.
      if (
        code === "invalid_callback_url" ||
        code === "oauth_login_failed" ||
        code === "auth_flow_expired"
      ) {
        break;
      }
    } catch (error) {
      lastError = String(error?.message || "network_error");
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep([500, 1500, 3000][attempt - 1]);
    }
  }

  await chrome.storage.local.set({
    [key]: { status: "failed", error: lastError, failedAt: Date.now() }
  });
  await setBadge("!");
  throw new Error(lastError);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "KA_CALLBACK_RELAY") return;

  relay(message.callbackUrl)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({ ok: false, error: String(error?.message || "relay_failed") })
    );

  return true;
});
