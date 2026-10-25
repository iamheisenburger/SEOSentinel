// P185 (Oct 25 2026): the first two real free signups never started Pentra. One had a verified website and an active
// plan, but "Start Pentra" stayed silently disabled until a confirmation box was ticked; the other's site is on no
// platform Pentra publishes to, and nothing on the panel offered the paste option, so setup could not finish.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync("src/components/pentra-setup-choice.tsx", "utf8");

test("Start Pentra is never silently disabled by the confirmation box: pressing it says what to do", () => {
  assert.match(panel, /<Button disabled=\{!ready \|\| busy\} loading=\{busy\} onClick=\{start\}>Start Pentra<\/Button>/);
  assert.doesNotMatch(panel, /disabled=\{[^}]*!confirmed[^}]*\}[^>]*>Start Pentra/, "the box no longer disables the button");
  assert.match(panel, /if \(!confirmed\) \{\s*setError\("Tick \\u201cMy business details are accurate\\u201d above, then press Start Pentra\./);
});

test("a site Pentra can't publish to can start by pasting, from the panel itself", () => {
  assert.match(panel, /Paste the articles yourself/);
  assert.match(panel, /updateSite\(\{ siteId: state\.siteId, publishMethod: "manual" \}\)/);
  assert.match(panel, /\{!state\.destination\.verified && <li/, "offered only while no website is connected");
});

test("a site that isn't ready is told which step is missing", () => {
  assert.match(panel, /Connect your website, or choose to paste articles yourself, to start\./);
  assert.match(panel, /Check your plan in Billing to start\./);
  assert.doesNotMatch(panel, /Finish the steps above to start\./);
});
