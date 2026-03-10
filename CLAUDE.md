# Pentra (pentra.dev) — CLAUDE.md

## What Is This

Pentra is an **autonomous AI-powered SEO content engine**. Users connect their website, and Pentra crawls it, generates a keyword-optimized content plan, writes research-backed articles with citations/images/fact-checking, and publishes them — all on autopilot. It is NOT just an "AI writer" — it's a full autonomous content department: research, writing, images, infographics, fact-checking, internal linking, schema markup, and multi-platform publishing.

- **Live at**: https://pentra.dev
- **Repo name**: SEOSentinel (legacy name, product is Pentra)
- **Owner**: Arshad

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| Database + Backend | Convex (real-time, serverless) |
| Auth | Clerk (with Convex integration via `ConvexProviderWithClerk`) |
| Styling | Tailwind CSS 4 + custom CSS variables in `globals.css` |
| AI - Articles | Anthropic Claude (`claude-haiku-4-5-20251001`) via `@anthropic-ai/sdk` |
| AI - Research | OpenAI `o4-mini-deep-research-2025-06-26` via `web_search_preview` tool |
| AI - Images | OpenAI `gpt-image-1.5` for hero images and infographics |
| Validation | Zod 4 |
| Markdown | react-markdown + remark-gfm + rehype-raw + rehype-slug |
| Icons | lucide-react |
| Fonts | Geist Sans + Geist Mono (next/font) |
| UI Components | Hand-built (no shadcn/ui) |

## Architecture Overview

```
User signs up (Clerk) → Adds site domain → Onboarding crawl (AI analyzes site)
→ Content plan generated (topic clusters with keywords, intent, priority)
→ Articles generated per topic (research → write → fact-check → images → internal links → schema markup)
→ Published to user's platform (GitHub commit / WordPress REST API / Webhook / Manual)
→ Autopilot cron runs 8x/day, scheduler enforces per-site cadence
```

## Key File Paths

### Convex Backend (`convex/`)
| File | Purpose |
|------|---------|
| `schema.ts` | DB schema — `sites`, `pages`, `topic_clusters`, `articles`, `jobs`, `usage_log` |
| `sites.ts` | Site CRUD, upsert, delete (cascading), plan features sync, orphan fix |
| `articles.ts` | Article CRUD, approve/reject, usage logging, slot claiming (race condition safe) |
| `topics.ts` | Topic cluster management, dedup on insert, status tracking |
| `jobs.ts` | Job queue (pending/running/done/failed), retry logic, stuck job reset, progress tracking |
| `publisher.ts` | Multi-platform publisher router: GitHub (auto-detect branch + empty repo fallback), WordPress, Webhook, Manual. Builds MDX with frontmatter + JSON-LD schema markup |
| `pages.ts` | Crawled page storage, bulk upsert |
| `blog.ts` | Public blog queries — `listPublishedByDomain`, `getPublishedBySlug` with domain/slug normalization |
| `planLimits.ts` | Plan tier limits (sites + articles/month). Maps Clerk feature keys to numbers |
| `crons.ts` | 8x daily autopilot cron (every 3h) + monthly re-linking cron |
| `auth.config.ts` | Clerk auth config (domain: `clerk.pentra.dev`) |
| `actions/pipeline.ts` | **THE CORE** — all AI pipeline logic (see below) |
| `actions/scheduler.ts` | Cadence-based scheduling with keyword cannibalization prevention |

### Pipeline Actions (`convex/actions/pipeline.ts`)
This is the largest and most important file. Key exported actions:

| Action | Purpose |
|--------|---------|
| `crawlAndAnalyze` | Crawl a site, extract pages, AI-analyze site profile (niche, tone, audience, etc.) |
| `generatePlan` | Generate topic clusters with keywords, intent, priority, article types |
| `generateArticle` | Full article pipeline: research → write → fact-check → images → internal links |
| `publishApproved` | Publish an approved article via the site's configured publish method |
| `generateNow` | One-click: pick highest-priority available topic and generate immediately |
| `autopilotCron` | Cron entry point: iterate all sites, schedule cadence, process jobs |
| `autopilotTick` | Process pending jobs for a specific site |
| `processSpecificJob` | Process a single job by ID (used by queueArticleNow) |
| `processNextJob` | Process the next pending job in the queue |
| `suggestInternalLinks` | AI-generate internal link suggestions for an article |
| `suggestBacklinks` | AI-generate backlink outreach suggestions |
| `relinkAllArticles` | Monthly cron: re-run internal linking across all published articles |
| `generateProgrammaticTemplate` | Generate programmatic SEO page templates |
| `generateNewsArticle` | Generate news/trending topic articles |

