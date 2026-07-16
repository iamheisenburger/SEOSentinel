# Pentra Standby and Dogfood Plan

## Product Role

Pentra remains a meaningful product, but it is not the current primary
monetization project. LeadPilot is the commercial priority. Pentra's immediate
role is to become LeadPilot's measurable SEO engine so that:

1. LeadPilot receives useful organic distribution.
2. Pentra is tested on a real business with complete access to its data.
3. Every weakness is discovered before Pentra is sold aggressively.
4. Pentra eventually has an honest first-party case study.

Do not start publishing more Pentra-generated content for LeadPilot until the
integrity and publishing work below is complete.

## What Is Already Real

Pentra is not a thin article wrapper. Its code contains an end-to-end content
system:

- website crawl and business-profile extraction;
- DataForSEO keyword discovery, search volume, keyword difficulty, CPC, SERP,
  competitor-gap, backlink, and rank data;
- keyword scoring and content-plan generation;
- researched article generation with images, videos, links, and schema;
- scheduled publishing through supported destinations;
- Google Search Console and rank monitoring;
- content-decay detection and refresh workflows;
- syndication and backlink-analysis workflows.

The central risk is not missing features. It is an incomplete chain of proof
from measured keyword to customer traffic and revenue.

## Audit Baseline

Audit date: 2026-07-13.

- The local checkout had 13 generated MDX articles.
- GitHub `main` was 100 commits ahead and had 113 generated MDX articles.
- The 100 remote-only commits added articles, not application-code changes.
- The application build passed.
- There was no meaningful automated test suite.
- The public blog queried Convex, while generated articles were committed to
  `content/blog`. This left the public Pentra blog empty despite generated
  content existing in GitHub.
- All 113 GitHub articles contained malformed `https://https://pentra.dev`
  structured-data URLs at audit time.
- Generated articles included unsupported product statistics, customer claims,
  and SEO assertions presented with excessive confidence.

These facts mean publication count cannot be treated as evidence of product
quality or SEO performance.

## Known Product Gaps

### 1. Keyword lineage is not sufficiently auditable

The DataForSEO path is genuine, but it can fall back or drift:

- fewer than ten discovered keywords triggers an AI-first topic path;
- up to three topics without metrics may survive;
- a 50% fuzzy keyword overlap may inherit another keyword's metrics;
- the customer cannot easily inspect the full decision lineage.

Every topic needs a durable record containing:

- crawl/profile version;
- seed keyword;
- exact DataForSEO keyword and response timestamp;
- location and language;
- volume, difficulty, CPC, intent, trend, and SERP competitors;
- scoring formula and score;
- why the topic was selected or rejected;
- whether any fallback or fuzzy match occurred.

No UI should display AI-estimated data as measured DataForSEO data.

### 2. Article quality is not release-grade

The autonomous publisher needs deterministic pre-publication gates:

- every factual claim must map to a source excerpt;
- product/customer claims require first-party evidence;
- quotations must be verified or removed;
- schema must validate and use canonical URLs;
- Markdown tables, links, images, headings, and video embeds must render;
- dates, tools, services, and SEO advice must be current;
- no invented percentages, customers, testimonials, or outcomes;
- no generic article should publish unless it adds original information,
  first-party data, analysis, or a genuinely useful asset.

Confidence scores are internal model assessments, not proof of factual
accuracy. Do not market a model confidence average as a fact-check accuracy
rate without a labeled benchmark.

### 3. The publication paths are disconnected

Choose one authoritative content source and make every destination consume it.
For Pentra and LeadPilot dogfooding, a generated article must become visible on
the public site, canonicalized, included in the sitemap, and eligible for
indexing in the same workflow. A Git commit alone is not publication.

### 4. The customer outcome is not proven

The product must report a real funnel:

`measured keyword -> approved article -> published URL -> indexed URL -> GSC
impressions -> clicks -> qualified website action`

Article count, word count, or model confidence are not customer outcomes.

### 5. Claims exceed implemented behavior

