import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const helper = readFileSync(new URL("../clients/immoscout-callback-helper-ios/TraumwohnungImmoScoutHandoff/App.swift", import.meta.url), "utf8");
const facade = readFileSync(new URL("../cloudflare/housing-runtime/src/provider-facade.js", import.meta.url), "utf8");

test("iOS ImmoScout callback uses the D1 provider facade and matching native URL scheme", () => {
  assert.match(helper, /traumwohnung-housing-runtime\.arash-ce5\.workers\.dev\/edge\/provider\/facade/);
  assert.match(helper, /"action": "complete_web"/);
  assert.match(helper, /"ticket": values\["state"\]/);
  assert.match(helper, /"callbackUrl": url\.absoluteString/);
  assert.doesNotMatch(helper, /supabase\.co\/functions\/v1\/immoscout-native-handoff/);
  const redirect = facade.match(/const SCOUT_REDIRECT = "([^"]+)";/)?.[1];
  assert.equal(new URL(redirect).protocol, "immobilienscout24.de:");
  assert.match(facade, /url\.protocol !== "immobilienscout24\.de:"/);
});
