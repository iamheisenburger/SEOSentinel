/**
 * D4: what Pentra's service emails to a site's owner say (P125 first article
 * live, P126 a late article with its reason). Plain text, sent only about the
 * owner's own site, each with the way to turn them off.
 */
import { internalContentProcessingError } from "./contentAudit.ts";
import { refreshBaseline } from "./articleRefresh.ts";

const WEEK_MS = 7 * 86_400_000;
/** A date in the site's own time zone (UTC when it has none or an invalid one). */
function siteDate(at: number, timeZone: string | undefined): string {
  const format = (zone: string) => new Date(at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone });
  try { return format(timeZone || "UTC"); } catch { return format("UTC"); }
}

const settingsFooter = (domain: string) =>
  `You get this email because Pentra publishes for ${domain}. You can turn these emails off in Settings: https://pentra.dev/settings`;

/** D4: the email a site's owner gets when Pentra's first article on the site is live. */
export function firstArticleEmail(input: { domain: string; title: string; url: string; nextAt: number | null; intervalMs: number | null;
  timeZone?: string; searchConsole: boolean }): { subject: string; text: string } {
  const perWeek = input.intervalMs && input.intervalMs > 0 ? Math.max(1, Math.round(WEEK_MS / input.intervalMs)) : null;
  const lines = [
    `Pentra just published your first article on ${input.domain}:`,
    "",
    `"${input.title}"`,
    input.url,
    "",
    "It was written from the business facts you confirmed, checked against its sources, and confirmed live on your site.",
    "",
    "What happens next:",
    input.nextAt ? `- Pentra publishes your next article around ${siteDate(input.nextAt, input.timeZone)}, then keeps to your schedule${perWeek ? ` (about ${perWeek} a week)` : ""}.`
      : "- Pentra keeps publishing on your schedule.",
    "- New articles usually take a few weeks to start showing in Google.",
    input.searchConsole
      ? "- Your Google Search Console is connected, so Pentra can see which searches show your pages and improve the ones closest to page one."
      : "- Connect Google Search Console in your dashboard so Pentra can see which searches show your pages and improve the ones closest to page one.",
    "",
    "Your dashboard: https://pentra.dev/dashboard",
    "",
    "Pentra",
    "",
    settingsFooter(input.domain),
  ];
  return { subject: `Your first article is live on ${input.domain}`, text: lines.join("\n") };
}

/** P196: what a new site still needs before Pentra can start, in the order the setup panel asks for it. */
export type SetupStep = "repository" | "website" | "plan" | "start";
const SETUP_STEP: Record<SetupStep, string> = {
  // P200: GitHub connected, no repository chosen (where one of the first real signups stopped).
  repository: "choose the GitHub repository your website is built from: open Settings (https://pentra.dev/settings), go to Publishing, click Edit and pick it. If your website isn't built from a GitHub repository, choose the platform it runs on there instead, or paste the articles yourself.",
  website: "connect your website so Pentra can publish to it (WordPress, GitHub, Webflow, Shopify or Ghost). If your site runs on something else, choose “Paste the articles yourself” in setup instead.",
  plan: "check your plan in Plans & billing (https://pentra.dev/upgrade).",
  start: "check your business details, tick “My business details are accurate” and press Start Pentra.",
};

/** P196 (Oct 25 2026): the one email a site's owner gets when, a day after adding the site, Pentra hasn't started for it.
 * The first two real signups never started (one never pressed Start, one never connected a website) and nothing told them what was left. */
export function setupReminderEmail(input: { domain: string; step: SetupStep }): { subject: string; text: string } {
  const lines = [
    `You added ${input.domain} to Pentra, but Pentra isn't running on it yet.`,
    "",
    `What's left: ${SETUP_STEP[input.step].replace(/^./, c => c.toUpperCase())}`,
    "",
    "Finish setup in your dashboard: https://pentra.dev/dashboard",
    "",
    "Once you start, Pentra writes your first article from the business details you confirmed and checks it against its sources.",
    "",
    "If something in setup didn't work, reply to this email and tell us where it stopped.",
    "",
    "Pentra",
    "",
    `You get this email because you added ${input.domain} to Pentra. You can turn these emails off in Settings: https://pentra.dev/settings`,
  ];
  return { subject: `One step left to start Pentra on ${input.domain}`, text: lines.join("\n") };
}

/** P202 (Oct 26 2026): the one email an account gets when, a day after signing up, it hasn't added a website. Of the
 * first three real signups one never added one, and the setup reminder (P196) only reaches a site's owner. */
