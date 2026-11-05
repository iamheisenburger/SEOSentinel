/** P359 (Nov 5 2026), Phase 2: topic choice. Autopilot writes only searches buyers make, that the site can win on Google's
 * real page one, one page per search intent, never into a group of its own articles Google shows to nobody. Built from the
 * weekly diagnosis of both owner sites: LeadPilot (authority 4) had no reachable result on page one for any of its five
 * main searches; pentra.dev (authority 0) got 85% of its impressions past page 2; no planned topic on either site had
 * ever been checked against its page one. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupBrake, PAGE_ONE_CHECK_VERSION, PAGE_ONE_FRESH_MS, pageOneStatus, pageOneVerdict, rankability, registrableDomain, sameGroup,
  searchConsolePosition, subjectWords, topicChoiceRollout, topicWritable, winnableStatus } from "../convex/lib/pageOne.ts";
import { evaluateSerpAttainability } from "../convex/lib/serpAttainability.ts";

const page = (domains: string[]) => domains.map((d, i) => ({ url: `https://www.${d}/article-${i}` }));
const vendors = ["seranking.com", "surferseo.com", "yoast.com", "seoclarity.net", "conductor.com", "brightedge.com", "similarweb.com", "nightwatch.io", "positional.com", "rankmath.com"];
const strong = new Map(vendors.map((d, i) => [d, 62 + i * 3]));

test("page one decides: an SEO-vendor page one the old difficulty check let through is not winnable for a weak site", () => {
  assert.equal(evaluateSerpAttainability({ serpTopUrls: page(vendors).map((r) => r.url), siteHost: "pentra.dev" }).attainable, true, "no listed mega-host");
  const r = rankability({ results: page(vendors), siteDomain: "pentra.dev", siteAuthority: 4, authorities: strong });
  assert.equal(r.rankable, false);
  assert.equal(r.reachable, 0);
  assert.equal(r.projectedPosition, 11, "beyond page one, not clamped to 10");
  assert.match(r.reason, /0 of 10 results within 10 points of its authority 4 \(median 77\)/);
});

test("a page one with sites as small as this one is winnable; the site's own result and big publishers never count as reachable", () => {
  const local = ["angi.com", "homeadvisor.com", "rivercityplumbing.example", "capitolplumbing.example", "yelp.com", "bbb.org", "smithplumbing.example", "thumbtack.com", "austinplumbers.example", "forbes.com"];
  const ranks = new Map<string, number>([["angi.com", 85], ["homeadvisor.com", 84], ["rivercityplumbing.example", 14], ["capitolplumbing.example", 9], ["yelp.com", 93], ["bbb.org", 90],
    ["smithplumbing.example", 21], ["thumbtack.com", 80], ["austinplumbers.example", 11], ["forbes.com", 95]]);
  const r = rankability({ results: page(local), siteDomain: "cedar-ridge-plumbing.example", siteAuthority: 10, authorities: ranks });
  assert.equal(r.rankable, true, r.reason);
  assert.equal(r.reachable, 3);
  const own = rankability({ results: page(["mine.example", "a.example", "b.example", "c.example", "d.example", "e.example"]), siteDomain: "mine.example", siteAuthority: 8,
    authorities: new Map([["a.example", 3], ["b.example", 70], ["c.example", 71], ["d.example", 72], ["e.example", 73]]) });
  assert.equal(own.pageOne.length, 5, "the site's own result is not competition");
  assert.equal(own.rankable, false, "one reachable result is not enough");
  const forum = rankability({ results: page(["reddit.com", "quora.com", "a.example", "b.example", "c.example", "d.example"]), siteDomain: "mine.example", siteAuthority: 8,
    authorities: new Map([["reddit.com", 3], ["quora.com", 3], ["a.example", 70], ["b.example", 70], ["c.example", 70], ["d.example", 70]]) });
  assert.equal(forum.reachable, 0, "a big publisher is never a reachable result, whatever authority it reports");
  assert.match(rankability({ results: page(vendors), siteDomain: "mine.example", siteAuthority: null, authorities: strong }).reason, /authority is not measured/);
  assert.match(rankability({ results: page(["a.example", "b.example", "c.example", "d.example", "e.example", "f.example"]), siteDomain: "mine.example", siteAuthority: 8,
    authorities: new Map([["a.example", 3]]) }).reason, /only 1 of 6 page-one authorities measured/, "nothing unmeasured is assumed weak");
  assert.equal(rankability({ results: [{ url: "https://blog.hubspot.com/x" }, ...page(vendors)], siteDomain: "mine.example", siteAuthority: 8,
    authorities: new Map([["hubspot.com", 93], ...strong]) }).pageOne[0].authority, 93, "a subdomain carries its domain's authority");
  assert.equal(registrableDomain("https://shop.example.co.uk/a"), "example.co.uk");
});

test("the diagnosis's real page ones (Nov 5 2026): none of the owner sites' main searches is winnable at their authority", () => {
  // Stored by the weekly diagnosis: domain and DataForSEO rank of each page-one result.
  const lp = { query: "dealership lead scoring system", domains: [["default.com", 53], ["instantly.ai", 61], ["unboundb2b.com", 40], ["g2.com", 89], ["revenuebase.ai", 36],
    ["ringlead.ca", 19], ["mindmatrix.net", 68], ["leadgenapp.io", 47]] as Array<[string, number]> };
  const pd = { query: "seo workflow", domains: [["seoworkflows.com", 21], ["monday.com", 86], ["marketermilk.com", 44], ["digiberry.org", 0], ["seobrand.com", 37],
    ["searchengineland.com", 73], ["slingshotapp.io", 55]] as Array<[string, number]> };
  const judge = (c: typeof lp, site: string, authority: number) => rankability({ results: page(c.domains.map(([d]) => d)), siteDomain: site, siteAuthority: authority,
    authorities: new Map(c.domains) });
  const leadpilot = judge(lp, "leadpilot.chat", 4), pentra = judge(pd, "pentra.dev", 0);
  assert.equal(leadpilot.rankable, false); assert.equal(leadpilot.reachable, 0, "the weakest result (19) is 15 points above LeadPilot");
  assert.equal(pentra.rankable, false); assert.equal(pentra.reachable, 1, "one result (digiberry.org, 0) is within reach: not enough");
  const stored = pageOneVerdict(pentra, 1_793_900_000_000);
  assert.deepEqual({ version: stored.version, rankable: stored.rankable, reachable: stored.reachable, results: stored.results, siteAuthority: stored.siteAuthority },
    { version: PAGE_ONE_CHECK_VERSION, rankable: false, reachable: 1, results: 7, siteAuthority: 0 });
});

test("a topic is winnable when Search Console already shows the site at 20 or better, or on a fresh page-one check; stale or older checks are checked again", () => {
  const now = 1_793_900_000_000, fresh = { version: PAGE_ONE_CHECK_VERSION, checkedAt: now - 86_400_000, rankable: true, reason: "", siteAuthority: 4,
    reachable: 3, measured: 9, results: 10, medianAuthority: 30 };
  assert.equal(pageOneStatus({ searchConsolePosition: 16.3 }, now), "proven");
  assert.equal(pageOneStatus({ notes: "Search Console: this site was shown 115 times in 28 days for this search at average position 16.3, with no article of its own." }, now), "proven",
    "older topics carry the position in their note");
  assert.equal(searchConsolePosition({ notes: "Search Console: this site was shown 9 times in 28 days for this search, with no article of its own." }), null);
  assert.equal(pageOneStatus({ searchConsolePosition: 35.2 }, now), "unchecked", "far from page one: checked like any search");
  assert.equal(pageOneStatus({ pageOne: fresh }, now), "winnable");
  assert.equal(pageOneStatus({ pageOne: { ...fresh, rankable: false } }, now), "unwinnable");
  assert.equal(pageOneStatus({ pageOne: { ...fresh, checkedAt: now - PAGE_ONE_FRESH_MS - 1 } }, now), "unchecked", "page one and authority move: checked again");
  assert.equal(pageOneStatus({ pageOne: { ...fresh, version: PAGE_ONE_CHECK_VERSION - 1 } }, now), "unchecked");
  assert.deepEqual(["proven", "winnable", "unwinnable", "unchecked"].map((s) => winnableStatus(s as never)), [true, true, false, false]);
});

test("the brake: no new article on a subject while three settled articles on it got no impressions; it lifts once one is shown", () => {
  const now = 1_793_900_000_000, settled = now - 40 * 86_400_000, young = now - 5 * 86_400_000;
  assert.deepEqual(subjectWords("The Best Lead Scoring Templates for SaaS"), ["lead", "scoring", "template", "saas"]);
  assert.equal(sameGroup("lead scoring template", "Lead Scoring Templates That Sales Teams Use"), true);
  assert.equal(sameGroup("lead scoring template", "lead qualification checklist"), false, "one shared word is a different subject");
  const ignored = [{ subject: "Lead scoring template for B2B", publishedAt: settled, impressions: 0 }, { subject: "Lead scoring templates explained", publishedAt: settled, impressions: 0 },
    { subject: "How lead scoring templates work", publishedAt: settled, impressions: 0 }, { subject: "Website conversion rate", publishedAt: settled, impressions: 0 }];
  const braked = groupBrake("lead scoring template", ignored, now);
  assert.equal(braked.braked, true); assert.match(braked.reason, /3 articles on this subject got no impressions in 28 days/);
  assert.equal(groupBrake("lead scoring template", ignored.map((a, i) => i === 0 ? { ...a, impressions: 4 } : a), now).braked, false, "one shown article lifts it");
  assert.equal(groupBrake("lead scoring template", ignored.map((a, i) => i === 0 ? { ...a, publishedAt: young } : a), now).braked, false, "an article still settling isn't evidence");
  assert.equal(groupBrake("exit intent popup timing", ignored, now).braked, false);
});

test("Autopilot writes only a topic that passed every check; checks run on every topic still in the running", () => {
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /const planned = phaseTwo \? candidates\.filter\(t => ownerChosen\(t\) \|\| topicWritable\(t, now\)\) : \[\.\.\.candidates\];/,
    "built for every site, run on the rollout sites first");
  const lib = readFileSync("convex/lib/topicVerdict.ts", "utf8");
  assert.match(lib, /return t\.buyerFit\?\.eligible === true && winnableStatus\(pageOneStatus\(t, now\)\) && !\(t\.groupBrake\?\.braked === true/,
    "buyer fit is required (word matching alone no longer admits a topic), page one decides, the brake holds");
  assert.match(work, /try \{ planned = \(await eligiblePlannedTopics\(ctx, site\)\)\.candidates; \} catch \{ return null; \}/, "the buyer-fit sweep judges every candidate");
  assert.match(work, /\(await eligiblePlannedTopics\(ctx, site, \[\], undefined, pages\)\)\.candidates\.filter\(t => !ownerChosen\(t\)\)/, "the plan audit reads every candidate");
  assert.match(work, /topic = await chooseTopic\(ctx, site, undefined, \[\], \{ preloaded, autopilot: true \}\);/);
  assert.match(work, /if \(options\.autopilot && topicChoiceRollout\(siteCanonicalDomain\(site\) \?\? site\.domain\)\) \{\n    await queueFallbackTopicsForChecks\(ctx, site, inventory, excludedIntents\);\n    return null;\n  \}/,
    "a confirmed customer question becomes a topic to check, never an unchecked article");
  assert.match(work, /if \(preferredId\) return candidates\.find\(t => t\._id === preferredId\) \?\? null;/, "a topic the owner picks is theirs, checked or not");
  const research = readFileSync("convex/actions/growthTopics.ts", "utf8");
  assert.ok(research.indexOf("checkPageOne(site, [...toCheck.map((k) => k.keyword)") > 0 &&
    research.indexOf("checkPageOne(site, [...toCheck.map((k) => k.keyword)") < research.lastIndexOf("internal.contentWork.closeTopicResearchReservation"),
    "research checks page one before it settles, so the checks are inside its spend hold");
  assert.match(research, /const dataForSeoUsd = metered\.usd \+ pageOne\.usd;/);
  assert.match(research, /const pageOne = await checkPlannedTopicsPageOne\(ctx, siteId\);/, "the daily sweep checks the plan");
  assert.match(research, /await ctx\.runMutation\(internal\.contentWork\.applyGroupBrakes, \{ siteId \}\);/);
  assert.match(readFileSync("convex/schema.ts", "utf8"), /pageOne: v\.optional\(v\.object\(\{ version: v\.number\(\), checkedAt: v\.number\(\), rankable: v\.boolean\(\)/);
});

test("the rule a topic must pass, and where it runs first", () => {
  const now = 1_793_900_000_000, winnable = { version: PAGE_ONE_CHECK_VERSION, checkedAt: now - 3_600_000, rankable: true, reason: "", siteAuthority: 4,
    reachable: 3, measured: 10, results: 10, medianAuthority: 18 };
  const kept = { eligible: true };
  assert.equal(topicWritable({ buyerFit: kept, pageOne: winnable }, now), true);
  assert.equal(topicWritable({ pageOne: winnable }, now), false, "unjudged: word matching alone never admits a topic");
  assert.equal(topicWritable({ buyerFit: { eligible: false }, searchConsolePosition: 4 }, now), false, "a non-buyer search, even one the site already ranks for");
  assert.equal(topicWritable({ buyerFit: kept, searchConsolePosition: 12 }, now), true, "Search Console shows the site at 12: no check needed");
  assert.equal(topicWritable({ buyerFit: kept }, now), false, "unchecked waits for its check");
  assert.equal(topicWritable({ buyerFit: kept, pageOne: winnable, groupBrake: { braked: true, checkedAt: now - 3_600_000 } }, now), false, "the brake holds");
  assert.equal(topicWritable({ buyerFit: kept, pageOne: winnable, groupBrake: { braked: true, checkedAt: now - 3 * 86_400_000 } }, now), true,
    "a brake the sweep stopped renewing lapses");
  assert.deepEqual(["pentra.dev", "https://www.leadpilot.chat/", "LeadPilot.chat", "quillpad.example", "notpentra.dev"].map(topicChoiceRollout), [true, true, true, false, false]);
});

test("P364: a rollout site's unwritten slot is explained as no winnable search yet, never 'ran out of topics'", async () => {
  const { missedSlotCause, missedSlotEmail } = await import("../convex/lib/customerNotices.ts");
  const base = { destinationVerified: true, plannedTopics: 0, failure: null };
  assert.equal(missedSlotCause({ ...base, phaseTwo: true }), "no_winnable");
  assert.equal(missedSlotCause(base), "no_topics", "other sites keep today's wording");
  const email = missedSlotEmail({ domain: "pentra.dev", deadlineAt: 1_793_900_000_000, timeZone: "UTC", cause: "no_winnable" });
  assert.match(email.text, /found no search your customers make that your site can win on Google's first page yet, so it wrote nothing rather than a page nobody would see/);
  assert.match(readFileSync("convex/contentHealth.ts", "utf8"), /phaseTwo: topicChoiceRollout\(site\.domain\) \}\) \}\);/);
});
