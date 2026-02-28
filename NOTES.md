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

The same multi-platform integration pattern applies to LeadPilot's agent deployment:
- Instead of "publish article to WordPress", it's "deploy chat widget to WordPress"
- WordPress plugin, Shopify app, Webflow embed, etc.
- Same API key / token storage pattern
- Same terms & conditions pattern for third-party access
- Could share infrastructure: a `publishers/` or `deployers/` abstraction

## Research Model
- Using `o4-mini-deep-research-2025-06-26` for web research (OpenAI)
- Using `claude-haiku-4-5-20251001` for article generation and fact-checking (Anthropic)
