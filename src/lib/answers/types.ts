/**
 * Pentra Answers: the shapes the onboarding and dashboard read, exactly as ops/design/answers-api.md and
 * convex/answers.ts, answerPages.ts and answerPublish.ts return them. Ids are plain strings here (Convex ids are
 * strings at runtime), so the same components render live data and the dev-only harness's synthetic data.
 */

export type AnswersAccess = "owner" | "paid" | "free";

export type AnswersAllows = { snapshot: boolean; drafts: boolean; publish: boolean; recheck: boolean; weekly: boolean };

/** Backend assistant ids. "Google's AI" in running copy covers the last two together. */
export type AnswersAssistant = "chatgpt" | "perplexity" | "gemini" | "google_ai_mode" | "google_ai_overview";

export type Competitor = { name: string; domain?: string };

export type RunKind = "snapshot" | "weekly" | "recheck";
export type RunStatus = "asking" | "done" | "failed";

export type Run = {
  runId: string;
  kind: RunKind;
  status: RunStatus;
  createdAt: number;
  finishedAt: number | null;
  country: string;
  /** Jobs in the run: questions × assistants. */
  total: number;
  done: number;
  answered: number;
  named: number;
  cited: number;
  failed: number;
  /** Google AI Overviews showed no overview: listed, never counted as an answer. */
  noAnswer: number;
  byAssistant: { assistant: string; asked: number; answered: number; named: number; cited: number }[] | null;
  competitors: { name: string; named: number }[] | null;
  topSources: { domain: string; answers: number }[] | null;
  error: string | null;
};

export type CheckStatus = "answered" | "no_answer" | "error";

export type CheckSource = { url: string; title?: string; domain: string; own: boolean };

/** One answer, the proof behind every count. */
export type Check = {
  checkId: string;
  questionId: string;
  question: string;
  assistant: string;
  askedAt: number;
  country: string;
  status: CheckStatus | string;
  error: string | null;
  /** About 600 characters around the first mention, whitespace collapsed, with ellipses where it was cut. */
  excerpt: string;
  textChars: number;
  named: boolean;
  cited: boolean;
  /** 1 = named first among the brands the answer names. */
  position: number | null;
  brandsNamed: number;
  competitorsNamed: string[];
  sources: CheckSource[];
  citedPageUrls: string[];
};

export type CheckWithText = Check & { text: string | null };

/**
 * `runProgress`: a run while it asks. `perAssistant` has totals only today; `done`/`answered`/`named` are read
 * when the backend adds them (see the report), so the mini-bars fill from real counts and never from estimates.
 */
export type RunProgress = Run & {
  perAssistant: { assistant: string; total: number; done?: number; answered?: number; named?: number }[];
  feed: Check[];
};

export type PageStatus = "writing" | "draft" | "not_written" | "publishing" | "published" | "publish_failed" | "retired";

export type SetupPage = { pageId: string; question: string; title: string; status: PageStatus | string; words: number; sources: number; facts: number };

export type SetupState = {
  siteId: string;
  domain: string;
  name: string | null;
  sells: string;
  buyers: string;
  offerings: string[];
  country: string | null;
  local: boolean;
  location: string | null;
  competitors: Competitor[];
  readAt: number | null;
  readError: string | null;
  confirmedAt: number | null;
  setupError: string | null;
  questions: { questionId: string; question: string; intent: string }[];
  run: Run | null;
  pages: SetupPage[];
  access: AnswersAccess;
};

export type HostedStatus = "pending_dns" | "live" | "error";

export type Publishing = {
  target: "site" | "hosted" | string;
  hostedDomain?: string;
  hostedStatus?: HostedStatus | string;
  hostedCheckedAt?: number;
  hostedError?: string;
};

export type QuestionLatest = {
  runId: string;
  at: number;
  answered: number;
  named: number;
  cited: number;
  assistantsNamed: string[];
  competitorsNamed: { name: string; answers: number }[];
};

export type Opportunity = { score: number; status: "winnable" | "covered" | "monitoring" | string; reasons: string[]; at: number };

export type QuestionStatus = "active" | "paused" | "removed";

