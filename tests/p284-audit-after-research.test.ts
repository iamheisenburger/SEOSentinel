// P284 (Nov 3 2026): pentra.dev's /automate-blog-posts (Nov 1) and /wordpress-seo-automation-what-to-automate (Nov 3) were
// researched and written the same day, and reached the daily 02:40Z plan audit only as paid drafts, which it held as repeats
// of a live page (/publish-blog-posts-wordpress-nextjs-automatically). The research run now audits its new topics against the
// live articles (the same P194 call, only when the plan changed) before it wakes the scheduler, so such a topic is dropped
// before anything is written.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("P284 the research run audits its new topics before the scheduler can write one", () => {
  const topics = readFileSync("convex/actions/growthTopics.ts", "utf8");
  const replenish = topics.slice(topics.indexOf("export const replenish = internalAction"), topics.indexOf("export const measureOwnerSearch"));
  const recorded = replenish.indexOf("internal.contentWork.addResearchedTopics, { siteId, keywords, research, deferWake: true }");
  const audited = replenish.indexOf("await auditPlan(ctx, siteId)");
  const woken = replenish.indexOf("internal.autopilot.dispatchSiteFollowup");
  assert.ok(recorded > 0, "the topics are recorded without the immediate wake");
  assert.ok(audited > recorded, "then audited");
  assert.ok(woken > audited, "then the scheduler is woken, even when nothing was added");
  assert.match(replenish, /if \(result\.added > 0\) \{/, "an empty run spends nothing on an audit");
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /if \(!deferWake\) await wake\(ctx, siteId\);/);
});
