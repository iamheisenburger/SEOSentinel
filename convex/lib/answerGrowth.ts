/** Get named (P397, Nov 2026): what the answers show about where a business must appear to be recommended, and the work
 * that puts it there. An assistant recommends the businesses the pages it reads name, so Pentra maps those pages from the
 * stored answers (most-cited first, sorted by what can be done about each), lists who the assistants recommend instead,
 * and drafts the community answers a person posts (forums ban automated posting, so Pentra never posts). Pure. */
import { editorialSite } from "./linkOutreach.ts";

export type SourceKind = "community" | "video" | "social" | "directory" | "rival" | "article";
export const SOURCE_KINDS: readonly SourceKind[] = ["community", "video", "article", "directory", "social", "rival"];

const host = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/:?#].*$/, "");
const COMMUNITY = /(^|\.)(reddit\.com|quora\.com|stackexchange\.com|stackoverflow\.com|indiehackers\.com|news\.ycombinator\.com|community\.[a-z0-9-]+\.[a-z.]+)$/;
const VIDEO = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/;
const SOCIAL = /(^|\.)(linkedin\.com|facebook\.com|x\.com|twitter\.com|instagram\.com|threads\.net|medium\.com|substack\.com)$/;
const DIRECTORY = /(^|\.)(g2\.com|capterra\.[a-z.]+|getapp\.[a-z.]+|softwareadvice\.[a-z.]+|trustpilot\.com|producthunt\.com|alternativeto\.net|saashub\.com|sourceforge\.net|crunchbase\.com|clutch\.co|yelp\.[a-z.]+|tripadvisor\.[a-z.]+|trustradius\.com|appsumo\.com|futurepedia\.io|theresanaiforthat\.com)$/;

/** What can be done about a page the assistants read: answer in a community thread, make a video, get listed, pitch the
 * article's editor, post on a social profile; a rival's own page is only watched. */
export function sourceKind(domain: string, rivals: readonly string[]): SourceKind {
  const h = host(domain);
  if (rivals.some((r) => h === host(r) || h.endsWith(`.${host(r)}`))) return "rival";
  if (COMMUNITY.test(h)) return "community";
  if (VIDEO.test(h)) return "video";
  if (DIRECTORY.test(h)) return "directory";
  if (SOCIAL.test(h)) return "social";
  return editorialSite(h) ? "article" : "social";
}

export type MapCheck = { status: string; question: string; assistant: string; sources: ReadonlyArray<{ url: string; title?: string; domain: string; own: boolean }> };
export type MappedSource = { url: string; title: string | null; domain: string; kind: SourceKind; answers: number; questions: string[]; assistants: string[] };

/** Every page the answers cite (never the business's own), counted once per answer, most-cited first. */
export function sourceMap(checks: readonly MapCheck[], rivals: readonly string[], limit = 60): MappedSource[] {
  const byUrl = new Map<string, { url: string; title: string | null; domain: string; answers: number; questions: Set<string>; assistants: Set<string> }>();
  for (const c of checks) {
    if (c.status !== "answered") continue;
    const seen = new Set<string>();
    for (const s of c.sources) {
      if (s.own || seen.has(s.url)) continue;
      seen.add(s.url);
      const entry = byUrl.get(s.url) ?? { url: s.url, title: s.title?.trim() || null, domain: host(s.domain || s.url), answers: 0, questions: new Set<string>(), assistants: new Set<string>() };
      entry.answers++;
      entry.questions.add(c.question);
      entry.assistants.add(c.assistant);
      if (!entry.title && s.title?.trim()) entry.title = s.title.trim();
      byUrl.set(s.url, entry);
    }
  }
  return [...byUrl.values()]
    .sort((a, b) => b.answers - a.answers || b.questions.size - a.questions.size || a.url.localeCompare(b.url))
    .slice(0, limit)
    .map((e) => ({ url: e.url, title: e.title, domain: e.domain, kind: sourceKind(e.domain, rivals), answers: e.answers,
      questions: [...e.questions].slice(0, 8), assistants: [...e.assistants] }));
}

/** Answers counted by kind of page they cite (each answer once per kind): where the assistants look for this business's buyers. */
export function kindTotals(sources: readonly MappedSource[]): Record<SourceKind, number> {
  const out = Object.fromEntries(SOURCE_KINDS.map((k) => [k, 0])) as Record<SourceKind, number>;
  for (const s of sources) out[s.kind] += s.answers;
  return out;
}

