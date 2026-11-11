import test from "node:test";
import assert from "node:assert/strict";
import { validateImmomioPage } from "../src/immomio-source.js";

test("Immomio pagination accepts an exact final page", () => {
  const list = validateImmomioPage({ data: { propertyList: { page: { page: 0, size: 2, totalElements: 2, totalPages: 1 }, nodes: [{ objectId: "a" }, { objectId: "b" }] } } }, 0);
  assert.equal(list.nodes.length, 2);
});

test("Immomio pagination rejects truncated pages", () => {
  assert.throws(() => validateImmomioPage({ data: { propertyList: { page: { page: 0, size: 2, totalElements: 3, totalPages: 2 }, nodes: [{ objectId: "a" }] } } }, 0), /immomio_truncated_page/);
});
