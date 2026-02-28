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
