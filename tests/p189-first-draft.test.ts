// P189 (Oct 25 2026): a site that started on Review first got no article until its owner found the Articles page and
// asked for one; the first real signups stopped before seeing any article. The overview offers the first one directly,
// through the same owner draft request (allowance, funding and topic checks) the Articles page uses.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const overview = readFileSync("src/components/content-work-overview.tsx", "utf8");

test("a Review-first site with nothing written yet is offered its first article on the overview", () => {
  assert.match(overview, /s\?\.ownerReviewedOnly && !upcoming\.length && !published\.length && typeof state\.ownerDraft\?\.maximumMicroUsd === "number"\s*\? <FirstDraft /);
  assert.match(overview, />\s*\{busy \? "Starting…" : "Write my first article"\}<\/button>/);
});

test("the first article goes through the owner draft request with the current review token and price", () => {
  assert.match(overview, /const requestDraft = useMutation\(api\.contentWork\.requestDraft\);/);
  assert.match(overview, /await requestDraft\(\{ siteId, requestKey, reviewToken, maximumMicroUsd \}\);/);
  assert.match(overview, /const \[requestKey\] = useState\(\(\) => crypto\.randomUUID\(\)\);/, "one key per visit, so a double click asks once");
  assert.match(overview, /err instanceof ConvexError && typeof err\.data === "string" \? err\.data/, "the owner sees the real reason (allowance, setup)");
});
