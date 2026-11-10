// P402 (Nov 10 2026): a dashboard tab opened before an update kept failing ("We couldn't load this") because it asked
// for a function the update removed; "Try again" re-ran the same old code. Such a page now reloads itself, at most once a
// minute, and any other error still shows the error box.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isVersionSkew, reloadForUpdate } from "../src/lib/answers/version-skew.ts";

test("only a missing-function error counts as a page older than the server", () => {
  assert.equal(isVersionSkew(new Error("[CONVEX Q(answerGrowthKit:videoKit)] Server Error\nCould not find public function for 'answerGrowthKit:videoKit'.")), true);
  assert.equal(isVersionSkew(new Error("Network request failed")), false);
  assert.equal(isVersionSkew(undefined), false);
});

test("the page reloads once, then not again within a minute", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  let reloads = 0;
  assert.equal(reloadForUpdate(1_000_000, storage, () => { reloads++; }), true);
  assert.equal(reloadForUpdate(1_030_000, storage, () => { reloads++; }), false, "no loop while the same error repeats");
  assert.equal(reloadForUpdate(1_070_000, storage, () => { reloads++; }), true, "a later update reloads again");
  assert.equal(reloads, 2);
});
