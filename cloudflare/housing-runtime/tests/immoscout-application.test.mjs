import test from "node:test";
import assert from "node:assert/strict";
import { sendImmoScoutApplication } from "../src/immoscout-application.js";

test("ImmoScout application fails closed when the encrypted provider session is absent", async () => {
  await assert.rejects(
    () => sendImmoScoutApplication({ participant_id: "user-1", external_id: "123456789", profile: {} }, {}, () => {}),
    /credential_key_invalid|needs_login/,
  );
});
