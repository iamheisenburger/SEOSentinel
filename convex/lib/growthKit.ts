/** Get named, part two (P398, Nov 2026): the rest of the work that puts a business on the pages assistants read, for any
 * site. Threads found by search (not only those the answers cite), directory listings (one listing written once from the
 * business's own facts, the directories that fit its kind, the ones the answers cite first), short answer videos (script,
 * voice and screenshot made here; the owner's browser assembles the video and the owner uploads it), and comparison pages
 * (the business beside a rival the answers name, the rival described only from its own pages). Pure. */
import { isThread } from "./answerGrowth.ts";
import { toolOnlyInstruction } from "./toolChoice.ts";
import type { PageSource } from "./answerPages.ts";

const host = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/:?#].*$/, "");

// ── Threads found by search ──

export const THREAD_SEARCH_ENDPOINT = "cloro.google.serp.organic";
export const THREAD_SEARCH_MAX_MICRO_USD = 6_000;
/** Questions searched for threads each time the work is prepared. */
export const THREAD_SEARCH_QUESTIONS = 8;

/** One Google search for the community threads that ask a question (Reddit and Quora), from the business's country. */
export function threadSearchRequest(question: string, country: string) {
  return { query: `${question.replace(/\?+\s*$/, "").trim()} site:reddit.com OR site:quora.com`.slice(0, 300), gl: (country || "US").toUpperCase(), pages: 1 };
}

/** A thread's address as people open it: https, no tracking, no fragment; Reddit on www. */
export function cleanThreadUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.protocol = "https:";
    u.search = "";
    u.hash = "";
    if (/(^|\.)reddit\.com$/i.test(u.hostname)) u.hostname = "www.reddit.com";
    return u.toString();
  } catch { return null; }
}

/** The threads among a search's organic results, in Google's order, once each. */
export function parseThreadResults(payload: unknown): Array<{ url: string; title: string | null }> {
  const results = (payload as { result?: { organicResults?: unknown } } | null)?.result?.organicResults;
  if (!Array.isArray(results)) return [];
  const out: Array<{ url: string; title: string | null }> = [];
  const seen = new Set<string>();
  for (const r of results as Array<{ link?: unknown; title?: unknown }>) {
    const url = typeof r?.link === "string" ? cleanThreadUrl(r.link) : null;
    if (!url || seen.has(url) || !isThread(url)) continue;
    seen.add(url);
    out.push({ url, title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 300) : null });
  }
  return out.slice(0, 10);
}

// ── Directory listings ──

export type BusinessKind = "software" | "local" | "services" | "other";
export const BUSINESS_KINDS: readonly BusinessKind[] = ["software", "local", "services", "other"];
export type Directory = { name: string; domain: string; submitUrl: string; kinds: readonly BusinessKind[] | "all"; countries?: readonly string[]; note?: string };

/** Where businesses list themselves, by the kind of business each serves. Sign-up addresses checked Nov 10 2026; where a
 * site blocks automated checks the note says what to press. */
