# SEOSentinel — Project Notes

## Publishing Integrations (TODO)

SEOSentinel currently only publishes via GitHub commit. Need to add multi-platform publishing like SEOBot does:

### Target Platforms
- **Next.js** (current — via GitHub commit to content/posts/)
- WordPress.org (self-hosted REST API)
- WordPress.com (hosted REST API)
- Webflow (CMS API)
- Ghost (Admin API)
- Shopify (Blog API)
- Framer (CMS API)
- HubSpot (Blog API)
- Wix (Blog API)
- Squarespace (Blog API)
- Notion (as content database)
- REST API (generic webhook — user provides endpoint)
- Webhook (fire-and-forget POST with article payload)

### How to implement
Each integration needs:
1. An API key/token stored per-site in Convex (or env vars for single-tenant)
2. A publisher adapter that formats the article (MDX, HTML, JSON) for the target platform
3. A platform-specific commit/POST function
4. Error handling + retry logic

### Architecture
- `convex/publishers/` folder with one file per platform
- `convex/publishers/index.ts` — router that picks the right publisher based on site config
- Site schema needs a `publishTarget` field (e.g., "github", "wordpress", "ghost", etc.)
- Site schema needs platform-specific config (API key, endpoint URL, content path, etc.)

### Terms & Conditions (from SEOBot — adapt for SEOSentinel)
When users connect a publishing integration, they must accept:
- AI-generated content may include inaccuracies — user responsible for review
- Autopublish means articles post without prior manual review (unless approval gates are on)
- User is solely responsible for moderating content quality
- SEOSentinel gets API access to their blog for syncing
- User should backup their data before enabling sync
- User can disconnect at any time; previously published articles remain
- SEOSentinel not liable for damage, data loss, or issues from sync

## Cross-Project Correlation: LeadPilot Agent Deployment

The EXACT same platforms and integration pattern applies to LeadPilot's chat widget deployment.
Currently LeadPilot deploys via a raw `<script>` tag embed. Native platform integrations
would be a massive upgrade — easier install, better trust, app store distribution.

### Platform-by-platform mapping

| Platform | SEOSentinel (publish article) | LeadPilot (deploy agent) |
|---|---|---|
| WordPress.org | REST API → create post | WordPress plugin → inject widget script in footer |
| WordPress.com | REST API → create post | WordPress.com embed block or custom HTML widget |
| Shopify | Storefront Blog API | Shopify App → ScriptTag API injects widget sitewide |
| Webflow | CMS Collection API | Custom code in site settings (Project Settings → Custom Code) |
| Ghost | Admin API → create post | Code injection (Ghost Admin → Settings → Code injection) |
| Framer | CMS API | Custom code component or embed |
| Wix | Blog API | Velo custom element or Wix App Market |
| Squarespace | Blog API | Code injection (Settings → Advanced → Code Injection) |
| HubSpot | Blog API | HubSpot App Marketplace or tracking code injection |
| Next.js | GitHub commit to content/posts/ | npm package (`@leadpilot/widget`) or script tag |
| Generic | REST API / Webhook | Script tag (current approach) |

### Shared infrastructure
- **OAuth / API key storage** — same pattern for both projects (per-user, encrypted, stored in Convex)
- **Platform adapters** — abstract interface: `publish(content, config)` / `deploy(widgetConfig, config)`
- **T&Cs / consent flow** — same legal framework for third-party access
- **Connection UI** — same "Connect to [Platform]" modal pattern with platform logos

### Build order
1. Build the adapter pattern for SEOSentinel publishing first (simpler — just POST content)
2. Port the pattern to LeadPilot for widget deployment (needs platform-specific injection)
3. WordPress plugin and Shopify app are highest ROI — largest user base
4. The rest can use generic script tag / code injection instructions

## Research Model
- Using `o4-mini-deep-research-2025-06-26` for web research (OpenAI)
- Using `claude-haiku-4-5-20251001` for article generation and fact-checking (Anthropic)

