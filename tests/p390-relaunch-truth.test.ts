// P390 (Nov 8 2026): after Pentra became Pentra Answers, nothing a visitor reads may present the old article service's
// plans or prices as today's offer. pentra.dev's earlier guides stay published, with a note; the terms list the
// destinations Answers pages publish to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLegacyPentraGuide, LEGACY_GUIDE_NOTICE, PENTRA_ANSWERS_LAUNCH_AT } from "../src/lib/pentra-relaunch.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("pentra.dev's guides written before the relaunch say their product details no longer apply", () => {
  assert.equal(isLegacyPentraGuide("pentra.dev", Date.UTC(2026, 8, 25)), true);
  assert.equal(isLegacyPentraGuide("www.pentra.dev", PENTRA_ANSWERS_LAUNCH_AT - 1), true);
  assert.equal(isLegacyPentraGuide("pentra.dev", PENTRA_ANSWERS_LAUNCH_AT), false, "guides written after the relaunch need no note");
  assert.equal(isLegacyPentraGuide("acme.example", Date.UTC(2026, 8, 25)), false, "never on another site's blog");
  assert.match(LEGACY_GUIDE_NOTICE, /plans, prices and features no longer applies/);
  const page = read("src/app/blog/[slug]/page.tsx");
  assert.match(page, /isLegacyPentraGuide\(domain, article\.createdAt\) && \(/);
  assert.match(page, /See what Pentra does now/);
  assert.doesNotMatch(read("src/app/blog/page.tsx"), /Every article is\s+written, fact-checked and published by Pentra/);
});

test("the terms list where Answers pages publish and never call WordPress or webhooks beta", () => {
  const terms = read("src/app/legal/terms/page.tsx");
  assert.match(terms, /Answer pages publish to WordPress, Webflow, Shopify, Ghost, a GitHub repository, a signed webhook, or a hosted subdomain/);
  assert.doesNotMatch(terms, /WordPress, signed-webhook publishing, managed outreach, and automatic cold outreach remain beta/);
});