/** A community page that is a thread a person can answer: a Reddit post (/comments/), a Quora question, a forum topic. */
export function isThread(url: string): boolean {
  try {
    const u = new URL(url), h = host(u.hostname), path = u.pathname;
    if (/(^|\.)reddit\.com$/.test(h)) return /\/comments\/[a-z0-9]+/i.test(path);
    if (/(^|\.)quora\.com$/.test(h)) return path.length > 1 && !/^\/(profile|topic|search|answer|spaces?)(\/|$)/i.test(path);
    return COMMUNITY.test(h) && /\/(questions?|t|topic|thread|post|discussion|comments)\//i.test(path);
  } catch { return false; }
}

export const platformOf = (url: string) => /reddit\.com/i.test(url) ? "Reddit" : /quora\.com/i.test(url) ? "Quora" : "Forum";

/** The threads to answer, most-cited first, never one already drafted. */
export function postCandidates(sources: readonly MappedSource[], drafted: ReadonlySet<string>, limit = 8): MappedSource[] {
  return sources.filter((s) => s.kind === "community" && isThread(s.url) && !drafted.has(s.url)).slice(0, limit);
}

/** Reddit serves a thread as JSON at its address + ".json": the post and its top replies, as plain text. */
export function redditThreadText(json: unknown): string | null {
  if (!Array.isArray(json) || !json.length) return null;
  const post = (json[0] as { data?: { children?: Array<{ data?: { title?: string; selftext?: string; subreddit?: string } }> } })?.data?.children?.[0]?.data;
  if (!post?.title) return null;
  const replies = ((json[1] as { data?: { children?: Array<{ kind?: string; data?: { body?: string; score?: number } }> } })?.data?.children ?? [])
    .filter((c) => c.kind === "t1" && typeof c.data?.body === "string").slice(0, 6)
    .map((c) => `- ${(c.data!.body as string).replace(/\s+/g, " ").slice(0, 500)}`);
  return [`Subreddit: r/${post.subreddit ?? "?"}`, `Title: ${post.title}`, post.selftext ? `Post: ${post.selftext.slice(0, 2500)}` : "",
    replies.length ? `Top replies so far:\n${replies.join("\n")}` : ""].filter(Boolean).join("\n");
}

/** P406: Reddit refuses Pentra's servers (every one of the first 55 drafts was written from the title alone), so a Reddit
 * thread is read through treg: the post and its replies by the thread's address, about $0.002 a thread. */
export const REDDIT_THREAD_ENDPOINT = "scrapecreators.x.v1-reddit-post-comments";
export const REDDIT_THREAD_MAX_MICRO_USD = 5_000;
/** A Quora or forum page through treg's page reader when the site blocks direct reads (Quora always does). */
export const THREAD_PAGE_MAX_MICRO_USD = 10_000;
/** Drafts written from the title alone that are written again from the thread, per preparation (the next ones to post). */
export const REDRAFTS_PER_PREPARATION = 6;

/** The thread as text from treg's Reddit reply (`post` and `comments[]`, replies nested under `replies.items`): the post,
 * then the most-upvoted top-level replies. */
export function scrapedRedditThreadText(json: unknown): string | null {
  const data = json as { post?: { title?: unknown; selftext?: unknown; subreddit?: unknown }; comments?: unknown } | null;
  const post = data?.post;
  if (!post || typeof post.title !== "string" || !post.title.trim()) return null;
  const comments = (Array.isArray(data!.comments) ? data!.comments : []) as Array<{ body?: unknown; score?: unknown }>;
  const replies = comments.filter((c) => typeof c?.body === "string" && c.body.trim() && !/^\[(deleted|removed)\]$/i.test(c.body.trim()))
    .sort((a, b) => (typeof b.score === "number" ? b.score : 0) - (typeof a.score === "number" ? a.score : 0)).slice(0, 6)
    .map((c) => `- ${(c.body as string).replace(/\s+/g, " ").trim().slice(0, 500)}`);
  const selftext = typeof post.selftext === "string" ? post.selftext.trim() : "";
  return [`Subreddit: r/${typeof post.subreddit === "string" ? post.subreddit : "?"}`, `Title: ${post.title.trim()}`, selftext ? `Post: ${selftext.slice(0, 2500)}` : "",
    replies.length ? `Top replies so far:\n${replies.join("\n")}` : ""].filter(Boolean).join("\n");
}

