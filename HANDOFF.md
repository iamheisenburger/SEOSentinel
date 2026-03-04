# Pentra — Overhaul Handoff

## What Was Done

### Phase 1: Foundation
- Installed `date-fns`, `lucide-react`, `react-markdown`, `remark-gfm`, `rehype-slug`, `@anthropic-ai/sdk`
- Set up sky-blue + dark navy design system in `globals.css` (CSS variables, animations, custom scrollbar)
- Built **all UI components from scratch** (no shadcn/ui):
  - `src/components/ui/button.tsx` — 4 variants (primary/secondary/danger/ghost), 3 sizes, loading state
  - `src/components/ui/status-badge.tsx` — 12 statuses with dot indicators
  - `src/components/ui/stat-card.tsx` — Metric card with icon
  - `src/components/ui/dialog.tsx` — Custom modal (escape/click-outside close)
  - `src/components/ui/input.tsx` — Input + Textarea with labels/errors
  - `src/components/ui/tabs.tsx` — Tab bar with count badges
  - `src/components/ui/skeleton.tsx` — Loading skeleton components
  - `src/components/ui/empty-state.tsx` — Reusable empty state
  - `src/components/ui/toast.tsx` — Toast notification provider
- Built layout components:
  - `src/components/layout/sidebar.tsx` — Collapsible sidebar with mobile overlay
  - `src/components/layout/page-header.tsx` — Reusable page header
  - `src/components/layout/dashboard-layout.tsx` — Sidebar + main content wrapper
- Restructured routes with `(dashboard)` route group

### Phase 2: Core Pages
- **Dashboard** (`/dashboard`) — 4 stat cards, activity feed, "Generate Now" button
- **Sites** (`/sites`) — Site config form, onboarding crawl, plan generation, approval toggle
- **Plan** (`/plan`) — Topic card grid with tabs (All/Available/Used), priority stars, intent badges
- **Articles** (`/articles`) — Article card grid with tabs (All/Published/Review/Drafts), topic selector
- **Article Detail** (`/articles/[id]`) — Full markdown preview, sources, internal links, approve/reject/publish buttons
- **Jobs** (`/jobs`) — Job list with status badges, error display, duration, auto-refresh via Convex

### Phase 3: Backend Improvements
- **Publisher fix**: Changed default `repoName` from `subscription-tracker` to `App2`. Now reads `repoOwner`/`repoName` from site config. Removed sitemap generation.
- **Claude API swap**: All AI calls now use Anthropic SDK (`claude-sonnet-4-20250514`). Web research stays on OpenAI (`gpt-4o-mini` with `web_search_preview`).
- **Approval flow**: Added `approvalRequired` field to sites. When enabled, articles are held at `"review"` status instead of auto-publishing. Users can approve/reject from the article detail page.
- **Generate Now**: One-click article generation that picks the highest-priority available topic and runs the full pipeline immediately.

### Phase 4: Landing Page
- Full marketing page at `/` with hero, features section, how-it-works, capabilities checklist, pricing tiers, CTA, footer

### Phase 5: Polish
- Loading skeletons on all pages (Dashboard, Plan, Articles, Jobs)
- Empty states with icons and descriptions
- Toast notification system (auto-dismissing)

---

## What Still Needs to Be Done

### 1. Set Convex Environment Variables (CRITICAL)

The pipeline will NOT work until these are set:

```bash
cd c:\Users\arshadhakim\OneDrive\Desktop\Pentra

# Create a new Anthropic API key at https://console.anthropic.com/settings/keys
npx convex env set ANTHROPIC_API_KEY sk-ant-api03-xxxxx

# OpenAI key for web research (web_search_preview tool)
npx convex env set OPENAI_API_KEY sk-xxxxx
```

Already set: `GITHUB_TOKEN` (for publishing to the App2 repo)

### 2. Test the Full Pipeline

1. Go to `/sites` and make sure `leadpilot.chat` is configured
2. Run onboarding crawl if no pages exist
3. Go to `/plan` and generate a content plan
4. Go to `/dashboard` and click "Generate Now"
5. Check `/jobs` for pipeline status
6. If `approvalRequired` is on, check `/articles` for articles in "review" status

### 3. Optional Improvements Not Yet Done

- **Clerk auth**: Route structure is prepared (`/sign-in`, `/sign-up`) but Clerk is not installed. Add when ready for multi-user.
- **Mobile sidebar**: Works as overlay but could use refinement on very small screens
- **Page transitions**: Could add Framer Motion for smoother route transitions
- **Article editing**: Currently read-only preview. Could add inline markdown editing.
- **Topic management**: Could add manual topic creation (currently only AI-generated)
- **Cron schedule**: The `autopilotCron` runs on a Convex cron. Verify the schedule is configured in `convex/crons.ts`.

---

## Architecture

```
Pentra/
├── convex/                    # Backend (Convex)
│   ├── schema.ts              # DB schema (sites, pages, topic_clusters, articles, jobs)
│   ├── sites.ts               # Site CRUD + config (domain, niche, tone, approval, repo)
│   ├── articles.ts            # Article CRUD + approve/reject mutations
│   ├── topics.ts              # Topic cluster management
│   ├── jobs.ts                # Job queue (pending/running/done/failed)
│   ├── publisher.ts           # GitHub commit publisher (MDX + schema markup)
│   └── actions/
│       ├── pipeline.ts        # Main AI pipeline (onboarding, plan, article, links, fact-check)
│       └── scheduler.ts       # Cadence-based job scheduling
├── src/
│   ├── app/
│   │   ├── page.tsx           # Landing page (public)
│   │   ├── layout.tsx         # Root layout (dark theme, Geist fonts)
│   │   ├── globals.css        # Design system (CSS vars, animations)
│   │   └── (dashboard)/       # Protected route group
│   │       ├── layout.tsx     # Dashboard layout (sidebar + toast)
│   │       ├── dashboard/     # Command center
│   │       ├── sites/         # Site config
│   │       ├── plan/          # Topic clusters
│   │       ├── articles/      # Article list + [id] detail
│   │       └── jobs/          # Pipeline monitor
│   └── components/
│       ├── layout/            # Sidebar, page-header, dashboard-layout
│       └── ui/                # Hand-crafted components (button, badge, dialog, etc.)
```

## Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| Primary | `#0EA5E9` | Buttons, active nav, links |
| Accent | `#22D3EE` | Highlights |
| Background | `#0B1120` | Page background |
| Surface | `#111827` | Cards, sidebar |
| Border | `#1E293B` | Dividers |
| Text | `#F1F5F9` | Primary |
| Text-muted | `#94A3B8` | Secondary |
| Success | `#22C55E` | Published |
| Warning | `#F59E0B` | Pending |
| Error | `#EF4444` | Failed |

## Key Convex Functions

| Function | Type | Purpose |
|----------|------|---------|
| `actions.pipeline.generateNow` | Action | One-click article generation |
| `actions.pipeline.generateArticle` | Action | Generate article for a specific topic |
| `actions.pipeline.publishApproved` | Action | Publish an approved article to GitHub |
| `actions.pipeline.autopilotCron` | Action | Cron-driven autopilot across all sites |
| `articles.approve` | Mutation | Move article from "review" to "ready" |
| `articles.reject` | Mutation | Move article from "review" back to "draft" |
| `sites.upsert` | Mutation | Create/update site (includes approvalRequired, repoOwner, repoName) |
