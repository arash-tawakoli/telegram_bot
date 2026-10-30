import test from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
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

    const signatureBytes = Buffer.from(
      signature.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );
    const verify = createVerify("RSA-SHA256");
    verify.update(`${header}.${payload}`);
    verify.end();
    assert.equal(verify.verify(publicKey, signatureBytes), true);
  }
});
