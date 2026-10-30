// P248 (Oct 30 2026): Cowork's fresh signup: the first article was ready minutes after Start, but the dashboard only
// said it "goes live" two hours later, so a new user left with nothing to read (ops/LAUNCH-GAPS.md A6). A ready article
// opens from the dashboard at once; it still goes live at its slot (or by Publish Now on its page).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("P248 a ready article opens from the dashboard before it goes live", () => {
  const overview = readFileSync("src/components/content-work-overview.tsx", "utf8");
  assert.match(overview, /const readyToRead = \(w: \{ stage: string; articleId\?: string \| null \}\)[^\n]*w\.stage === "ready" && Boolean\(w\.articleId\);/);
  assert.match(overview, /\{plain && readyToRead\(w\) && <> · <Link className="text-\[#0EA5E9\] hover:underline" href=\{`\/articles\/\$\{w\.articleId\}`\}>Read it now<\/Link><\/>\}/);
  assert.match(overview, /Read your first article here as soon as it's ready\. It goes live on your site at the time shown\./);
});