## SEOBot Reverse Engineering — Article Pipeline

Analyzed SEOBot's first published article for leadpilot.chat: "How to Qualify Leads Automatically on Your Website"

### What SEOBot generates per article

**SEO Metadata:**
- Title (H1 matches meta title)
- Keyword-optimized slug (`automated-lead-qualification-website`)
- Meta description (action-oriented, 160 chars, includes target keyword)
- Meta keywords (8 target keywords: "automatic lead qualification, AI lead scoring, ...")
- Single category ("Marketing Automation")
- 3 tags ("Lead Generation", "Marketing Automation", "Sales Enablement")
- Featured image (AI-generated, served from their CDN with quality/resize params)
- Reading time (calculated, shown as "10 min")

**Article Structure:**
1. Hook — opens with a compelling stat ("400% more likely to qualify within 5 minutes")
2. TL;DR bullet summary — 5 key takeaways before the deep content
3. Table of Contents — auto-generated `<ul>` with anchor links
4. Step-by-step body — organized as Step 1/2/3/4 with H2+H3 hierarchy
5. Comparison table — product plan comparison (pricing, features)
6. Conclusion — recap with key stats
7. FAQs — 3 structured Q&As (`::: faq` syntax for rich snippet schema)

**Content Features:**
- Internal links: 2 links back to leadpilot.chat (organic, not forced)
- External links: 61 links to authoritative domains (WordPress, Shopify, Salesforce, HubSpot, etc.)
- Citation references: `[\[1\]]` numbered inline citations throughout (27+ sources)
- Bold key statistics throughout ("80% reduction", "25-35% boost")
- AI-generated images: featured image + in-article illustration
- Embedded YouTube video (relevant tutorial)
- Data tables (plan comparison)
- Blockquote with attribution

**SEO Techniques:**
- Long-tail keyword in slug
- Natural keyword density (not stuffed)
- Proper H2/H3 heading hierarchy with keyword-rich headings
- FAQ schema markup for Google rich snippets
- Image alt texts
- Stats/data for E-E-A-T credibility signals
- Competitor/authority links for topical relevance

### What SEOSentinel is MISSING vs SEOBot

| Feature | SEOBot | SEOSentinel (current) | Priority |
|---|---|---|---|
| Featured image | AI-generated per article | None | HIGH |
| Meta keywords | 8 per article | None | MEDIUM |
| Category + tags | Auto-assigned | None | MEDIUM |
| Table of contents | Auto-generated | None | MEDIUM |
| FAQ section | 3 structured FAQs | None | HIGH (rich snippets) |
| Inline citations | `[\[1\]]` style, 27+ sources | Sources listed but NOT inline | HIGH |
| YouTube embeds | Finds relevant videos | None | LOW |
| Comparison tables | Product/pricing tables | None | MEDIUM |
| Stats-driven hook | Opens with compelling stat | Generic intro | HIGH |
| Image in body | Multiple AI images | None | MEDIUM |
| Reading time | Calculated | Not exposed in schema | LOW |
| Outline/TOC field | Stored as HTML `<ul>` | None | LOW |

### Pipeline improvements needed

1. **Research phase** — instruct the research model to find: relevant statistics, authoritative source URLs, related YouTube videos, FAQ-worthy questions
2. **Article generation** — update prompt to produce:
   - Stats-driven hook (compelling number in first sentence)
   - TL;DR bullet summary
   - Step-by-step or section-by-section structure
   - Inline citation references `[source]` linked to URLs
   - FAQ section (3 questions) at the end
   - Comparison table where relevant
3. **Post-processing** — add:
   - Table of contents generation from H2/H3 headings
   - Meta keywords extraction from content
   - Category + tag assignment from topic cluster
   - Featured image generation (or stock image via Unsplash/Pexels API)
4. **Schema updates** — add fields: `metaKeywords`, `category`, `tags`, `featuredImage`, `tableOfContents`, `faqs`
