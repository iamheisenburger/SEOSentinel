/** P366 (Nov 5 2026), Phase 4 step one: the sites that link to a site's page-one competitors but not to it, found in the
 * weekly diagnosis with one DataForSEO domain-intersection request (about $0.025), only when the owner turned link finding
 * on. Nothing runs, nothing is bought and nobody is contacted until then (Arshad's rule; ops/PHASE-4-EARNED-LINKS.md). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { domainIntersectionRequest, linkCompetitors, parseDomainIntersection } from "../convex/lib/linkOpportunities.ts";

// The diagnosis's real page one for LeadPilot's main searches (Nov 5 2026).
const pageOne = [
  { domains: [{ domain: "default.com", rank: 53 }, { domain: "instantly.ai", rank: 61 }, { domain: "unboundb2b.com", rank: 40 }, { domain: "g2.com", rank: 89 },
    { domain: "revenuebase.ai", rank: 36 }, { domain: "ringlead.ca", rank: 19 }, { domain: "mindmatrix.net", rank: 68 }, { domain: "leadgenapp.io", rank: 47 }] },
  { domains: [{ domain: "instantly.ai", rank: 61 }, { domain: "hubspot.com", rank: 93 }, { domain: "leadgenapp.io", rank: 47 }, { domain: "leadpilot.chat", rank: 4 }] },
  { domains: [{ domain: "leadgenapp.io", rank: 47 }, { domain: "salesforce.com", rank: 95 }, { domain: "instantly.ai", rank: 61 }, { domain: "unknown.example", rank: null }] },
];

test("the competitors to mine are the ones most often on the site's page one, never a big publisher, the site, or a giant", () => {
  assert.deepEqual(linkCompetitors(pageOne, "leadpilot.chat"), ["leadgenapp.io", "instantly.ai", "ringlead.ca"]);
  const body = domainIntersectionRequest(["leadgenapp.io", "instantly.ai"], "https://www.leadpilot.chat/");
  assert.deepEqual(body[0].targets, { "1": "leadgenapp.io", "2": "instantly.ai" });
  assert.deepEqual(body[0].exclude_targets, ["leadpilot.chat"]);
  assert.equal(body[0].rank_scale, "one_hundred");
});

test("the answer's referring domains worth an approach: not spam, not a giant, not a big publisher, not the site", () => {
  const item = (target: string, rank: number, spam = 0) => ({ domain_intersection: { "1": { type: "backlinks_domain_intersection", target, rank, backlinks_spam_score: spam },
    "2": { type: "backlinks_domain_intersection", target, rank, backlinks_spam_score: spam } }, summary: { intersections_count: 2 } });
  const data = { tasks: [{ result: [{ total_count: 6, items_count: 6, items: [item("www.saasblog.example", 42), item("spammy.example", 3), item("forbes.com", 94),
    item("reddit.com", 40), item("leadpilot.chat", 30), item("growthnotes.example", 25, 55), item("b2bweekly.example", 31)] }] }] };
  assert.deepEqual(parseDomainIntersection(data, ["leadgenapp.io", "instantly.ai"], "leadpilot.chat"),
    [{ domain: "saasblog.example", rank: 42, linksTo: ["leadgenapp.io", "instantly.ai"] }, { domain: "b2bweekly.example", rank: 31, linksTo: ["leadgenapp.io", "instantly.ai"] }]);
  assert.deepEqual(parseDomainIntersection(null, [], "x.example"), []);
});

test("off unless the owner turned it on: no request, no record, no list", () => {
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  assert.match(action, /if \(site\.linkOutreach && out\.pageOne\.length\) \{/);
  assert.match(action, /meterDataForSeoCost\(\(\) => domainIntersection\(domainIntersectionRequest\(competitors, site\.domain\)\)\)/, "inside the diagnosis's spend hold");
  const records = readFileSync("convex/linkOpportunities.ts", "utf8");
  assert.match(records, /if \(!site \|\| site\.deletionStatus \|\| !site\.linkOutreach\) return \{ added: 0 \};/);
  assert.match(records, /site\.userId !== identity\.subject \|\| !site\.linkOutreach\) return \[\];/);
  assert.match(readFileSync("convex/schema.ts", "utf8"), /linkOutreach: v\.optional\(v\.union\(v\.literal\("find"\), v\.literal\("draft"\), v\.literal\("send"\)\)\),/);
  assert.doesNotMatch(readFileSync("convex/linkOpportunities.ts", "utf8") + readFileSync("convex/lib/linkOpportunities.ts", "utf8"), /sendCustomerEmail|resend|fetch\(/i,
    "nothing here contacts anyone");
});
