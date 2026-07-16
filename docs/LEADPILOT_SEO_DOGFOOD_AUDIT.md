# LeadPilot SEO Dogfood Audit

Audit date: 2026-07-16

## Purpose

LeadPilot is Pentra's first controlled production case study. The program has
two linked goals:

1. Grow qualified, non-branded organic traffic to LeadPilot.
2. Improve Pentra until its autonomous output is safe, useful, measurable, and
   reproducible for customers.

Publishing volume is not a success metric. The outcome chain is:

`measured opportunity -> useful article -> indexed page -> search impressions
-> organic clicks -> engaged visit -> LeadPilot signup or qualified action`

## Executive Verdict

Pentra has a credible end-to-end SEO architecture, but its previous media and
editorial output was not consistently production-grade. The renderer and
publishing integration were stronger than the generated content entering them.

The July 16 quality rebuild corrects the known failure modes:

- LeadPilot topics must have real DataForSEO metrics; AI-only topics are
  rejected rather than disguised as measured opportunities.
- A people-first editorial pass removes filler, unsupported product claims,
  fabricated outcomes, malformed tables, and repetitive promotion.
- The final stored prose receives a second factual review.
- Generated images are independently reviewed before storage.
- Product screenshots must show the real site, not a loading screen or
  screenshot-service placeholder.
- Supporting images must explain one exact article section.
- At most one verified YouTube video may appear, and only when it directly
  teaches an exact section.
- LeadPilot publication is blocked unless strict factual, editorial, media,
  metadata, source, and rendering checks pass.

Autopilot remains off until a new article clears human inspection of this full
contract. Passing one article proves the pipeline is usable, not that SEO
growth is proven.

## Production Sample Findings

### Held replacement article

The held article, `Lead Qualification Chatbot: How to Reduce Sales Friction &
Accelerate Deals`, failed as a production sample even though its internal
content score looked acceptable.

Observed problems:

- more than 4,000 words for a topic that did not justify that length;
- generic and repetitive prose;
- unsupported product behavior, metrics, timelines, and sales frameworks;
- malformed Markdown table structure;
- duplicated promotional calls to action;
- vendor evidence treated too broadly;
- two adjacent YouTube embeds selected from topical proximity rather than
  section-level usefulness;
- a fabricated software-style hero image with malformed interface details;
- a generic text-heavy supporting graphic;
- a screenshot-service loading screen stored as a product screenshot.

The article was never published and remains evidence for the quality gate.

### Existing live LeadPilot articles

Two Pentra-origin articles are currently visible:

- `capture-website-leads-automatically`
- `qualify-leads-in-real-time`

Their prose is materially cleaner than the held article: roughly 1,500 words,
valid metadata, multiple source domains where claims are used, useful
frameworks/checklists, valid canonical URLs, Article structured data, and no
malformed tables or irrelevant video embeds.

Their hero images still need migration. Both images depict invented software
interfaces rather than real LeadPilot screens or honest editorial concepts.
They are visually polished but not trustworthy product evidence.

## Process Audit

### 1. Opportunity and topic selection

What works:

- the business and audience profile comes from a crawl of the customer's site;
- DataForSEO supplies search volume, difficulty, CPC, trends, SERP results,
  competitor gaps, and authority context;
- candidates are deduplicated and checked against existing article targets;
- low-authority sites receive a more conservative difficulty ceiling;
- LeadPilot refuses to create an AI-only plan when measured data is absent.

What still requires observation:

- the opportunity score is a prioritization heuristic, not a traffic promise;
- search volume can be sparse or rounded, especially for long-tail terms;
- a high-scoring keyword still fails if the search intent cannot be satisfied
  better than the current results;
- keyword metrics must be stored beside the selected topic so later traffic can
  be compared with the original decision.

### 2. Research and factual grounding

The research stage now prefers primary evidence, official documentation,
original research, standards, and first-party product pages. A final factual
review removes unsupported claims and must score at least 85 for LeadPilot.

Rules:

- model confidence is not factual proof;
- product features require first-party product evidence;
- customer outcomes, percentages, quotes, and timelines cannot be invented;
- vendor anecdotes cannot become universal claims;
- quantified claims require inline evidence and a valid source list.

### 3. Article usefulness

The final editorial stage is accountable for the reader, not a word-count or
keyword-density target. A publishable article must:

- answer the primary question near the beginning;
- cover the intent completely without padding;
- add a useful framework, worked example, comparison, template, or checklist;
- distinguish fact, recommendation, and product capability;
- use natural topic language instead of repeating an exact phrase on a fixed
  schedule;
- contain no malformed Markdown, repetitive CTA, or generic AI filler;
- score at least 85 in the editorial review.

