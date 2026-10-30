// P249 (Oct 30 2026): Cowork's launch audit: the Privacy page did not list DataForSEO (Google search data for every
// site and the free check), Resend (account emails) or GitHub (publishing), nor say the free check keeps a result 7
// days behind a shareable link.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("P249 the Privacy page names every processor Pentra sends data to and the free check's 7-day results", () => {
  const privacy = readFileSync("src/app/legal/privacy/page.tsx", "utf8");
  for (const name of ["DataForSEO", "Resend", "GitHub", "Anthropic", "OpenAI", "Clerk", "Convex", "Vercel", "Stripe"])
    assert.match(privacy, new RegExp(`<strong className="text-\\[#F7F8F8\\]">${name}[^<]*</strong>`), name);
  assert.match(privacy, /stores the website address you enter and its result for 7 days, so you can share the result&apos;s link/);
  assert.match(readFileSync("src/components/free-check/check-result.tsx", "utf8"), /Results are kept for 7 days\./, "what the check itself says");
});