export function addWebsiteEmail(): { subject: string; text: string } {
  const lines = [
    "You created a Pentra account, but you haven't added your website yet.",
    "",
    "What's left: add your website's address in your dashboard: https://pentra.dev/dashboard",
    "",
    "Pentra then reads what your business sells and you choose how it publishes: to your site directly (a Next.js, Astro, Hugo, Jekyll or Gatsby blog on GitHub; WordPress, Shopify, Webflow and Ghost are in beta), or you paste the articles in yourself.",
    "",
    "If something in setup didn't work, reply to this email and tell us where it stopped.",
    "",
    "Pentra",
    "",
    "You get this email because you created a Pentra account. You can turn these emails off in Settings: https://pentra.dev/settings",
  ];
  return { subject: "Add your website to start Pentra", text: lines.join("\n") };
}

/** P210 (Oct 26 2026): the email an owner gets when the article they asked for is waiting for them. Review-first owners
 * (every site that pastes its own articles) only saw a finished draft if they kept the page open, and one nobody comes
 * back to is never published. `notes`: Pentra's checks handed it back with notes for the owner to read first. */
export function draftReadyEmail(input: { domain: string; title: string; articleId: string; notes: boolean; paste: boolean }): { subject: string; text: string } {
  const lines = [
    `The article you asked Pentra for on ${input.domain} is ready for you to read:`,
    "",
    `"${input.title}"`,
    `https://pentra.dev/articles/${input.articleId}`,
    "",
    input.notes ? "Pentra's checks left a few notes on it. Read them on that page: edit the draft, or accept the notes, before you approve it."
      : "It was written from the business details you confirmed and checked against its sources.",
    "",
    input.paste ? "Nothing goes live until you paste it into your site. Then give Pentra the article's address on that page, and Pentra checks that it's live."
      : "Nothing goes live until you publish it from that page. Edit anything you like first.",
    "",
    "Pentra",
    "",
    `You get this email because you asked Pentra for an article on ${input.domain}. You can turn these emails off in Settings: https://pentra.dev/settings`,
  ];
  return { subject: `Your article for ${input.domain} is ready to read`, text: lines.join("\n") };
}

/** Why a scheduled article is late, as the owner can act on it. */
export type MissedSlotCause = "connection" | "plan" | "writing_service" | "internal" | "checks" | "no_topics" | "preparing";
const WRITING_SERVICE_FAILURES = new Set(["content_provider_unavailable", "content_provider_credit_unavailable",
  "content_provider_request_rejected", "content_provider_result_ambiguous_reconciliation_required"]);

export function missedSlotCause(input: { destinationVerified: boolean; plannedTopics: number | null; failure: string | null }): MissedSlotCause {
  if (!input.destinationVerified) return "connection";
  const failure = input.failure ?? "";
  if (/entitlement|plan|billing|budget|funding|reservation/i.test(failure)) return "plan";
  if (WRITING_SERVICE_FAILURES.has(failure)) return "writing_service";
  if (internalContentProcessingError(failure)) return "internal";
  if (failure) return "checks";
  if (input.plannedTopics === 0) return "no_topics";
  return "preparing";
}

const MISSED_SLOT_WHY: Record<MissedSlotCause, string> = {
  connection: "Pentra couldn't publish to your site because the publishing connection needs to be checked.",
  plan: "your plan's article capacity needs checking before Pentra can continue.",
  writing_service: "a temporary problem with the writing service Pentra uses. Nothing was published or charged to you.",
  internal: "an internal error on Pentra's side. We've been alerted and are fixing it.",
  checks: "the draft for this slot didn't pass Pentra's checks, so it wasn't published.",
  no_topics: "Pentra ran out of researched topics for your site and is researching new searches your customers make.",
  preparing: "the article is taking longer than usual to prepare.",
};
const MISSED_SLOT_ACTION: Partial<Record<MissedSlotCause, string>> = {
  connection: "open Settings (https://pentra.dev/settings), go to Publishing and check the connection. Pentra publishes as soon as it works again.",
  plan: "open Plans & billing (https://pentra.dev/upgrade) to check your plan.",
};

/** D4: the email a site's owner gets when a scheduled article is 6 hours or more late. */
export function missedSlotEmail(input: { domain: string; deadlineAt: number; timeZone?: string; cause: MissedSlotCause }): { subject: string; text: string } {
  const day = siteDate(input.deadlineAt, input.timeZone);
  const action = MISSED_SLOT_ACTION[input.cause];
  const lines = [
    `The article Pentra scheduled for ${input.domain} on ${day} hasn't been published yet.`,
    "",
    `Why: ${MISSED_SLOT_WHY[input.cause].replace(/^./, c => c.toUpperCase())}`,
    "",
    action ? `What to do: ${action.replace(/^./, c => c.toUpperCase())}`
      : "You don't need to do anything. Pentra keeps working on it and catches up missed articles at most one extra a day.",
    "",
    "Your dashboard: https://pentra.dev/dashboard",
    "",
    "Pentra",
    "",
    settingsFooter(input.domain),
  ];
  return { subject: `Your ${day} article for ${input.domain} is late`, text: lines.join("\n") };
}

