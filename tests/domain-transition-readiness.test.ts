import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  contentAnalysisMatchesCurrentDomain,
  gscConnectionMatchesCurrentDomain,
  gscPropertyMatchesCanonicalDomain,
  nextCanonicalDomainRevision,
  pageMatchesCurrentDomain,
  siteUsesLegacyGscRows,
  takeCurrentDomainTopics,
  topicMatchesCurrentDomain,
} from "../convex/lib/siteDomainBinding.ts";

const sites = readFileSync("convex/sites.ts", "utf8");
const pages = readFileSync("convex/pages.ts", "utf8");
const topics = readFileSync("convex/topics.ts", "utf8");
const jobs = readFileSync("convex/jobs.ts", "utf8");
const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
const searchPerformance = readFileSync("convex/searchPerformance.ts", "utf8");
const gscCallback = readFileSync("src/app/api/gsc/callback/route.ts", "utf8");

test("legacy receipts remain valid only before the first canonical-domain transition", () => {
  const legacySite = {
    domain: "https://www.alpha.example/",
    siteSummary: "Alpha",
    gscAccessToken: "secret",
    gscProperty: "sc-domain:alpha.example",
  };
  assert.equal(contentAnalysisMatchesCurrentDomain(legacySite), true);
  assert.equal(
    pageMatchesCurrentDomain(legacySite, {
      url: "https://alpha.example/pricing",
    }),
    true,
  );
  assert.equal(topicMatchesCurrentDomain(legacySite, {}), true);
  assert.equal(gscConnectionMatchesCurrentDomain(legacySite), true);

  const explicitRevisionZero = {
    ...legacySite,
    canonicalDomainRevision: 0,
  };
  assert.equal(contentAnalysisMatchesCurrentDomain(explicitRevisionZero), false);
  assert.equal(
    pageMatchesCurrentDomain(explicitRevisionZero, {
      url: "https://alpha.example/pricing",
    }),
    false,
  );
  assert.equal(topicMatchesCurrentDomain(explicitRevisionZero, {}), false);
  assert.equal(gscConnectionMatchesCurrentDomain(explicitRevisionZero), false);

  const transitioned = { ...legacySite, canonicalDomainRevision: 1 };
  assert.equal(contentAnalysisMatchesCurrentDomain(transitioned), false);
  assert.equal(
    pageMatchesCurrentDomain(transitioned, {
      url: "https://alpha.example/pricing",
    }),
    false,
  );
  assert.equal(topicMatchesCurrentDomain(transitioned, {}), false);
  assert.equal(gscConnectionMatchesCurrentDomain(transitioned), false);
});

test("fresh same-domain GSC OAuth hides raw legacy rows before pruning", () => {
  assert.equal(siteUsesLegacyGscRows({}), true);
  // An access-token refresh on the same pre-contract connection stamps the
  // effective legacy generation (0). If the following sync fails before its
  // receipt commits, the existing authoritative raw rows must remain visible.
  assert.equal(
    siteUsesLegacyGscRows({ gscConnectionRevision: 0 }),
    true,
  );
  // A fresh OAuth establishment advances 0 -> 1, so rows from the old
  // connection disappear before asynchronous pruning completes.
  assert.equal(
    siteUsesLegacyGscRows({ gscConnectionRevision: 1 }),
    false,
  );
  assert.equal(
    siteUsesLegacyGscRows({ canonicalDomainRevision: 0 }),
    false,
  );
  assert.equal(
    siteUsesLegacyGscRows({
      canonicalDomainRevision: undefined,
      gscConnectionRevision: undefined,
    }),
    true,
  );

  assert.doesNotMatch(searchPerformance, /siteUsesLegacyDomainReceipts/);
  assert.ok(
    (searchPerformance.match(/siteUsesLegacyGscRows\(site\)/g) ?? []).length >= 6,
  );
});

test("only exact domain-and-revision receipts authorize the renamed tenant", () => {
  const site = {
    domain: "beta.example",
    canonicalDomain: "beta.example",
    canonicalDomainRevision: 1,
    contentAnalysisCanonicalDomain: "beta.example",
    contentAnalysisDomainRevision: 1,
    gscAccessToken: "secret",
    gscProperty: "sc-domain:beta.example",
    gscCanonicalDomain: "beta.example",
    gscDomainRevision: 1,
  };
  assert.equal(contentAnalysisMatchesCurrentDomain(site), true);
  assert.equal(
    pageMatchesCurrentDomain(site, {
      url: "https://beta.example/",
      canonicalDomain: "beta.example",
      domainRevision: 1,
    }),
    true,
  );
  assert.equal(
    topicMatchesCurrentDomain(site, {
      planningCanonicalDomain: "beta.example",
      planningDomainRevision: 1,
    }),
    true,
  );
  assert.equal(gscConnectionMatchesCurrentDomain(site), true);

  assert.equal(
    topicMatchesCurrentDomain(site, {
      planningCanonicalDomain: "alpha.example",
      planningDomainRevision: 0,
    }),
    false,
  );
  assert.equal(
    pageMatchesCurrentDomain(site, {
      url: "https://beta.example/",
      canonicalDomain: "beta.example",
      domainRevision: 0,
    }),
    false,
  );
});

test("A to B to A cannot resurrect the first A epoch", () => {
  const returnedToA = {
    domain: "alpha.example",
    canonicalDomain: "alpha.example",
    canonicalDomainRevision: 2,
  };
  assert.equal(nextCanonicalDomainRevision({ canonicalDomainRevision: 1 }), 2);
  assert.equal(
    pageMatchesCurrentDomain(returnedToA, {
      url: "https://alpha.example/",
      canonicalDomain: "alpha.example",
      domainRevision: 0,
    }),
    false,
  );
  assert.equal(
    topicMatchesCurrentDomain(returnedToA, {
      planningCanonicalDomain: "alpha.example",
      planningDomainRevision: 0,
    }),
    false,
  );
});

