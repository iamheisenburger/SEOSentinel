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

test("without Search Console rows the original order is kept", () => {
  const pages = [{ url: "x" }, { url: "y" }];
  assert.deepEqual(moneyPagesFirst(pages, []), pages);
  assert.equal(nearPageOne({ position: 3.9 }), false);
  assert.equal(nearPageOne({ position: 4 }), true);
  assert.equal(nearPageOne({ position: 20 }), true);
  assert.equal(nearPageOne({}), false);
});
