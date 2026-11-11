import test from "node:test";
import assert from "node:assert/strict";
import { normalizeImmoScoutEntry, parseMcpToolResult } from "../src/immoscout-source.js";

test("ImmoScout MCP entries become minimal offer facts", () => {
  const result = normalizeImmoScoutEntry({
    exposedId: "123",
    exposeUrl: "https://www.immobilienscout24.de/expose/123#details",
    title: "Wohnung Hamburg",
    totalRent: 1200,
    rooms: 2,
    size: 55,
    address: { city: "Hamburg", postcode: "20095" },
  }, 1);
  assert.equal(result.identity, "123");
  assert.equal(result.facts.warm_rent, 1200);
  assert.equal(result.canonical_url, "https://www.immobilienscout24.de/expose/123");
});

test("ImmoScout MCP errors fail closed", () => {
  assert.throws(() => parseMcpToolResult({ result: { isError: true, content: [{ text: "bad" }] } }), /bad/);
});