const TITLE_STOP = new Set(["the", "and", "for", "with", "what", "how", "why", "are", "you", "your", "can", "does", "should", "best", "way", "that", "this", "from", "have",
  "quora", "reddit", "into", "about", "who", "which", "when", "where", "there", "their", "them", "they", "any", "some"]);
const titleWords = (title: string) => [...new Set(title.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !TITLE_STOP.has(w)))];

/** A Quora or forum page as thread text, only when the page is the thread: it carries most of the thread title's words
 * (a sign-in wall, a bot check or another page doesn't). */
export function forumThreadText(title: string | null, pageText: string): string | null {
  const text = pageText.replace(/\s+/g, " ").trim();
  if (text.length < 200) return null;
  const words = titleWords((title ?? "").replace(/\s[-|–]\s[^-|–]+$/, ""));
  const lower = text.toLowerCase();
  if (!words.length || words.filter((w) => lower.includes(w)).length < Math.ceil(words.length * 0.6)) return null;
  return [`Title: ${(title ?? "").trim()}`, `The thread's page (question and answers, as read):\n${text.slice(0, 3000)}`].join("\n");
}

export type BusinessFacts = { name: string; domain: string; summary?: string; features?: readonly string[]; pricing?: string; audience?: string };

export const POST_MODEL = "claude-sonnet-5-5";
export const POST_TOOL = "submit_community_answer";
export const POST_PRICE = { inputUsdPerMillion: 2, outputUsdPerMillion: 10 };
export const POST_HOLD_MICRO_USD = 40_000;
export const postCostMicroUsd = (usage: { input_tokens?: number; output_tokens?: number } | undefined) =>
  Math.ceil(Math.max(0, usage?.input_tokens ?? 0) * POST_PRICE.inputUsdPerMillion + Math.max(0, usage?.output_tokens ?? 0) * POST_PRICE.outputUsdPerMillion);

/** The request that drafts one reply a person can post: useful on its own, the business named once only where it truly
 * fits, every fact about it from its own profile, and the poster's connection to it disclosed. */
export function postDraftRequest(thread: { url: string; title: string | null; text: string | null; questions: readonly string[] }, business: BusinessFacts) {
  const facts = [
    `Name: ${business.name} (${business.domain})`,
    business.summary ? `What it is: ${business.summary}` : "",
    business.features?.length ? `What it does: ${business.features.slice(0, 8).join("; ")}` : "",
    business.pricing ? `Price: ${business.pricing}` : "",
    business.audience ? `Who it's for: ${business.audience}` : "",
  ].filter(Boolean).join("\n");
  return {
    system: [
      "You draft one reply to a public community thread (Reddit, Quora or a forum). A person from the business reads it, edits it if needed and posts it under their own account.",
      "The reply must be genuinely useful on its own: answer the thread's actual question with concrete, practical steps a reader can act on today, in the thread's own tone. Plain words, no marketing language, no headings, no emoji, no hashtags.",
      "Mention the business at most once, and only where it truly answers part of the question. If it doesn't fit this thread, set fits to false and still write the most useful reply without it.",
      "Every fact about the business comes from the facts given; never invent a feature, number, price, customer or result. Never claim personal experience the facts don't give.",
      "When the business is mentioned, end with one short disclosure line saying the poster runs or works on it. Write the address as plain text, at most once; no tracking links.",
      "Length: 90 to 220 words. Never name a competitor negatively.",
      `Answer only by calling the ${POST_TOOL} tool.`,
    ].join("\n"),
    userMessage: [
      `Thread: ${thread.url}`,
      thread.text ? thread.text : `Title: ${thread.title ?? "(unknown)"}\n(The thread's text couldn't be read; write from its title and the questions below.)`,
      `Buyers ask assistants questions like:\n${thread.questions.slice(0, 5).map((q) => `- ${q}`).join("\n")}`,
      `The business:\n${facts}`,
    ].join("\n\n"),
    inputSchema: { type: "object" as const, additionalProperties: false, required: ["reply", "fits"],
      properties: { reply: { type: "string" as const }, fits: { type: "boolean" as const } } },
  };
}

export function parsePostDraft(raw: unknown): { reply: string; fits: boolean } | null {
  if (!raw || typeof raw !== "object") return null;
  const { reply, fits } = raw as { reply?: unknown; fits?: unknown };
  if (typeof reply !== "string" || typeof fits !== "boolean") return null;
  const text = reply.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  return words >= 40 && words <= 400 ? { reply: text, fits } : null;
}
