import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { createGitHubAppJwt } from "../src/github.mjs";

test("GitHub App JWT signs correctly with PKCS#1 and PKCS#8 PEM keys", async () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = pair.publicKey;
  const privateKeys = [
    pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  ];

  for (const privateKey of privateKeys) {
    const jwt = await createGitHubAppJwt({
      GITHUB_APP_ID: "123456",
      GITHUB_APP_PRIVATE_KEY: privateKey
    });

    const [header, payload, signature] = jwt.split(".");
    assert.ok(header && payload && signature);

    const verifier = createSign("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();

    const signatureBytes = Buffer.from(
      signature.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );
    assert.equal(
      pair.publicKey.verify ? true : false,
      true
    );
    const verify = (await import("node:crypto")).createVerify("RSA-SHA256");
    verify.update(`${header}.${payload}`);
    verify.end();
    assert.equal(verify.verify(publicKey, signatureBytes), true);
  }
});
