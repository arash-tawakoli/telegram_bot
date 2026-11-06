function bytes(value) {
  if (!/^[a-f0-9]{64}$/i.test(String(value || ""))) throw new Error("credential_key_invalid");
  return Uint8Array.from(String(value).match(/.{2}/g), (part) => parseInt(part, 16));
}

function decode(value) {
  return Uint8Array.from(atob(String(value || "")), (character) => character.charCodeAt(0));
}

export async function decryptProviderCredentials(env, row, participantId, provider) {
  if (!row?.ciphertext || !row?.iv) return null;
  const key = await crypto.subtle.importKey("raw", bytes(env.APPLICATION_CREDENTIAL_KEY || env.CENTRAL_TOKEN_ENCRYPTION_KEY), { name: "AES-GCM" }, false, ["decrypt"]);
  const version = Number(row.key_version || 1);
  const candidates = [provider, provider === "immoscout24" ? "immoscout" : provider];
  for (const name of candidates) {
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(row.iv), additionalData: new TextEncoder().encode(`${participantId}:${name}:v${version}`) },
        key,
        decode(row.ciphertext),
      );
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      // Try the legacy provider alias before failing closed.
    }
  }
  throw new Error("credential_decrypt_failed");
}
