/** P366 (Nov 5 2026), Phase 4 step one: the sites that link to a site's page-one competitors but not to it, found in the
 * weekly diagnosis (P368: with one DataForSEO page-intersection request, about $0.025), only when the owner turned link
 * building on. Nothing runs, nothing is bought and nobody is contacted until then (Arshad's rule; ops/PHASE-4-EARNED-LINKS.md). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { linkCompetitors } from "../convex/lib/linkOpportunities.ts";

// The diagnosis's real page one for LeadPilot's main searches (Nov 5 2026).
const pageOne = [
  { domains: [{ domain: "default.com", rank: 53 }, { domain: "instantly.ai", rank: 61 }, { domain: "unboundb2b.com", rank: 40 }, { domain: "g2.com", rank: 89 },
    { domain: "revenuebase.ai", rank: 36 }, { domain: "ringlead.ca", rank: 19 }, { domain: "mindmatrix.net", rank: 68 }, { domain: "leadgenapp.io", rank: 47 }] },
  { domains: [{ domain: "instantly.ai", rank: 61 }, { domain: "hubspot.com", rank: 93 }, { domain: "leadgenapp.io", rank: 47 }, { domain: "leadpilot.chat", rank: 4 }] },
  { domains: [{ domain: "leadgenapp.io", rank: 47 }, { domain: "salesforce.com", rank: 95 }, { domain: "instantly.ai", rank: 61 }, { domain: "unknown.example", rank: null }] },
];

test("the competitors to mine are the ones most often on the site's page one, never a big publisher, the site, or a giant", () => {
  // P374: strongest first among equals (a stronger site has more links to mine).
  assert.deepEqual(linkCompetitors(pageOne, "leadpilot.chat"), ["instantly.ai", "leadgenapp.io", "mindmatrix.net"]);
  // P374: the competitors the owner confirmed come first; names without an address and forums are skipped.
  assert.deepEqual(linkCompetitors(pageOne, "leadpilot.chat", 3, ["Intercom.io", "Surfer SEO", "blackhatworld.com", "https://www.Clearbit.com/", "drift.com"]),
    ["intercom.io", "clearbit.com", "instantly.ai"], "a giant (drift.com) is skipped like any big publisher");
});

// P368: the domain-level request became the page-level one (tests/p368-earned-links.test.ts).

test("off unless the owner turned it on: no request, no record, no list", () => {
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  assert.match(action, /if \(site\.linkOutreach && out\.pageOne\.length\) \{/);
  assert.match(action, /const found = await findListingPages\(competitors, site\.domain\);/, "inside the diagnosis's spend hold");
  const records = readFileSync("convex/linkOpportunities.ts", "utf8");
  assert.match(records, /if \(!site \|\| site\.deletionStatus \|\| !site\.linkOutreach\) return \{ added: 0 \};/);
  assert.match(readFileSync("convex/schema.ts", "utf8"), /linkOutreach: v\.optional\(v\.union\(v\.literal\("find"\), v\.literal\("draft"\), v\.literal\("send"\)\)\),/);
  assert.doesNotMatch(readFileSync("convex/linkOpportunities.ts", "utf8") + readFileSync("convex/lib/linkOpportunities.ts", "utf8"), /sendCustomerEmail|resend|fetch\(|sendMail/i,
    "the records and the competitor choice contact no one (P368: only convex/actions/linkOutreach.ts sends, in 'send' mode)");
});