export const DIRECTORIES: readonly Directory[] = [
  { name: "LinkedIn company page", domain: "linkedin.com", submitUrl: "https://www.linkedin.com/company/setup/new/", kinds: "all" },
  { name: "Crunchbase", domain: "crunchbase.com", submitUrl: "https://www.crunchbase.com/add-new", kinds: ["software", "services", "other"] },
  { name: "Trustpilot", domain: "trustpilot.com", submitUrl: "https://business.trustpilot.com/signup", kinds: "all", note: "Free business account; reviews from customers count most." },
  { name: "G2", domain: "g2.com", submitUrl: "https://sell.g2.com/create-a-profile", kinds: ["software"] },
  { name: "Capterra", domain: "capterra.com", submitUrl: "https://www.capterra.com/vendors/sign-up", kinds: ["software"], note: "One listing also appears on GetApp and Software Advice." },
  { name: "Product Hunt", domain: "producthunt.com", submitUrl: "https://www.producthunt.com/posts/new", kinds: ["software"], note: "A launch: pick a weekday and be there to answer comments." },
  { name: "AlternativeTo", domain: "alternativeto.net", submitUrl: "https://alternativeto.net/", kinds: ["software"], note: "Sign in, then 'Add an app'; list it as an alternative to the tools the assistants name." },
  { name: "SaaSHub", domain: "saashub.com", submitUrl: "https://www.saashub.com/submit", kinds: ["software"] },
  { name: "TrustRadius", domain: "trustradius.com", submitUrl: "https://www.trustradius.com/vendors", kinds: ["software"] },
  { name: "SourceForge", domain: "sourceforge.net", submitUrl: "https://sourceforge.net/software/vendors/", kinds: ["software"] },
  { name: "SoftwareSuggest", domain: "softwaresuggest.com", submitUrl: "https://www.softwaresuggest.com/vendors", kinds: ["software"] },
  { name: "SaaSworthy", domain: "saasworthy.com", submitUrl: "https://www.saasworthy.com/list-your-product", kinds: ["software"] },
  { name: "Tekpon", domain: "tekpon.com", submitUrl: "https://tekpon.com/get-listed/", kinds: ["software"] },
  { name: "BetaList", domain: "betalist.com", submitUrl: "https://betalist.com/submit", kinds: ["software"], note: "For products launched in the last few months." },
  { name: "Indie Hackers", domain: "indiehackers.com", submitUrl: "https://www.indiehackers.com/products/new", kinds: ["software"] },
  { name: "Uneed", domain: "uneed.best", submitUrl: "https://www.uneed.best/submit-a-tool", kinds: ["software"] },
  { name: "Startup Stash", domain: "startupstash.com", submitUrl: "https://startupstash.com/add-listing/", kinds: ["software"] },
  { name: "Launching Next", domain: "launchingnext.com", submitUrl: "https://www.launchingnext.com/submit/", kinds: ["software"] },
  { name: "Fazier", domain: "fazier.com", submitUrl: "https://fazier.com/submit", kinds: ["software"] },
  { name: "F6S", domain: "f6s.com", submitUrl: "https://www.f6s.com/", kinds: ["software", "services"], note: "Create a company profile." },
  { name: "There's An AI For That", domain: "theresanaiforthat.com", submitUrl: "https://theresanaiforthat.com/submit/", kinds: ["software"], note: "Only if the product is built on AI." },
  { name: "Futurepedia", domain: "futurepedia.io", submitUrl: "https://www.futurepedia.io/", kinds: ["software"], note: "Only if the product is built on AI: press 'Submit a tool'." },
  { name: "Toolify", domain: "toolify.ai", submitUrl: "https://www.toolify.ai/submit", kinds: ["software"], note: "Only if the product is built on AI." },
  { name: "AI Tools Directory", domain: "aitoolsdirectory.com", submitUrl: "https://aitoolsdirectory.com/submit-tool", kinds: ["software"], note: "Only if the product is built on AI." },
  { name: "Clutch", domain: "clutch.co", submitUrl: "https://clutch.co/get-listed", kinds: ["services"] },
  { name: "GoodFirms", domain: "goodfirms.co", submitUrl: "https://www.goodfirms.co/get-listed", kinds: ["services"] },
  { name: "Google Business Profile", domain: "google.com", submitUrl: "https://business.google.com/create", kinds: ["local", "services"], note: "Needs a real address or service area; Google verifies it." },
  { name: "Bing Places", domain: "bingplaces.com", submitUrl: "https://www.bingplaces.com/", kinds: ["local", "services"], note: "Can import the Google Business Profile." },
  { name: "Apple Business Connect", domain: "businessconnect.apple.com", submitUrl: "https://businessconnect.apple.com/", kinds: ["local"] },
  { name: "Facebook page", domain: "facebook.com", submitUrl: "https://www.facebook.com/pages/create", kinds: ["local", "services", "other"] },
  { name: "Yelp", domain: "yelp.com", submitUrl: "https://biz.yelp.com/signup", kinds: ["local"], countries: ["US", "CA", "GB", "AU", "IE", "NZ"] },
  { name: "Nextdoor", domain: "nextdoor.com", submitUrl: "https://business.nextdoor.com/", kinds: ["local"], countries: ["US", "CA", "GB", "AU"] },
  { name: "Hotfrog", domain: "hotfrog.com", submitUrl: "https://www.hotfrog.com/add-your-business", kinds: ["local", "services"] },
  { name: "Manta", domain: "manta.com", submitUrl: "https://www.manta.com/claim", kinds: ["local", "services"], countries: ["US"] },
  { name: "Thumbtack", domain: "thumbtack.com", submitUrl: "https://www.thumbtack.com/pro", kinds: ["local"], countries: ["US"], note: "For home and local services." },
];