test("quarantined history cannot consume the active topic read limit", async () => {
  const current = [{
    _id: "current-topic",
    siteId: "site-1",
    planningCanonicalDomain: "beta.example",
    planningDomainRevision: 1,
  }];
  const legacy = Array.from({ length: 2_001 }, (_, index) => ({
    _id: `legacy-${index}`,
    siteId: "site-1",
  }));
  let legacyReads = 0;
  const ctx = {
    db: {
      query: () => ({
        withIndex: (indexName: string) => {
          const rows = indexName === "by_site_domain_revision"
            ? current
            : legacy;
          if (indexName === "by_site") legacyReads += 1;
          const ordered = {
            take: async (limit: number) => rows.slice(0, limit),
          };
          return { order: () => ordered };
        },
      }),
    },
  } as unknown as Parameters<typeof takeCurrentDomainTopics>[0];

  const topics = await takeCurrentDomainTopics(
    ctx,
    {
      _id: "site-1",
      domain: "beta.example",
      canonicalDomain: "beta.example",
      canonicalDomainRevision: 1,
    } as Parameters<typeof takeCurrentDomainTopics>[1],
    2_001,
  );
  assert.deepEqual(topics, current);
  assert.equal(legacyReads, 0);
});

test("Search Console binding accepts only the exact canonical whole-site property", () => {
  assert.equal(
    gscPropertyMatchesCanonicalDomain("sc-domain:alpha.example", "alpha.example"),
    true,
  );
  assert.equal(
    gscPropertyMatchesCanonicalDomain("https://alpha.example/", "alpha.example"),
    true,
  );
  for (const property of [
    "sc-domain:www.alpha.example",
    "sc-domain:alpha.example/path",
    "https://www.alpha.example/",
    "http://alpha.example/",
    "https://alpha.example/blog/",
    "https://alpha.example/?q=1",
  ]) {
    assert.equal(
      gscPropertyMatchesCanonicalDomain(property, "alpha.example"),
      false,
      property,
    );
  }
});

test("domain-derived writes use exact CAS and all scheduler reads reject stale receipts", () => {
  assert.match(sites, /function canonicalDomainTransitionPatch/);
  assert.match(sites, /canonicalDomainRevision: nextCanonicalDomainRevision\(site\)/);
  assert.ok((sites.match(/canonicalDomainTransitionPatch\(/g) ?? []).length >= 4);
  assert.match(sites, /gscAccessToken: undefined/);
  assert.match(sites, /gscRefreshToken: undefined/);
  assert.match(sites, /contentAnalysisCanonicalDomain: undefined/);
  assert.match(sites, /gscConnectionMatchesCurrentDomain\(site\)/);
  assert.match(sites, /legacyEpoch\.find\(\(page\) => pageMatchesCurrentDomain\(site, page\)\)/);
  assert.match(sites, /const currentTopics = await takeCurrentDomainTopics\(ctx, site, 50\)/);
  assert.match(sites, /domainRevisionSnapshot/);

  assert.match(pages, /expectedCanonicalDomain: v\.string\(\)/);
  assert.match(pages, /expectedDomainRevision: v\.number\(\)/);
  assert.match(pages, /pageMatchesCurrentDomain\(site, page\)/);
  assert.match(topics, /topicMatchesCurrentDomain\(site, topic\)/);
  assert.match(topics, /planningCanonicalDomain: canonicalDomain/);
  assert.match(jobs, /jobAuthorizedForExecution/);
  assert.match(jobs, /takeCurrentDomainTopics/);
  assert.match(pipeline, /contentAnalysisCanonicalDomain: expectedCanonicalDomain/);
  assert.match(pipeline, /Site domain changed during website analysis/);
  assert.match(searchPerformance, /assertCurrentGscDomainBinding/);
  assert.match(searchPerformance, /gscConnectionMatchesCurrentDomain\(site\)/);
  assert.ok(
    (searchPerformance.match(/assertCurrentGscDomainBinding\(/g) ?? [])
      .length >= 5,
  );
  assert.match(searchPerformance, /expectedConnectionRevision: v\.number\(\)/);
  assert.ok(
    (sites.match(/cancelAutonomousJobsForEpochTransition\([\s\S]{0,180}authorityDomainChanged/g) ?? [])
      .length >= 2,
  );
});

test("GSC OAuth verifies the signed domain snapshot before exchange and again at persistence", () => {
  const ownership = gscCallback.indexOf("const site = await getOwnedSite(siteId)");
  const domainFence = gscCallback.indexOf(
    "expectedCanonicalDomain !== currentCanonicalDomain",
  );
  const exchange = gscCallback.indexOf("https://oauth2.googleapis.com/token");
  const save = gscCallback.indexOf('callPentraInternal("/internal/oauth/gsc"');
  assert.ok(ownership >= 0);
  assert.ok(domainFence > ownership);
  assert.ok(exchange > domainFence);
  assert.ok(save > exchange);
  assert.match(gscCallback, /expectedCanonicalDomain,/);
  assert.match(gscCallback, /expectedDomainRevision,/);

  const setToken = sites.slice(sites.indexOf("export const setGscTokenInternal"));
  assert.match(setToken, /expectedCanonicalDomain: v\.string\(\)/);
  assert.match(setToken, /expectedDomainRevision: v\.number\(\)/);
  assert.match(setToken, /gscPropertyMatchesCanonicalDomain/);
  assert.match(setToken, /gscCanonicalDomain: canonicalDomain/);
  assert.match(setToken, /gscDomainRevision: expectedDomainRevision/);
});
