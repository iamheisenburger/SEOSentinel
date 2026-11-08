/**
 * What Pentra is and does, stated once for every public page (Nov 2026). Copy anywhere on the site may say
 * less than this, never more: no guarantees, no invented customers or results, and sample data always
 * labelled as an example.
 */

export type AssistantId = "chatgpt" | "perplexity" | "gemini" | "google_ai_mode" | "google_ai_overview";

/** The five assistants Pentra asks. "Google's AI" covers the last two together in running copy. */
export const ASSISTANTS: readonly { id: AssistantId; name: string; short: string }[] = [
  { id: "chatgpt", name: "ChatGPT", short: "ChatGPT" },
  { id: "perplexity", name: "Perplexity", short: "Perplexity" },
  { id: "gemini", name: "Gemini", short: "Gemini" },
  { id: "google_ai_mode", name: "Google AI Mode", short: "AI Mode" },
  { id: "google_ai_overview", name: "Google AI Overviews", short: "AI Overviews" },
];

export const ASSISTANT_NAMES_SENTENCE = "ChatGPT, Perplexity, Gemini and Google's AI";

export function assistantName(id: AssistantId): string {
  return ASSISTANTS.find((assistant) => assistant.id === id)?.name ?? id;
}

/** The free first hour, in round numbers ("about 30" questions, "about 150" answers). */
export const SNAPSHOT = {
  questions: 30,
  assistants: ASSISTANTS.length,
  answers: 150,
  draftPages: 5,
} as const;

/** The line Pentra never softens. */
export const HONESTY_LINE =
  "We can't make an assistant recommend you. We show every answer we collect, so you can see exactly what changed.";

/** How answers are collected (the /method page explains each part). */
export const METHOD = {
  session: "a fresh session with web search",
  location: "from your country",
  product: "each assistant's live product",
  variance: "Answers vary between runs, so every count shows both numbers, like 23 of 150.",
} as const;

export type PublishTargetId = "wordpress" | "webflow" | "shopify" | "ghost" | "github" | "webhook" | "hosted";

/** Where the paid plan publishes answer pages. */
export const PUBLISH_TARGETS: readonly { id: PublishTargetId; name: string; detail: string }[] = [
  { id: "wordpress", name: "WordPress", detail: "Publishes to your WordPress site" },
  { id: "webflow", name: "Webflow", detail: "Publishes to a CMS collection" },
  { id: "shopify", name: "Shopify", detail: "Publishes to your store's blog" },
  { id: "ghost", name: "Ghost", detail: "Publishes to your Ghost site" },
  { id: "github", name: "GitHub", detail: "Commits each page to your repository" },
  { id: "webhook", name: "Webhook", detail: "Any other CMS, with a signed webhook" },
  { id: "hosted", name: "Hosted by Pentra", detail: "On your own subdomain, one DNS record" },
];

export const SUPPORT_EMAIL = "pentrahelp@gmail.com";
