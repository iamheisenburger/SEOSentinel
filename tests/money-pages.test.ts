import assert from "node:assert/strict";
import test from "node:test";
import { moneyPagesFirst, nearPageOne } from "../convex/lib/moneyPages.ts";

test("pages ranking on positions 4-20 are improved first, by impressions", () => {
  const pages = [{ url: "https://a.example/top" }, { url: "https://a.example/deep" }, { url: "https://a.example/money" }, { url: "https://a.example/none" }];
  const rows = [
    { page: "https://a.example/top", position: 2, impressions: 900 },
    { page: "https://a.example/deep", position: 45, impressions: 700 },
    { page: "https://a.example/money", position: 8.4, impressions: 120 },
    { page: "https://a.example/money", position: 14, impressions: 60 },
    { page: "https://a.example/deep", position: 19, impressions: 30 },
  ];
  assert.deepEqual(moneyPagesFirst(pages, rows).map(p => p.url.split("/").pop()), ["money", "deep", "top", "none"]);
});

// P142 (Oct 21 2026): pages Google shows at 21-50 were never looked at first.
test("pages Google shows at 21-50 follow, their impressions discounted by distance", () => {
  const pages = [{ url: "https://a.example/faint" }, { url: "https://a.example/shown" }, { url: "https://a.example/deep" }];
  const rows = [
    { page: "https://a.example/faint", position: 10, impressions: 20 },
    { page: "https://a.example/shown", position: 31, impressions: 300 }, // 300 × (20/31)² ≈ 125
    { page: "https://a.example/deep", position: 60, impressions: 900 }, // past 50: not counted
  ];
  assert.deepEqual(moneyPagesFirst(pages, rows).map(p => p.url.split("/").pop()), ["shown", "faint", "deep"]);
});

test("without Search Console rows the original order is kept", () => {
  const pages = [{ url: "x" }, { url: "y" }];
  assert.deepEqual(moneyPagesFirst(pages, []), pages);
  assert.equal(nearPageOne({ position: 3.9 }), false);
  assert.equal(nearPageOne({ position: 4 }), true);
  assert.equal(nearPageOne({ position: 20 }), true);
  assert.equal(nearPageOne({}), false);
});