export type OverviewQuestion = {
  questionId: string;
  question: string;
  intent: string;
  /** generated | owner | followup */
  source: string;
  status: QuestionStatus | string;
  createdAt: number;
  latest: QuestionLatest | null;
  opportunity: Opportunity | null;
  pageId: string | null;
};

export type IndexNow = { at: number; status: string };

export type OverviewPage = {
  pageId: string;
  questionId: string;
  question: string;
  status: PageStatus | string;
  title: string;
  slug: string;
  publishedUrl: string | null;
  publishedAt: number | null;
  indexNow: IndexNow | null;
  citations: number;
  lastCitedAt: number | null;
  updatedAt: number;
  issues: string[];
  publishError: string | null;
  words: number;
  sources: number;
  facts: number;
  /** When Pentra saw the published page live on the site (null: not yet). Older backends omit it. */
  liveAt?: number | null;
};

export type OverviewCitation = {
  citationId: string;
  checkId: string;
  questionId: string;
  pageId: string | null;
  assistant: string;
  /** page_cited (a Pentra page) | site_cited (another page of the site) */
  kind: string;
  url: string;
  at: number;
  first: boolean;
};

export type TrendPoint = { at: number; answered: number; named: number; cited: number; competitors: { name: string; named: number }[] };

export type Overview = {
  site: {
    siteId: string;
    domain: string;
    name: string;
    country: string;
    competitors: Competitor[];
    confirmedAt: number | null;
    setupError: string | null;
    publishing: Publishing | null;
    autopublish: boolean;
    weeklyEmail: boolean;
    /** When the next full run is due (null: none scheduled, as on the free snapshot). Older backends omit it. */
    nextRunAt?: number | null;
  };
  access: AnswersAccess;
  allows: AnswersAllows;
  /** Newest first, at most 13. */
  runs: Run[];
  /** Full runs (snapshot and weekly), oldest first. */
  trend: TrendPoint[];
  questions: OverviewQuestion[];
  pages: OverviewPage[];
  /** Newest first, at most 20. */
  citations: OverviewCitation[];
};

export type QuestionEvidence = {
  question: string;
  opportunity: Opportunity | null;
  latest: QuestionLatest | null;
  checks: Check[];
};

export type PageFact = { text: string; source: "business" | "source" | string; url?: string };
export type PageSource = { n: number; url: string; title?: string; excerpt?: string; contentHash?: string; retrievedAt: number };

export type AnswerPage = {
  pageId: string;
  questionId: string;
  question: string;
  status: PageStatus | string;
  title: string;
  slug: string;
  metaDescription: string;
  markdown: string;
  facts: PageFact[];
  sources: PageSource[];
  issues: string[];
  version: number;
  updatedAt: number;
  createdAt: number;
  publishedUrl: string | null;
  publishedAt: number | null;
  publishError: string | null;
  indexNow: IndexNow | null;
  googleSitemapAt: number | null;
  citations: number;
  lastCitedAt: number | null;
  notWrittenReason: string | null;
  rewriteReason: string | null;
  history: { pageId: string; version: number; status: string; updatedAt: number; rewriteReason: string | null }[];
  /** As on overview.pages (when the page query carries it). */
  liveAt?: number | null;
  citationList: { checkId: string; assistant: string; at: number; url: string }[];
};

export type MySite = { siteId: string; domain: string; name: string | null; answers: boolean; confirmed: boolean };

/**
 * The site's own publishing connection, read from `api.sites.get` (the same fields the legacy Settings connection
 * section reads; secrets never reach the client, only "configured" flags).
 */
export type SiteConnection = {
  _id: string;
  domain: string;
  publishMethod?: string;
  repoOwner?: string;
  repoName?: string;
  repoDefaultBranch?: string;
  githubConnected?: boolean;
  githubAuthorized?: boolean;
  wpUrl?: string;
  wpUsername?: string;
  wordpressConfigured?: boolean;
  webhookUrl?: string;
  webhookSecretConfigured?: boolean;
  cmsEndpoint?: string;
  cmsClientId?: string;
  cmsCollection?: string;
  cmsSecretConfigured?: boolean;
  /** The owner's own Google Search Console is connected (Pentra submits the sitemap through it). */
  gscConnected?: boolean;
};

export type GithubRepository = { owner: string; name: string; private: boolean };