### Frontend (`src/`)

**App Routes:**
| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/page.tsx` | Landing page (public) |
| `/pricing` | `app/pricing/page.tsx` | Pricing page |
| `/blog` | `app/blog/page.tsx` | Public blog listing |
| `/blog/[slug]` | `app/blog/[slug]/page.tsx` | Public article view |
| `/contact` | `app/contact/page.tsx` | Contact page |
| `/legal/privacy` | `app/legal/privacy/page.tsx` | Privacy policy |
| `/legal/terms` | `app/legal/terms/page.tsx` | Terms of service |
| `/sign-in` | `app/sign-in/[[...sign-in]]/page.tsx` | Clerk sign-in |
| `/sign-up` | `app/sign-up/[[...sign-up]]/page.tsx` | Clerk sign-up |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | Command center — stats, activity, "Generate Now" |
| `/sites` | `app/(dashboard)/sites/page.tsx` | Site list |
| `/sites/[siteId]` | `app/(dashboard)/sites/[siteId]/page.tsx` | Site settings/config |
| `/plan` | `app/(dashboard)/plan/page.tsx` | Topic cluster grid with tabs |
| `/articles` | `app/(dashboard)/articles/page.tsx` | Article list (All/Published/Review/Drafts) |
| `/articles/[id]` | `app/(dashboard)/articles/[id]/page.tsx` | Article detail — markdown preview, approve/reject/publish |
| `/jobs` | `app/(dashboard)/jobs/page.tsx` | Pipeline job monitor |
| `/settings` | `app/(dashboard)/settings/page.tsx` | User settings |
| `/settings/billing` | `app/(dashboard)/settings/billing/page.tsx` | Billing/plan management |
| `/upgrade` | `app/(dashboard)/upgrade/page.tsx` | Upgrade prompt |

**Key Components:**
| Path | Purpose |
|------|---------|
| `components/layout/sidebar.tsx` | Collapsible sidebar with mobile overlay |
| `components/layout/dashboard-layout.tsx` | Sidebar + main content wrapper |
| `components/layout/page-header.tsx` | Reusable page header |
| `components/layout/landing-nav.tsx` | Landing page nav |
| `components/layout/over-limit-banner.tsx` | Banner shown when user exceeds plan limits |
| `components/onboarding/setup-wizard.tsx` | Multi-step site onboarding wizard |
| `components/onboarding/platform-instructions.tsx` | Platform-specific publishing setup instructions |
| `components/landing/pricing-section.tsx` | Pricing cards component |
| `components/ui/*` | Hand-crafted UI: button, dialog, input, tabs, skeleton, toast, stat-card, status-badge, empty-state, article-progress |

**Key Files:**
| Path | Purpose |
|------|---------|
| `app/layout.tsx` | Root layout — ClerkProvider, Convex Providers, Geist fonts, dark theme |
| `app/providers.tsx` | ConvexProviderWithClerk setup |
| `app/globals.css` | Design system CSS variables, animations, Clerk dark-theme overrides |
| `middleware.ts` | Clerk auth middleware, public route matching, dynamic article path rewriting |
| `contexts/site-context.tsx` | Active site context (multi-site support via SiteProvider) |
| `hooks/usePlanLimits.ts` | Hook: reads Clerk features, syncs to Convex, returns plan limits |
| `lib/convexClient.ts` | Convex React client |
| `lib/convexHttpClient.ts` | Convex HTTP client (for API routes) |

**API Routes:**
| Route | Purpose |
|-------|---------|
| `api/autopilot` | GET endpoint to trigger autopilot tick (edge runtime) |
| `api/github/auth` | Initiates GitHub OAuth flow for repo access |
| `api/github/callback` | GitHub OAuth callback — exchanges code for token, saves to Convex |

## Database Schema

### `sites` — User websites
Core fields: `userId` (Clerk), `domain`, `niche`, `tone`, `language`, `cadencePerWeek`, `autopilotEnabled`, `approvalRequired`
Publishing: `publishMethod` ("github"/"wordpress"/"webhook"/"manual"), `repoOwner`, `repoName`, `githubToken`, `wpUrl`/`wpUsername`/`wpAppPassword`, `webhookUrl`/`webhookSecret`
AI-analyzed profile: `siteName`, `siteType`, `siteSummary`, `blogTheme`, `keyFeatures`, `pricingInfo`, `founders`
Audience: `targetCountry`, `targetAudienceSummary`, `painPoints`, `productUsage`
Content settings: `ctaText`, `ctaUrl`, `imageBrandingPrompt`, `brandPrimaryColor`/`brandAccentColor`/`brandFontFamily`/`brandLogoUrl`, `anchorKeywords`, `externalLinking`, `sourceCitations`, `youtubeEmbeds`, `urlStructure`
Indexes: `by_domain`, `by_user`

### `pages` — Crawled site pages
Fields: `siteId`, `url`, `slug`, `title`, `keywords`, `summary`
Index: `by_site`

### `topic_clusters` — Content plan topics
Fields: `siteId`, `label`, `primaryKeyword`, `secondaryKeywords`, `intent`, `priority`, `status` (pending/queued/planned/used), `articleType` (standard/listicle/how-to/checklist/comparison/roundup/ultimate-guide), `notes`
Index: `by_site`

### `articles` — Generated articles
Fields: `siteId`, `topicId`, `articleType`, `status` (draft/review/ready/published/rejected), `title`, `slug`, `markdown`, `metaTitle`, `metaDescription`, `metaKeywords`, `language`, `sources` (url+title array), `internalLinks` (anchor+href array), `featuredImage`, `readingTime`, `wordCount`, `factCheckScore`, `factCheckNotes`, `backlinkSuggestions`
Indexes: `by_site`, `by_topic`

### `jobs` — Pipeline job queue
Fields: `siteId`, `type` (onboarding/plan/article/links/scheduler), `status` (pending/running/done/failed), `payload`, `result`, `error`, `retries`, `stepProgress` (current/total/stepLabel/topicLabel)
Indexes: `by_site`, `by_status`

### `usage_log` — Immutable usage tracking
Fields: `userId`, `siteId`, `type` ("article_generated"/"site_added"), `createdAt`
Indexes: `by_user`, `by_user_type`
Purpose: Prevents delete+re-add abuse for plan limits. Never deleted.

## Article Pipeline Steps

1. **Web Research** — OpenAI `o4-mini-deep-research` with `web_search_preview` tool searches for stats, sources, related content
2. **Article Generation** — Claude Haiku writes the full article (markdown) with inline citations, FAQs, TL;DR, stats-driven hook
3. **Fact-Checking** — Claude verifies claims against sources, assigns confidence score (0-100)
4. **Hero Image** — OpenAI `gpt-image-1.5` generates a photorealistic hero image, stored in Convex file storage
5. **Infographic** — Optional mid-article infographic generation
6. **Internal Linking** — AI suggests internal links to other articles on the same site
7. **Schema Markup** — Auto-generates JSON-LD (Article, FAQ, HowTo schemas)
8. **Publishing** — Routes to the configured publisher adapter

## Article Types

7 supported types with different structural templates:
- `standard` — Default blog post
- `listicle` — "N Best/Top X" format with comparison table
- `how-to` — Step-by-step tutorial with prerequisites
- `checklist` — Actionable checkbox-style guide
- `comparison` — Side-by-side analysis (X vs Y)
- `roundup` — Expert opinions/resource collection
- `ultimate-guide` — 5000-7000 word comprehensive resource

## Publishing Adapters

| Method | How |
|--------|-----|
| GitHub | Commits MDX file to `content/<urlStructure>/` with frontmatter + schema markup |
| WordPress | POST to `wp-json/wp/v2/posts` with styled HTML (brand colors injected) |
| Webhook | POST JSON payload with HMAC-SHA256 signature if secret configured |
| Manual | Just marks article as published (user copies content manually) |

## Plan Tiers & Limits

Enforced via Clerk feature keys synced to Convex `planFeatures` on each site.

| Plan | Price | Sites | Articles/mo |
|------|-------|-------|-------------|
| Free | $0 | 1 | 3 |
| Starter | $49 | 1 | 10 |
| Growth | $99 | 3 | 25 |
| Scale | $199 | 10 | 60 |
| Enterprise | $499 | Unlimited | 150 |

Usage tracked in `usage_log` (immutable — survives deletions). `claimGenerationSlot` mutation prevents race conditions.

## Design System

- **Theme**: Dark navy/charcoal
- **Primary**: `#0EA5E9` (sky blue) — buttons, active nav, links
- **Accent**: `#22D3EE` (cyan) — highlights
- **Background**: `#08090E` (near-black)
- **Surface**: `#0F1117` (dark card)
- **Text**: `#EDEEF1` (primary), `#8B8FA3` (muted), `#565A6E` (dim)
- **Status colors**: Success `#22C55E`, Warning `#F59E0B`, Error `#EF4444`
- All UI components are custom-built (no shadcn/ui)
- CSS animations: pulse-glow, slide-up, fade-in, fade-in-up, shimmer, gradient-shift, marquee, float

## Environment Variables

### Client-side (`.env.local`)
- `NEXT_PUBLIC_CONVEX_URL` — Convex deployment URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk public key (pk_live_)
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL` — `/sign-in`
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL` — `/sign-up`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` — `/dashboard`
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` — `/dashboard`
- `NEXT_PUBLIC_GA_ID` — Google Analytics (optional)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe (not yet active)

### Server-side (`.env.local` + Convex env vars)
- `CLERK_SECRET_KEY` — Clerk secret (sk_live_)
- `ANTHROPIC_API_KEY` — Claude API key (must also be set on Convex: `npx convex env set`)
- `OPENAI_API_KEY` — OpenAI key (must also be set on Convex: `npx convex env set`)
- `GITHUB_TOKEN` — Personal access token for publishing (also on Convex)
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth app for user repo access
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth for Clerk SSO
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Stripe (not yet active)

### Convex env vars (set via `npx convex env set KEY value`)
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GITHUB_TOKEN`

## Convex Deployment

- **Convex project**: `seosentinel` (team: `arshadoo1423`)
- **Deployment**: `dev:terrific-donkey-287`
- **URL**: `https://wary-starfish-773.convex.cloud`
- **Clerk auth domain**: `https://clerk.pentra.dev`

## Development

```bash
# Install dependencies
npm install

# Run Convex dev server (in one terminal)
npx convex dev

# Run Next.js dev server (in another terminal)
npm run dev

# Deploy Convex to production
npx convex deploy

# Build Next.js
npm run build
```

Path alias: `@/*` maps to `./src/*`

## Deployment

- Frontend: Vercel (auto-deploys from GitHub)
- Backend: Convex Cloud (auto-deploys via `npx convex deploy`)
- Domain: pentra.dev

## Marketing Context

- **Socials**: @pentradev on X, @penaborai on IG
- **Marketing agent**: Oracle (runs on VPS 137.184.191.188, handles Pentra social content)
- **Email campaigns**: Warming up via Instantly (hello@trypentra.co)
- **Positioning**: "Full autonomous content department" — not just an AI writer

## Important Patterns & Conventions

1. **No shadcn/ui** — All UI components are hand-built in `src/components/ui/`
2. **Convex queries are real-time** — UI auto-updates via `useQuery` subscriptions
3. **Jobs system** — All long-running work goes through the job queue (never call pipeline actions directly from client). Use `queueArticleNow` mutation which schedules via `ctx.scheduler.runAfter`
4. **Immutable usage tracking** — `usage_log` table prevents plan limit abuse via delete+re-add
5. **Multi-site support** — `SiteContext` tracks the active site. All dashboard queries filter by `siteId`
6. **Approval flow** — When `approvalRequired` is on, articles go to "review" status. Users approve/reject from article detail page
7. **Keyword cannibalization prevention** — Scheduler checks overlap ratio (<35%) against existing articles before selecting topics
8. **Stuck job recovery** — Jobs running >10min auto-reset to pending (up to 3 retries). Failed jobs retry within 30min
9. **Dynamic URL rewriting** — Middleware rewrites unknown paths to `/blog/[slug]` so articles work with any `urlStructure` config
10. **GitHub OAuth** — Users can connect their GitHub account via OAuth flow (not just PAT). Token stored per-site

## User Preferences (Arshad)

- Values **SPEED** above all else — move fast, don't waste time
- **Hates re-giving context** — save everything important, new sessions must hit the ground running
- Prefers **concise, direct communication**
- Gets frustrated by slow processes and unnecessary round-trips
- Hates "yes man" behavior — form independent opinions, push back when needed
- Goes by **Arshad** in project context

## Known TODOs / Missing Features

- **Stripe billing** — Keys configured but integration not active
- **Article editing** — Currently read-only preview; no inline markdown editing
- **Manual topic creation** — Topics only come from AI generation
- **More publishing integrations** — See `NOTES.md` for Webflow, Ghost, Shopify, Framer, etc.
- **Featured image improvements** — See NOTES.md SEOBot comparison for gaps
- **Inline citations** — Sources listed but not fully inline `[1]` style
- **Custom source feeding (RAG)** — Let users provide priority URLs (docs, repos, X posts) for AI to reference during research. Requested by early user.