LeadPilot now uses format-specific hard ceilings: 2,400 words for checklists,
2,600 for standard articles, 2,800 for how-to guides, 3,000 for comparisons,
3,200 for listicles/roundups, and 3,600 for a justified ultimate guide. These
are ceilings, not targets. An upstream compression pass runs before storage;
missing the ceiling blocks publication rather than normalizing a bloated draft.

### 4. Hero images

Previous behavior could create attractive but fabricated interfaces. The new
contract requires:

- no readable text, labels, logos, trademarks, or watermarks;
- no fake dashboard, browser, product UI, or chat transcript;
- no malformed anatomy, screens, devices, or objects;
- an honest real-world or conceptual editorial image;
- independent visual review with a score of at least 85 before storage.

A missing hero is a warning. A deceptive hero is a publication failure.

### 5. Supporting images

The old generic infographic path is retired. A supporting visual is generated
only when an art-direction pass identifies one exact H2 section that would
benefit from a text-free explanation. It must provide:

- an exact target section;
- a specific, non-factual visual concept;
- descriptive alt text based on visible content;
- an optional concise editorial caption.

Text-heavy diagrams, statistics, fake UI, and decorative technology scenes are
rejected.

### 6. Product screenshots

Screenshots are useful only as truthful product evidence. The screenshot path
now retries capture and rejects:

- loading states and spinners;
- blank or mostly empty pages;
- screenshot-service branding;
- error pages, cookie walls, and bot challenges;
- unrelated sites or pages where the expected product is not recognizable.

The screenshot is inserted only when the article contains a genuinely relevant
product section. Failure to capture a valid screenshot does not block an
otherwise useful article; no placeholder is substituted.

### 7. YouTube embeds

Video is optional. Pentra verifies candidate IDs through YouTube metadata and
then permits at most one video when it scores at least 85 for direct relevance
to an exact article section. Generic lead generation, broad automation, or
promotional videos are omitted. The review log records candidate titles and
the acceptance or rejection reason. Accepted embeds use YouTube's
privacy-enhanced domain. Videos do not count as original LeadPilot evidence and
should never be used merely to make a page look rich.

### 8. Renderer and technical SEO

LeadPilot already provides a solid last mile:

- canonical URLs;
- Article JSON-LD;
- Open Graph and Twitter metadata;
- sitemap inclusion;
- server-rendered article pages;
- responsive images;
- privacy-enhanced, lazy YouTube embeds;
- crawlable contextual internal links;
- a strict Pentra frontmatter contract.

The remaining trust improvement is visible editorial authorship and a public
editorial process page. Structured authorship must match what the reader can
see.

## Modern Search Guidance Mapping

The production contract follows the durable parts of current Google Search
guidance:

- create people-first content with original value and complete intent
  satisfaction;
- explain who created content, how it was created, and why it exists;
- use generative AI to assist quality, not to mass-produce low-value pages;
- place high-quality images near relevant text with descriptive alt text;
- embed video only when it materially supports the page;
- use visible, accurate authorship and valid Article structured data;
- use crawlable links with descriptive anchors in relevant context;
- avoid arbitrary word counts, keyword-density targets, and scaled content
  without added value.

Reference documentation:

- https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- https://developers.google.com/search/docs/appearance/google-images
- https://developers.google.com/search/docs/appearance/video
- https://developers.google.com/search/docs/appearance/structured-data/article
- https://developers.google.com/search/docs/crawling-indexing/links-crawlable

## Publication Gate

A new LeadPilot article may publish only when all of the following are true:

1. Its exact primary keyword has measured DataForSEO lineage.
2. Search intent and article format match the live SERP.
3. The article is at least 900 useful words and below its review ceiling.
4. Metadata is complete, restrained, and free of unsupported outcomes.
5. Fact-check score is at least 85.
6. Editorial quality score is at least 85.
7. Quantified claims have matching inline evidence.
8. Markdown tables, links, sources, images, and embeds validate.
9. Every attached image passed independent visual review.
10. There is no more than one directly relevant YouTube video.
11. The destination URL, canonical, sitemap, and public render are verified.
12. The article receives manual inspection during the dogfood phase.

Strict metadata is regenerated from the final edited article, not retained
from the first draft. It must contain a complete description, cannot introduce
a stale year, and cannot turn an article claim into an unsupported search-result
promise.

## Controlled Generation Findings

Four review-only generation attempts were run on the measured keyword
`chatbot for lead generation` (monthly volume 170, keyword difficulty 16, and
CPC 17.68 in the configured DataForSEO market). Autopilot remained off and no
attempt was published.

1. The first attempt exposed malformed long-form JSON transport. Article
   generation now uses forced structured tool output rather than embedding
   Markdown inside hand-escaped JSON.