export type PlannedDirectory = { name: string; domain: string; submitUrl: string; note: string | null; citedIn: number };

/** The directories to list in, in order: the ones the assistants' answers cite (by how many answers), then the ones that
 * fit the business's kind and country. Without a known kind, only the ones every business can use and the cited ones. */
export function directoryPlan(kind: BusinessKind | null, country: string | null, cited: ReadonlyArray<{ domain: string; answers: number }>): PlannedDirectory[] {
  const out: PlannedDirectory[] = [];
  const seen = new Set<string>();
  const known = (domain: string) => DIRECTORIES.find((d) => { const h = host(domain); return h === d.domain || h.endsWith(`.${d.domain}`); });
  const citedCounts = new Map<string, number>();
  for (const c of cited) { const d = known(c.domain)?.domain ?? host(c.domain); citedCounts.set(d, (citedCounts.get(d) ?? 0) + c.answers); }
  for (const [domain, answers] of [...citedCounts].sort((a, b) => b[1] - a[1])) {
    const d = known(domain);
    out.push({ name: d?.name ?? domain, domain: d?.domain ?? domain, submitUrl: d?.submitUrl ?? `https://${domain}/`, note: d?.note ?? (d ? null : "The assistants read this site: find its 'add your business' or 'submit' page."), citedIn: answers });
    seen.add(d?.domain ?? domain);
  }
  const cc = (country ?? "").toUpperCase();
  for (const d of DIRECTORIES) {
    if (seen.has(d.domain)) continue;
    const fits = d.kinds === "all" || (kind !== null && d.kinds.includes(kind));
    const inCountry = !d.countries || !cc || d.countries.includes(cc);
    if (fits && inCountry) { out.push({ name: d.name, domain: d.domain, submitUrl: d.submitUrl, note: d.note ?? null, citedIn: 0 }); seen.add(d.domain); }
  }
  return out;
}

export const LISTING_MODEL = "claude-sonnet-5-5";
export const LISTING_TOOL = "submit_listing";
export const LISTING_HOLD_MICRO_USD = 60_000;

export type ListingKit = { kind: BusinessKind; tagline: string; shortDescription: string; longDescription: string; categories: string[]; features: string[];
  useCases: string[]; pricing: string; audience: string; faqs: Array<{ q: string; a: string }> };

