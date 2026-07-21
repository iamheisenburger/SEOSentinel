import assert from "node:assert/strict";
import test from "node:test";

import {
  isSameSearchConsolePage,
  normalizeSearchConsolePage,
  publishedArticlePageUrl,
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

test("builds the measured page from each tenant's configured publication path", () => {
  assert.equal(
    publishedArticlePageUrl(
      "leadpilot.chat",
      "/blog/[slug]",
      "/ai-chatbot-for-sales-effectiveness",
    ),
    "https://leadpilot.chat/blog/ai-chatbot-for-sales-effectiveness",
  );
  assert.equal(
    publishedArticlePageUrl(
      "https://www.estiflow.com.au/",
      "/resources/[slug]",
      "estimate-guide",
    ),
    "https://www.estiflow.com.au/resources/estimate-guide",
  );
});