2. The second attempt proved the article path but exposed unsupported strict
   JSON schema constraints. It also confirmed that the real LeadPilot
   screenshot path works: the captured 1280x853 homepage was current,
   recognizable, and free of placeholder or screenshot-service UI.
3. The third attempt scored 87 editorial and 92 factual, but still failed the
   accountable human audit. It was 3,630 words, used weak vendor/secondary
   evidence for broad performance claims, introduced stale `2024` metadata,
   ended its meta description mid-thought, and mistakenly removed the allowed
   LeadPilot product section. Generated hero/supporting images were correctly
   rejected for readable text or fabricated UI; no YouTube candidate cleared
   relevance. This demonstrated that model scores alone are not a publication
   verdict.

The resulting upstream fixes are now part of the contract:

- strict evidence separates primary/official material from vendor articles;
- vendor sources cannot support universal numerical outcome claims;
- LeadPilot is explicitly allowed as the first-party product during review;
- competitor scrubbing uses neutral category language instead of fabricating
  LeadPilot claims;
- metadata is regenerated from final prose;
- format-specific length ceilings run before publication;
- media omission reasons remain visible in the article audit record.

4. The fourth attempt tested the rebuilt exact-prose audit and one bounded
   remediation pass. It received an initial accountable score of 78 and a
   post-remediation score of 82, so it remained in review. The article still
   contained unsupported operational numbers, scoring thresholds, timelines,
   and an unlabeled invented sales conversation. Its meta description ended in
   the broken phrase `with full.`. The real LeadPilot homepage screenshot
   passed review, but two hero attempts and one supporting visual were rejected
   as ambiguous, misleading, or visually malformed. Three YouTube candidates
   were reviewed and all were omitted because none directly taught a section.
   No media or article was forced into production.

This fourth attempt exposed an older prompt architecture beneath the newer
quality gates. Pentra was still asking writers for fixed TL;DR blocks, tables of
contents, FAQ counts, link quotas, snippet-sized paragraphs, AI Overview
patterns, entity coverage, and target word ranges. Those instructions rewarded
formulaic completeness rather than reader value and created many of the defects
the final editor then had to remove.

The prompt architecture is now intent-led across every customer site:

- article formats describe the reader decision or workflow instead of a fixed
  section and item count;
- there is no target word count, keyword density, outbound-link quota, FAQ
  quota, or mandatory table of contents;
- People Also Ask questions are optional context rather than required headings;
- numeric guidance must be directly evidenced and cited, including operational
  thresholds, timelines, prices, ranges, scores, and counts;
- invented scenarios must be labelled hypothetical;
- a deterministic evidence scan supplies exact offending paragraphs to the one
  bounded remediation pass and caps the article below 85 while any remain;
- metadata is cleaned as a complete sentence even when it is already below the
  character limit;
- strict sites spend on generated media only after the exact prose clears both
  factual and editorial gates.

This changes the role of media as well. A real product screenshot can be useful
first-party evidence. Generated hero art and embedded video are optional
editorial aids, not SEO completeness signals. Omitting weak media is a quality
success, not a failed generation.

## Traffic Scorecard

Google Search Console must become the source of truth for search outcomes.
Google Analytics measures on-site behavior and business actions.

Per page and per topic cluster, record:

- publication and first-indexed date;
- target keyword, original volume, difficulty, CPC, intent, and location;
- indexed status and canonical selected by Google;
- non-branded impressions;
- non-branded clicks;
- CTR and average position;
- count of distinct non-branded queries receiving impressions;
- organic sessions and engaged sessions;
- visits from article to product, pricing, and sign-up pages;
- LeadPilot conversations, qualified actions, signups, and paid conversions
  attributable to organic sessions.

Review windows:

- 7 days: publication, crawl, indexation, and technical errors;
- 14 days: initial query/impression discovery, not a traffic verdict;
- 28 days: leading comparison of impressions, clicks, CTR, and engagement;
- 56 days: first meaningful article/cluster outcome review;
- quarterly: retention, conversion, content decay, and refresh decisions.

No article is called successful because it was generated, published, indexed,
or scored highly. Success means it earns relevant search visibility and useful
business actions. Pentra's product claim strengthens only when that result
repeats across multiple articles and more than one site.

## Immediate Activation Sequence

1. Deploy the quality rebuild.
2. Preserve the rejected article and old images as audit evidence.
3. Generate one measured LeadPilot topic and article with autopilot off.
4. Inspect the full prose, every source, hero, supporting visual, screenshot,
   video, internal link, metadata field, and production render.
5. Publish only if every gate passes.
6. Connect LeadPilot to Google Search Console and record the baseline.
7. Observe the first article before increasing cadence.
8. Replace the two existing fabricated-interface hero images with reviewed,
   truthful editorial assets.
9. Enable controlled autopilot only after repeated clean output.