/** One listing, written once from the business's own facts and reused in every directory's form. */
export function listingKitRequest(args: { businessName: string; domain: string; productEvidence: string; alternativesTo: readonly string[] }) {
  return {
    system: [
      `You write ${args.businessName}'s listing for business and software directories (G2, Capterra, Product Hunt, Google Business Profile, Clutch and the like). The owner pastes your fields into each directory's form.`,
      `Every fact comes from ${args.businessName}'s own facts below: never invent a feature, price, plan, number, customer, award, review or result. If the facts don't state a price, pricing is "See ${args.domain}".`,
      "Plain, specific words a buyer understands; no hype words (revolutionary, cutting-edge, seamless, unlock, supercharge), no emoji.",
      "kind: software (a product used online: SaaS, app, tool), local (serves customers at a place or in an area: a shop, clinic, trade), services (an agency, consultancy or professional service), or other.",
      "Lengths: tagline at most 60 characters; shortDescription at most 160 characters; longDescription 500 to 1000 characters in two or three short paragraphs; 3 to 5 categories as directories name them; 5 to 8 features, each under 80 characters; 3 to 5 use cases; 3 to 5 FAQs a buyer asks, each answered in one or two sentences.",
      toolOnlyInstruction(LISTING_TOOL),
    ].join("\n"),
    userMessage: [`Business: ${args.businessName} (${args.domain})`, `Its own facts (the only facts you may use):\n${args.productEvidence.slice(0, 14_000)}`,
      args.alternativesTo.length ? `Buyers also look at these (for categories only; never describe them): ${args.alternativesTo.slice(0, 6).join(", ")}` : ""].filter(Boolean).join("\n\n"),
    inputSchema: { type: "object" as const, additionalProperties: false,
      required: ["kind", "tagline", "shortDescription", "longDescription", "categories", "features", "useCases", "pricing", "audience", "faqs"],
      properties: {
        kind: { type: "string" as const, enum: [...BUSINESS_KINDS] },
        tagline: { type: "string" as const }, shortDescription: { type: "string" as const }, longDescription: { type: "string" as const },
        categories: { type: "array" as const, items: { type: "string" as const } }, features: { type: "array" as const, items: { type: "string" as const } },
        useCases: { type: "array" as const, items: { type: "string" as const } }, pricing: { type: "string" as const }, audience: { type: "string" as const },
        faqs: { type: "array" as const, items: { type: "object" as const, additionalProperties: false, required: ["q", "a"], properties: { q: { type: "string" as const }, a: { type: "string" as const } } } },
      } },
  };
}

const strings = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v : []).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
  .map((s) => s.trim().slice(0, len)).slice(0, max);

export function parseListingKit(raw: unknown): ListingKit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (k: string, len: number) => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, len) : "");
  const kind = BUSINESS_KINDS.includes(r.kind as BusinessKind) ? (r.kind as BusinessKind) : "other";
  const kit: ListingKit = { kind, tagline: text("tagline", 60), shortDescription: text("shortDescription", 160), longDescription: text("longDescription", 1200),
    categories: strings(r.categories, 5, 60), features: strings(r.features, 8, 100), useCases: strings(r.useCases, 5, 160), pricing: text("pricing", 200),
    audience: text("audience", 300),
    faqs: (Array.isArray(r.faqs) ? r.faqs : []).flatMap((f) => { const x = f as { q?: unknown; a?: unknown };
      return typeof x.q === "string" && typeof x.a === "string" && x.q.trim() && x.a.trim() ? [{ q: x.q.trim().slice(0, 160), a: x.a.trim().slice(0, 400) }] : []; }).slice(0, 5) };
  return kit.tagline && kit.shortDescription && kit.longDescription.length >= 200 && kit.features.length >= 3 ? kit : null;
}

// ── Answer videos ──

export const VIDEO_MODEL = "claude-sonnet-5-5";
export const VIDEO_TOOL = "submit_video_script";
export const VIDEO_HOLD_MICRO_USD = 120_000;
export const TTS_ENDPOINT = "google-ai.voice-gen.gemini-3-8-flash-tts";
export const TTS_MODEL = "gemini-3.8-flash-tts";
export const TTS_MAX_MICRO_USD = 60_000;
export const SCREENSHOT_ENDPOINT = "anyapi.web.screenshot";
export const SCREENSHOT_MAX_MICRO_USD = 6_000;

export type VideoSegment = { heading: string; lines: string[]; narration: string };
export type VideoScript = { title: string; description: string; tags: string[]; segments: VideoSegment[]; productSegment: number };

/** The questions worth a video: the ones whose answers cite videos (most first), then the most-answered ones. */
export function videoQuestions(checks: ReadonlyArray<{ status: string; question: string; sources: ReadonlyArray<{ domain: string }> }>, limit = 6): Array<{ question: string; videoAnswers: number }> {
  const counts = new Map<string, { videoAnswers: number; answers: number }>();
  for (const c of checks) {
    if (c.status !== "answered") continue;
    const row = counts.get(c.question) ?? { videoAnswers: 0, answers: 0 };
    row.answers++;
    if (c.sources.some((s) => /(^|\.)(youtube\.com|youtu\.be)$/i.test(host(s.domain)))) row.videoAnswers++;
    counts.set(c.question, row);
  }
  return [...counts].sort((a, b) => b[1].videoAnswers - a[1].videoAnswers || b[1].answers - a[1].answers || a[0].localeCompare(b[0]))
    .slice(0, limit).map(([question, r]) => ({ question, videoAnswers: r.videoAnswers }));
}

