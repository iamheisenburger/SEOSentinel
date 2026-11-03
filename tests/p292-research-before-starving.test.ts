// P292 (Nov 3 2026, ops/ARTICLE-PLAN-V2.md hole 5): pentra.dev's keyword research at 14:33Z added one topic, the duplicate
// audit dropped it, and every scheduler pass after said "content_inputs_exhausted": its 21:42Z slot had nothing to write,
// and research would run again only 24 hours later (7 days after an empty run). A site with too few topics left now
// researches again within 3 hours on the next round's seeds, and People Also Ask questions widen the seeds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("P292 a site with too few topics researches again within hours, never a week later", async () => {
  const { exhaustedTopicResearchDueAt, TOPIC_RESEARCH_STARVED_GAP_MS } = await import("../convex/contentWork.ts").catch(() => ({} as never));
  const hour = 3_600_000, day = 24 * hour, at = Date.UTC(2026, 10, 3, 14, 33);
  if (exhaustedTopicResearchDueAt) {
    const due = (added?: number) => exhaustedTopicResearchDueAt({ intervalMs: day, topicsReplenishedAt: at, topicsReplenishAdded: added,
      topicsResearchReceipt: { method: 99 } });
    assert.equal(TOPIC_RESEARCH_STARVED_GAP_MS, 3 * hour);
    assert.equal(due(1), at + 3 * hour, "one topic added: again in 3 hours");
    assert.equal(due(0), at + day, "an empty run: the next day, not a week later");
    assert.ok(due(6) >= at + day, "a full run waits as before");
    return;
  }
  // contentWork.ts imports Convex runtime modules: check the source instead.
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /export const TOPIC_RESEARCH_STARVED_GAP_MS = 3 \* 3_600_000;/);
  assert.match(work, /: added === 0 \? TOPIC_REPLENISH_MIN_GAP_MS : TOPIC_RESEARCH_STARVED_GAP_MS;/);
});

test("P292 People Also Ask questions beside the site's topics are research seeds", () => {
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /const asked = topics\.flatMap\(t => t\.serpBrief\?\.questions \?\? \[\]\)/);
  assert.match(work, /const demand = \[\.\.\.written, \.\.\.shown, \.\.\.asked\]\.filter/);
});
