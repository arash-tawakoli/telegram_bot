import assert from "node:assert/strict";
import test from "node:test";
import { sourcesForMinute } from "../src/source-schedule.js";

test("source polling covers every D1 source at its required interval", () => {
  const mainRuns = new Map();
  const shadowRuns = new Map();
  for (let minute = 0; minute < 40; minute++) {
    const runs = sourcesForMinute(minute);
    assert.equal(runs.length, minute % 5 === 0 ? 2 : 1);
    const [main, shadow] = runs;
    mainRuns.set(main, [...(mainRuns.get(main) || []), minute]);
    if (shadow !== undefined) shadowRuns.set(shadow, [...(shadowRuns.get(shadow) || []), minute]);
  }

  assert.deepEqual([...mainRuns.keys()].sort((a, b) => a - b), [1, 3, 23, 29, 34, 35, 66, 69, 71]);
  const expectedMainIntervals = new Map([[1, 10], [3, 10], [23, 10], [29, 10], [34, 10], [35, 20], [66, 20], [69, 5], [71, 5]]);
  for (const [source, expected] of expectedMainIntervals) {
    const minutes = mainRuns.get(source);
    const intervals = minutes.slice(1).map((value, index) => value - minutes[index]);
    intervals.push(minutes[0] + 40 - minutes.at(-1));
    assert.ok(intervals.every((interval) => interval === expected), "source " + source + ": " + intervals);
  }

  for (const [index, source] of [30, 32, 36, 39].entries()) {
    const minutes = shadowRuns.get(source);
    assert.deepEqual(minutes, [index * 5, index * 5 + 20]);
  }
});