/** A one-minute answer video's script: useful on its own, the business shown once where it fits, every fact about it
 * from its own facts. The title and description are what YouTube and the assistants read. */
export function videoScriptRequest(args: { question: string; businessName: string; domain: string; productEvidence: string }) {
  return {
    system: [
      `You write the script for a short answer video (about 60 to 80 seconds) that ${args.businessName} posts on YouTube. It answers one question buyers ask; assistants read the title, description and spoken words.`,
      "Make it genuinely useful: concrete steps or criteria a viewer can act on today. Plain spoken English, short sentences, no hype, no emoji, no greetings, no \"like and subscribe\".",
      `Show ${args.businessName} once, in the segment where it truly answers part of the question (productSegment, its index), with what it does in plain words; if it doesn't fit, productSegment is -1. Every fact about ${args.businessName} comes from its own facts below; never invent a feature, price, number, customer or result.`,
      "segments: 5 to 7. The first segment's heading is the question as a viewer would search it. Each segment: a heading under 60 characters, 0 to 3 on-screen lines under 60 characters each (the key points, not the narration), and the narration (one to three sentences). All narration together: 120 to 190 words.",
      `title: under 90 characters, the question answered (it can start with "How to"). description: 400 to 900 characters: the answer in two or three sentences, then the steps as short lines, then "${args.businessName}: https://${args.domain}". tags: 5 to 10 search phrases.`,
      toolOnlyInstruction(VIDEO_TOOL),
    ].join("\n"),
    userMessage: [`Question: ${args.question}`, `${args.businessName}'s own facts (the only facts about it you may state):\n${args.productEvidence.slice(0, 12_000)}`].join("\n\n"),
    inputSchema: { type: "object" as const, additionalProperties: false, required: ["title", "description", "tags", "segments", "productSegment"],
      properties: {
        title: { type: "string" as const }, description: { type: "string" as const }, tags: { type: "array" as const, items: { type: "string" as const } },
        productSegment: { type: "integer" as const },
        segments: { type: "array" as const, items: { type: "object" as const, additionalProperties: false, required: ["heading", "lines", "narration"],
          properties: { heading: { type: "string" as const }, lines: { type: "array" as const, items: { type: "string" as const } }, narration: { type: "string" as const } } } },
      } },
  };
}

export function parseVideoScript(raw: unknown): VideoScript | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || typeof r.description !== "string" || !Array.isArray(r.segments)) return null;
  const segments = (r.segments as unknown[]).flatMap((s) => {
    const x = s as { heading?: unknown; lines?: unknown; narration?: unknown };
    return typeof x.heading === "string" && typeof x.narration === "string" && x.narration.trim()
      ? [{ heading: x.heading.trim().slice(0, 80), lines: strings(x.lines, 3, 80), narration: x.narration.trim().slice(0, 600) }] : [];
  }).slice(0, 8);
  const words = segments.reduce((n, s) => n + s.narration.split(/\s+/).filter(Boolean).length, 0);
  if (segments.length < 3 || words < 60 || words > 320) return null;
  const product = typeof r.productSegment === "number" && Number.isInteger(r.productSegment) && r.productSegment >= 0 && r.productSegment < segments.length ? r.productSegment : -1;
  return { title: r.title.trim().slice(0, 100), description: r.description.trim().slice(0, 4_500), tags: strings(r.tags, 12, 60), segments, productSegment: product };
}

/** The words the voice reads: every segment's narration, a paragraph each. */
export const narrationText = (segments: readonly VideoSegment[]) => segments.map((s) => s.narration).join("\n\n");