/** A calendar month (UTC) by its key, "2026-10". */
export function monthWindow(key: string): { key: string; label: string; startMs: number; endMs: number; startDate: string; endDate: string } {
  const [year, month] = key.split("-").map(Number);
  const start = Date.UTC(year, month - 1, 1), end = Date.UTC(year, month, 1);
  return { key, label: new Date(start).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    startMs: start, endMs: end, startDate: new Date(start).toISOString().slice(0, 10), endDate: new Date(end - 86_400_000).toISOString().slice(0, 10) };
}

/** The month a report covers: the one before `now`. */
export function reportMonth(now: number) {
  const current = new Date(now);
  return monthWindow(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)).toISOString().slice(0, 7));
}

export type MonthlySearch = { clicks: number; impressions: number; position: number | null; pagesSeen: number }
  | "not_connected" | "incomplete" | "see_dashboard";
/** A page Autopilot improved last month, with the reason recorded when it chose it. */
export type MonthlyImprovement = { title: string; url: string; opportunity?: string };

/** One improved page, saying what changed and why only as far as the record shows. */
function improvementLine(page: MonthlyImprovement): string {
  const refresh = refreshBaseline(page.opportunity);
  if (refresh) return `- "${page.title}" ${page.url}: a new section answers "${refresh.query}" (Google showed the page at position ${refresh.position}, ${refresh.impressions.toLocaleString("en-US")} impressions in the 28 days before)`;
  const query = /^Current Search Console query: (.+?); impressions=/.exec(page.opportunity ?? "")?.[1];
  if (query) return `- "${page.title}" ${page.url}: now answers "${query}", a search Google shows it for`;
  return `- "${page.title}" ${page.url}`;
}

/** D4 (P127): what Pentra did for a site last month, and what Google showed.
 * Null when there is nothing to report (nothing published or improved and no
 * complete Search Console month). */
export function monthlyReportEmail(input: { domain: string; month: { label: string }; published: Array<{ title: string; url: string }>;
  improved: MonthlyImprovement[]; corrected?: number; search: MonthlySearch; intervalMs: number | null; nextAt: number | null; timeZone?: string }): { subject: string; text: string } | null {
  const searchReady = typeof input.search === "object";
  if (!input.published.length && !input.improved.length && !input.corrected && !searchReady) return null;
  const count = (n: number) => n.toLocaleString("en-US");
  const month = input.month.label.split(" ")[0];
  const lines = [`Here's what Pentra did for ${input.domain} in ${input.month.label}.`, ""];
  lines.push(input.published.length ? `Published: ${input.published.length} new article${input.published.length === 1 ? "" : "s"}` : "Published: no new articles");
  for (const article of input.published.slice(0, 10)) lines.push(`- "${article.title}" ${article.url}`);
  if (input.published.length > 10) lines.push(`- and ${input.published.length - 10} more in your dashboard`);
  // Each improved page by name and the search it answered (P146, Oct 21 2026:
  // the count alone said nothing, and it counted owner-requested corrections
  // as "for searches Google already shows them for").
  if (input.improved.length) {
    lines.push("", `Improved: ${input.improved.length} existing article${input.improved.length === 1 ? "" : "s"}:`);
    for (const page of input.improved.slice(0, 10)) lines.push(improvementLine(page));
    if (input.improved.length > 10) lines.push(`- and ${input.improved.length - 10} more in your dashboard`);
  }
  if (input.corrected) lines.push("", `Updated at your request: ${input.corrected} published article${input.corrected === 1 ? "" : "s"}.`);
  lines.push("");
  if (typeof input.search === "object") {
    const s = input.search;
    lines.push(`From Google (your Search Console, all of ${month}):`, `- ${count(s.clicks)} clicks and ${count(s.impressions)} impressions`);
    if (s.position !== null) lines.push(`- average position ${s.position}`);
    lines.push(`- ${count(s.pagesSeen)} page${s.pagesSeen === 1 ? "" : "s"} shown in search`);
    if (s.clicks === 0) lines.push("New articles usually take weeks to months to earn clicks; impressions come first.");
  } else if (input.search === "incomplete") {
    lines.push(`Google's data for ${month} isn't complete yet, so this report leaves it out. Your dashboard shows the latest numbers.`);
  } else if (input.search === "see_dashboard") {
    lines.push(`Your dashboard has your Search Console numbers for ${month}.`);
  } else {
    lines.push("Connect Google Search Console in your dashboard to see clicks and impressions here, and to let Pentra improve the pages closest to page one.");
  }
  const perWeek = input.intervalMs && input.intervalMs > 0 ? Math.max(1, Math.round(WEEK_MS / input.intervalMs)) : null;
  if (input.nextAt) lines.push("", `Next: your next article is due ${siteDate(input.nextAt, input.timeZone)}${perWeek ? `, and Pentra keeps publishing about ${perWeek} a week` : ""}.`);
  lines.push("", "Your dashboard: https://pentra.dev/dashboard", "", "Pentra", "", settingsFooter(input.domain));
  return { subject: `Your ${input.month.label} report for ${input.domain}`, text: lines.join("\n") };
}
