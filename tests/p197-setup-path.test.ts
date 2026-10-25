// P197 (Oct 25 2026): one of the first real signups never pressed Start Pentra and made an article with the Articles
// page's Generate, which ran the older article queue (none of the checks added since Oct 19) for a site set up through
// the content service. Such a site gets its articles through Start Pentra only; sites on the older flow keep their queue.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertNotMidContentSetup, MID_SETUP_QUEUE_MESSAGE, midContentSetup } from "../convex/lib/contentSetupPath.ts";

test("a site set up through the content service is mid setup until Start Pentra; an older-flow site never is", () => {
  assert.equal(midContentSetup({ contentSetupRequestedAt: 1 }), true);
  assert.equal(midContentSetup({ contentSetupRequestedAt: 1, serviceMode: "growth_first" }), false, "Start pressed");
  assert.equal(midContentSetup({}), false, "an older-flow site keeps its queue");
  assert.equal(midContentSetup({ serviceMode: "legacy_articles" }), false);
  assert.throws(() => assertNotMidContentSetup({ contentSetupRequestedAt: 1 }), { message: MID_SETUP_QUEUE_MESSAGE });
  assert.doesNotThrow(() => assertNotMidContentSetup({ contentSetupRequestedAt: 1, serviceMode: "growth_first" }));
  assert.match(MID_SETUP_QUEUE_MESSAGE, /press Start Pentra/);
});

test("both older-queue entry points refuse a site mid setup before anything is queued", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const queue = jobs.slice(jobs.indexOf("export const queueArticleNow"), jobs.indexOf("currentSitePlanAllowance(ctx, site)", jobs.indexOf("export const queueArticleNow")));
  assert.match(queue, /assertNotMidContentSetup\(site\);/, "before the allowance check and any insert");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const now = pipeline.slice(pipeline.indexOf("export const generateNow"), pipeline.indexOf("export const generateNow") + 400);
  assert.match(now, /assertNotMidContentSetup\(await requireOwnedSite\(ctx, siteId\)\);/);
});

test("the Articles and Plan pages send a site mid setup to Start Pentra instead of Generate", () => {
  const articles = readFileSync("src/app/(dashboard)/articles/page.tsx", "utf8");
  assert.match(articles, /const midSetup = Boolean\(site && midContentSetup\(site\)\);/);
  assert.match(articles, /actions=\{midSetup \? \(\s*<Link href="\/dashboard"[^>]*>\s*<PenTool[^>]*\/>\s*Start Pentra\s*<\/Link>/);
  assert.match(articles, /if \(midSetup\) \{ setStatus\(MID_SETUP_QUEUE_MESSAGE\); return; \}/);
  assert.match(articles, /No articles yet\. Finish setup on your dashboard to get your first article\./);
  const plan = readFileSync("src/app/(dashboard)/plan/page.tsx", "utf8");
  assert.match(plan, /const midSetup = Boolean\(site && midContentSetup\(site\)\);/);
  assert.match(plan, /\) : midSetup \? \(\s*<Link href="\/dashboard" title=\{MID_SETUP_QUEUE_MESSAGE\}/);
  assert.match(plan, /if \(midSetup\) \{ setStatus\(MID_SETUP_QUEUE_MESSAGE\); return; \}/);
});