export function ttsRequest(text: string, voice = "Charon") {
  return { contents: [{ parts: [{ text: text.slice(0, 4_000), speechMetadata: { style: "calm, clear, friendly explainer" } }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } };
}

/** The voice's audio from Gemini's reply: base64 WAV. */
export function parseTtsAudio(payload: unknown): { mimeType: string; base64: string } | null {
  const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> } | null)?.candidates?.[0]?.content?.parts;
  const inline = (parts ?? []).find((p) => typeof p.inlineData?.data === "string")?.inlineData;
  return inline?.data ? { mimeType: inline.mimeType || "audio/wav", base64: inline.data } : null;
}

/** A WAV file's length in milliseconds from its header (the "data" chunk over the byte rate); null when it isn't a WAV. */
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 44 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.slice(8, 12)) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate = 0;
  for (let i = 12; i + 8 <= bytes.length;) {
    const id = String.fromCharCode(...bytes.slice(i, i + 4));
    const size = view.getUint32(i + 4, true);
    if (id === "fmt ") byteRate = view.getUint32(i + 16, true);
    if (id === "data") return byteRate > 0 ? Math.round((Math.min(size, bytes.length - i - 8) / byteRate) * 1000) : null;
    i += 8 + size + (size % 2);
  }
  return null;
}

/** The screenshot's image address from the screenshot provider's reply. */
export function parseScreenshot(payload: unknown): string | null {
  const items = (payload as { output?: { data?: { items?: Array<{ image?: unknown }> } } } | null)?.output?.data?.items;
  const image = items?.find((i) => typeof i.image === "string")?.image;
  return typeof image === "string" && /^https:\/\//.test(image) ? image : null;
}

// ── Comparison pages ──

export const COMPARISON_TOOL = "submit_answer_page";

/** A page beside one rival the assistants name: who each suits, what each does (the rival only from its own pages, each
 * sentence cited), when the rival is the better choice. Never the rival's prices or numbers, never what it lacks. */
export function comparisonRequest(args: { businessName: string; productEvidence: string; rival: { name: string; domain: string }; sources: readonly PageSource[];
  market: string; language: string; revision?: { markdown: string; issues: readonly string[] } }) {
  const b = args.businessName, r = args.rival.name;
  const system = [
    `You write one comparison page for ${b}'s website: ${b} and ${r}, side by side, for a buyer choosing between them. Assistants quote pages like this when buyers ask "${b} vs ${r}" or for alternatives to ${r}; it must be fair enough to trust.`,
    "Rules:",
    `1. The first paragraph answers directly in two or three sentences (at most 60 words): who each one suits best.`,
    `2. Every fact about ${b} comes only from ${b}'s facts below; never put a citation marker on a sentence about ${b}.`,
    `3. Every fact about ${r} comes only from the numbered sources (${r}'s own pages) and carries its marker like [1]. Describe ${r} in its own terms. Never state ${r}'s prices, plan limits, user counts or any number; for its price say to see its pricing page with the marker. Never say ${r} lacks, can't or doesn't do something. If the sources don't say it, leave it out.`,
    `4. Sections (subheadings in plain words): what ${b} does; what ${r} does; the main differences (a short table is fine, one row per difference, only facts from rules 2 and 3); when ${r} is the better choice; when ${b} is the better choice; a short FAQ of three questions.`,
    `5. Neutral and specific. No insults, no hype, no "best", no claims of being better without a fact. Links in the body only to ${b}'s own pages; ${r}'s pages are cited by number only.`,
    `6. Length: 600 to 1100 words. Language: ${args.language || "en"}. Do not write the title as a heading and do not add a Sources section.`,
    `7. In facts, list every factual statement with its source: "business" or "source" with its number. In fit, "strong" when ${b}'s facts show it does what buyers of ${r} want, "partial" for some of it, "none" when they don't (then it won't be published).`,
    toolOnlyInstruction(COMPARISON_TOOL),
  ].join("\n");
  const userMessage = [
    `Market: ${args.market || "not stated"}.`,
    `${b}'s facts (the only facts about ${b}):\n${args.productEvidence.slice(0, 14_000)}`,
    args.sources.length ? `Numbered sources, ${r}'s own pages (cite as [n]):\n${args.sources.map((s) => `[${s.n}] ${s.title ?? s.url} — ${s.url}\n${s.excerpt}`).join("\n\n")}`
      : `${r}'s pages couldn't be read: describe ${r} only as "${r} (${args.rival.domain})" with no claims about it.`,
    args.revision ? `Your previous draft had these problems. Fix every one and resubmit the whole page:\n${args.revision.issues.map((i) => `- ${i}`).join("\n")}\n\nPrevious draft:\n${args.revision.markdown}` : "",
  ].filter(Boolean).join("\n\n");
  const inputSchema = {
    type: "object" as const, additionalProperties: false, required: ["title", "metaDescription", "markdown", "facts", "fit"],
    properties: {
      fit: { type: "string" as const, enum: ["strong", "partial", "none"] }, fitReason: { type: "string" as const },
      title: { type: "string" as const, description: `At most 70 characters, like "${b} vs ${r}: which fits you".` },
      metaDescription: { type: "string" as const, description: "At most 155 characters: who each suits." },
      markdown: { type: "string" as const },
      facts: { type: "array" as const, items: { type: "object" as const, additionalProperties: false, required: ["text", "source"],
        properties: { text: { type: "string" as const }, source: { type: "string" as const, enum: ["business", "source"] }, sourceNumber: { type: "integer" as const } } } },
    },
  };
  return { system, userMessage, inputSchema };
}

