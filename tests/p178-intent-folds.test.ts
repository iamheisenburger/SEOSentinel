// P178 (Oct 24 2026): LeadPilot's research queued four wordings of one search behind its sealed article "how to
// increase conversion rate of website", and the intent check saw five different searches, so Autopilot would have
// written near-copies of one page. "increase", "improving" and "optimization" ask the same thing of a metric, and
// "conversion rate" is the conversion a search asks about.
import test from "node:test";
import assert from "node:assert/strict";
import { contentIntentConflicts } from "../convex/lib/autopilotBuffer.ts";

const same = (a: string, b: string) => contentIntentConflicts({ primaryKeyword: a }, { primaryKeyword: b });

test("wordings of one search are one intent", () => {
  for (const variant of ["how to increase conversion on website", "website conversion rate optimization", "improving website conversion rates",
    "website conversion improvement"]) {
    assert.equal(same(variant, "how to increase conversion rate of website"), true, variant);
  }
  assert.equal(same("boost landing page conversions", "improve landing page conversion"), true);
});

test("different searches stay apart", () => {
  for (const [a, b] of [
    ["website conversion strategies", "how to increase conversion rate of website"],
    ["increase lead volume", "improve lead quality"],
    ["lead scoring", "salesforce lead scoring"],
    ["inbound marketing lead scoring", "inbound lead scoring"],
    ["business analysis process", "business status update"],
    ["24/7 customer support chatbot", "how to increase conversion rate of website"],
  ]) assert.equal(same(a, b), false, `${a} | ${b}`);
});
