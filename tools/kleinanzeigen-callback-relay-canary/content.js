(() => {
  const CALLBACK_ORIGIN = "https://login.kleinanzeigen.de";
  const CALLBACK_PATH = "/android/com.ebay.kleinanzeigen/callback";

  try {
    const url = new URL(window.location.href);
    if (url.origin !== CALLBACK_ORIGIN || url.pathname !== CALLBACK_PATH) return;

    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (!state || (!code && !error)) return;

    chrome.runtime.sendMessage({
      type: "KA_CALLBACK_RELAY",
      callbackUrl: url.href
    }).catch(() => {});
  } catch {
    // Fail closed. The existing manual Telegram share flow remains available.
  }
})();