/** Figures stated about the rival that its cited pages don't show (rule 3, objective): every number in a sentence citing a
 * rival page must appear in one of the pages it cites. */
export function rivalNumberIssues(markdown: string, sources: readonly PageSource[]): string[] {
  const issues: string[] = [];
  const bare = (text: string) => text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  for (const sentence of markdown.split(/(?<=[.!?])\s+|\n+/)) {
    const cites = [...sentence.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    if (!cites.length) continue;
    const pages = cites.map((n) => bare(sources.find((s) => s.n === n)?.excerpt ?? "")).join("\n");
    for (const figure of bare(sentence.replace(/\[\d+\]/g, "")).match(/\d+(?:\.\d+)?/g) ?? []) {
      if (!new RegExp(`(^|[^\\d.])${figure.replace(".", "\\.")}(?![\\d])`).test(pages)) {
        issues.push(`"${sentence.trim().slice(0, 140)}" states ${figure} about the rival, which its cited page doesn't show. Remove the number.`);
      }
    }
  }
  return [...new Set(issues)];
}

// ── Rivals with their sites ──

const letters = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const NOT_A_RIVAL = /(^|\.)(reddit|quora|facebook|instagram|linkedin|x|twitter|youtube|tiktok|pinterest|medium|substack|wikipedia|github|stackoverflow|stackexchange|producthunt|g2|capterra|trustpilot|getapp|softwareadvice|amazon|ebay|etsy|google|apple|microsoft|yelp)\.[a-z.]+$/;

/** The rivals the assistants recommend whose own site they also cite ("Apollo" named, apollo.io cited): name, site and the
 * answers naming them, most first. A name that can't be matched safely (under four letters) is left out. */
export function rivalPairs(recommended: ReadonlyArray<{ name: string; answers: number }>, citedDomains: readonly string[], siteDomain: string, max = 6):
  Array<{ name: string; domain: string; answers: number }> {
  const own = host(siteDomain);
  const byKey = new Map<string, string>();
  for (const raw of citedDomains) {
    const domain = host(raw);
    if (!domain || domain === own || domain.endsWith(`.${own}`) || NOT_A_RIVAL.test(domain)) continue;
    for (const key of [letters(domain.split(".")[0] ?? ""), letters(domain)]) if (key.length >= 4 && !byKey.has(key)) byKey.set(key, domain);
  }
  const out: Array<{ name: string; domain: string; answers: number }> = [];
  for (const r of recommended) {
    const domain = byKey.get(letters(r.name));
    if (domain && !out.some((o) => o.domain === domain)) out.push({ name: r.name, domain, answers: r.answers });
  }
  return out.slice(0, max);
}