Pentra can analyze backlinks and recommend outreach, but that is not equivalent
to acquiring backlinks automatically. Product copy must distinguish analysis,
recommendation, outreach assistance, syndication, and verified acquired links.

## LeadPilot Dogfood Protocol

### Phase 0: Integrity

1. Synchronize the working checkout with GitHub without losing generated data.
2. Fix the public-blog/content-source mismatch.
3. repair canonical and schema URL construction;
4. add render, schema, source, and unsupported-claim validation;
5. add tests for keyword lineage and publication;
6. stop any schedule from publishing content that has not passed the gates.

### Phase 1: Baseline

Before publishing new LeadPilot content, capture:

- indexed pages;
- GSC impressions and clicks by query/page;
- branded versus non-branded traffic;
- average position and CTR;
- signups, qualified leads, and paid conversions from organic sessions.

### Phase 2: Controlled content program

- Build a small number of coherent topic clusters around LeadPilot's actual
  buyer problems.
- Prefer original assets: conversation-evaluation data, conversion experiments,
  implementation benchmarks, and website-agent teardown studies.
- Start with quality, not volume. Each article requires manual-quality review
  until the automated gate has demonstrated reliability.
- Preserve rejected topics and articles so the system can learn without
  silently rewriting history.

### Phase 3: Measurement

For every article, monitor publication, indexation, query impressions, clicks,
engaged sessions, LeadPilot conversations, qualified leads, and signups. Keep
the source keyword metrics beside the observed results.

## Promotion Criteria for Pentra Monetization

Pentra is ready to become an active commercial priority only when:

1. every published article has auditable keyword and source lineage;
2. automated quality checks catch known schema, citation, rendering, and claim
   failures;
3. Pentra can publish reliably to the public destination and verify indexation;
4. LeadPilot dogfooding shows reproducible non-branded impression and click
   growth across more than one topic cluster;
5. the reporting distinguishes activity from outcomes;
6. customer-facing claims are supported by first-party evidence;
7. at least one external pilot reproduces the workflow without bespoke manual
   intervention.

## Product Positioning When Revisited

Avoid selling "AI articles." Sell a measurable SEO operating system:

> Pentra finds evidence-backed opportunities, publishes useful original
> content, monitors what Google does with it, and improves the content based on
> observed search performance.

Until the evidence exists, Pentra stays a valuable internal engine and product
candidate, not a proven traffic-growth promise.

## Implementation Status: 2026-07-16

The LeadPilot cutover is now implemented and deployed.

- LeadPilot reads only `content/blog` articles with the explicit Pentra
  publication contract: `generator: pentra`, `status: published`, and
  `qualityGateVersion >= 1`.
- The SEObot runtime client and dependency were removed. Its nine public article
  URLs permanently redirect to the two retained Pentra articles so existing
  links do not become dead ends.
- Pentra now applies deterministic publication checks for article thickness,
  metadata, source URLs, quantified claims, scripts, iframes, featured images,
  and fact-check completion. LeadPilot uses strict mode.
- GitHub publication emits canonical LeadPilot MDX metadata instead of embedded
  raw structured-data scripts. LeadPilot owns canonical and Article JSON-LD
  rendering.
- Article generation prompts no longer require invented statistics,
  testimonials, quotations, or forced product mentions. Generated images are
  preferred over hotlinked search-result images.
- LeadPilot is registered in production Pentra at two articles per week with
  approval required and autopilot disabled during dogfood validation.
- LeadPilot requires verified keyword data. If DataForSEO is unavailable or
  returns no measured keywords, Pentra refuses to save an AI-only content plan.
- DataForSEO keyword seeds are batched into one request instead of issuing up to
  fifteen separately billable requests. Domain authority now uses the current
  backlinks summary endpoint.
- Production verification confirmed two Pentra articles, valid canonical
  metadata, Article JSON-LD, working images, and all nine legacy redirects.

The remaining activation blocker is operational, not architectural:
DataForSEO currently returns HTTP 402. Fund that account, generate a fresh
measured topic plan, review the first article end to end, and only then enable
LeadPilot autopilot. Do not bypass the verified-keyword gate to manufacture
publishing activity.
