import assert from "node:assert/strict";
import test from "node:test";

import {
  isSameSearchConsolePage,
  normalizeSearchConsolePage,
} from "../convex/lib/searchPerformance.ts";

test("normalizes protocol, www, query strings, and trailing slashes", () => {
  assert.equal(
    normalizeSearchConsolePage("https://www.LeadPilot.chat/blog/example/?utm_source=test"),
    "leadpilot.chat/blog/example",
  );
});

test("matches canonical variants of the same article", () => {
  assert.equal(
    isSameSearchConsolePage(
      "https://leadpilot.chat/blog/example/",
      "leadpilot.chat/blog/example",
    ),
    true,
  );
});

test("does not treat the homepage as every article", () => {
  assert.equal(
    isSameSearchConsolePage(
      "https://leadpilot.chat/",
      "https://leadpilot.chat/blog/example",
    ),
    false,
  );
});
