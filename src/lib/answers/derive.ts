/**
 * Pentra Answers: what the screens say, derived from the API's own counts. "Named in `named` of `answered` answers";
 * answers with no AI Overview and failed answers are listed beside the count, never inside it. No percentages, no
 * scores, no estimates. Pure.
 */
import { ASSISTANTS } from "../product-facts.ts";
import { displayUrl, listSentence, plural, PUBLISH_METHOD_LABELS, shortDate } from "./format.ts";
import type { Check, Overview, OverviewQuestion, Publishing, Run, SiteConnection, TrendPoint } from "./types.ts";

export const WEEK_MS = 7 * 86_400_000;

/** The latest full run (snapshot or weekly) that finished. Rechecks of new pages ask a few questions only. */
export function latestFullRun(runs: readonly Run[]): Run | null {
  return runs.find((run) => run.status === "done" && run.kind !== "recheck") ?? null;
}

export type AssistantRow = { assistant: string; asked: number; answered: number; named: number; cited: number; rivalTop?: { name: string; named: number } | null };

/**
 * One row per assistant, in Pentra's order. From the run's own totals when it finished, or counted from its answer
 * log (which also gives each assistant's most-named competitor for the tick on the bar).
 */
export function assistantRows(run: Pick<Run, "byAssistant"> | null, log?: readonly Check[] | null): AssistantRow[] {
  if (log && log.length) {
    return ASSISTANTS.map(({ id }) => {
      const mine = log.filter((check) => check.assistant === id);
      const answered = mine.filter((check) => check.status === "answered");
      const rivals = new Map<string, number>();
      for (const check of answered) for (const name of new Set(check.competitorsNamed)) rivals.set(name, (rivals.get(name) ?? 0) + 1);
      const top = [...rivals].sort((a, b) => b[1] - a[1])[0];
      return { assistant: id, asked: mine.length, answered: answered.length, named: answered.filter((c) => c.named).length,
        cited: answered.filter((c) => c.cited).length, rivalTop: top ? { name: top[0], named: top[1] } : null };
    });
  }
  if (!run?.byAssistant) return [];
  return ASSISTANTS.map(({ id }) => {
    const row = run.byAssistant!.find((r) => r.assistant === id);
    return { assistant: id, asked: row?.asked ?? 0, answered: row?.answered ?? 0, named: row?.named ?? 0, cited: row?.cited ?? 0 };
  });
}

/** The count sentence's parts. */
export function headline(run: Pick<Run, "named" | "answered" | "noAnswer" | "failed" | "cited">) {
  const notCounted: string[] = [];
  if (run.noAnswer) notCounted.push(`${plural(run.noAnswer, "search", "searches")} showed no AI Overview`);
  if (run.failed) notCounted.push(`${plural(run.failed, "answer")} failed`);
  return {
    sentence: `Named in ${run.named.toLocaleString("en-US")} of ${plural(run.answered, "answer")}.`,
    notCounted: notCounted.length ? `${listSentence(notCounted)}; listed, not counted.` : null,
  };
}

/** Competitors, most named first, with the business placed among them. */
export function rivalsRanked(run: Pick<Run, "competitors" | "named"> | null, businessName: string) {
  const rivals = [...(run?.competitors ?? [])].filter((c) => c.named > 0).sort((a, b) => b.named - a.named);
  const rows = [{ name: businessName, named: run?.named ?? 0, you: true }, ...rivals.map((c) => ({ name: c.name, named: c.named, you: false }))];
  return rows.sort((a, b) => b.named - a.named || Number(b.you) - Number(a.you));
}

export type WeeklyDelta =
  | { kind: "baseline"; at: number }
  | { kind: "change"; delta: number; current: TrendPoint; previous: TrendPoint };

/** The change since the previous full run, said with both runs' denominators. */
export function weeklyDelta(trend: readonly TrendPoint[]): WeeklyDelta | null {
  if (!trend.length) return null;
  const current = trend[trend.length - 1];
  const previous = trend[trend.length - 2];
  if (!previous) return { kind: "baseline", at: current.at };
  return { kind: "change", delta: current.named - previous.named, current, previous };
}

export function deltaText(delta: WeeklyDelta): string {
  if (delta.kind === "baseline") return `Baseline · ${shortDate(delta.at)}`;
  const { delta: d, previous } = delta;
  const was = `${previous.named} of ${previous.answered} on ${shortDate(previous.at)}`;
  if (d === 0) return `No change from the run before (${was}).`;
  return `${d > 0 ? "+" : "−"}${plural(Math.abs(d), "answer")} vs the run before (${was}).`;
}

/** The weekly run starts seven days after the last full run finished (convex/answersDispatch.ts, checked hourly). */
export function nextFullRunAt(trend: readonly TrendPoint[]): number | null {
  const last = trend[trend.length - 1];
  return last ? last.at + WEEK_MS : null;
}

export type LogEntry = { at: number; text: string; href?: string; tone?: "named" | "wrong" | "neutral" };

/** "This week Pentra…": a factual log from the records, newest first. */
export function weekLog(overview: Overview, now: number): LogEntry[] {
  const since = now - WEEK_MS;
  const entries: LogEntry[] = [];
  for (const run of overview.runs) {
    if (run.status === "done" && run.finishedAt && run.finishedAt >= since) {
      entries.push({ at: run.finishedAt, tone: "neutral",
        text: run.kind === "recheck"
          ? `Re-asked the assistants about newly published pages: named in ${run.named} of ${plural(run.answered, "answer")}.`
          : `Asked ${ASSISTANTS.length} assistants ${plural(run.total / ASSISTANTS.length, "question")}: named in ${run.named} of ${plural(run.answered, "answer")}.` });
    }
    if (run.status === "failed" && (run.finishedAt ?? run.createdAt) >= since) {
      entries.push({ at: run.finishedAt ?? run.createdAt, tone: "wrong", text: `A run stopped early${run.error ? `: ${run.error}` : "."} ${plural(run.answered, "answer")} were kept.` });
    }
  }
  for (const page of overview.pages) {
    const href = `/dashboard/pages/${page.pageId}`;
    if (page.status === "published" && page.publishedAt && page.publishedAt >= since) entries.push({ at: page.publishedAt, href, tone: "named", text: `Published “${page.title}”.` });
    if (page.status === "draft" && page.updatedAt >= since) entries.push({ at: page.updatedAt, href, text: `Wrote a draft: “${page.title}”.` });
    if (page.status === "retired" && page.updatedAt >= since) entries.push({ at: page.updatedAt, href, text: `Replaced “${page.title}” with a rewrite.` });
  }
  // Failures with the same reason are said once, with how many pages they held back.
  const failed = new Map<string, typeof overview.pages>();
  for (const page of overview.pages) {
    if (page.status !== "publish_failed" || page.updatedAt < since) continue;
    const reason = page.publishError ?? "";
    failed.set(reason, [...(failed.get(reason) ?? []), page]);
  }
  for (const [reason, pages] of failed) {
    const at = Math.max(...pages.map((p) => p.updatedAt));
    const what = pages.length === 1 ? `“${pages[0]!.title}”` : plural(pages.length, "page");
    entries.push({ at, tone: "wrong", href: pages.length === 1 ? `/dashboard/pages/${pages[0]!.pageId}` : "/dashboard/pages?tab=drafts",
      text: `Couldn't publish ${what}${reason ? `: ${reason}` : "."}` });
  }
  const recent = overview.questions.filter((q) => q.createdAt >= since);
  // The first hour's questions are written within minutes of the owner's confirmation.
  const setupEnd = (overview.site.confirmedAt ?? 0) + 2 * 3_600_000;
  const first = recent.filter((q) => q.source !== "owner" && q.createdAt <= setupEnd);
  const byOwner = recent.filter((q) => q.source === "owner");
  const byPentra = recent.filter((q) => q.source !== "owner" && q.createdAt > setupEnd);
  if (first.length) entries.push({ at: Math.max(...first.map((q) => q.createdAt)), href: "/dashboard/questions", text: `Found ${plural(first.length, "question")} buyers ask.` });
  if (byPentra.length) entries.push({ at: Math.max(...byPentra.map((q) => q.createdAt)), href: "/dashboard/questions", text: `Added ${plural(byPentra.length, "question")} buyers ask.` });
  if (byOwner.length) entries.push({ at: Math.max(...byOwner.map((q) => q.createdAt)), href: "/dashboard/questions", text: `You added ${plural(byOwner.length, "question")}.` });
  const pageTitle = new Map(overview.pages.map((p) => [p.pageId, p.title]));
  for (const citation of overview.citations) {
    if (citation.at < since) continue;
    const title = citation.pageId ? pageTitle.get(citation.pageId) : null;
    const who = ASSISTANTS.find((a) => a.id === citation.assistant)?.name ?? citation.assistant;
    entries.push({ at: citation.at, tone: "named", href: "/dashboard/citations",
      text: title ? `${who} cited “${title}”${citation.first ? ", its first citation" : ""}.` : `${who} cited ${citation.url.replace(/^https?:\/\//, "")}.` });
  }
  return entries.sort((a, b) => b.at - a.at);
}

/** Questions Pentra rates winnable, best first. */
export function winnable(questions: readonly OverviewQuestion[]): OverviewQuestion[] {
  return questions
    .filter((q) => q.status === "active" && q.opportunity?.status === "winnable")
    .sort((a, b) => (b.opportunity?.score ?? 0) - (a.opportunity?.score ?? 0));
}

export type QuestionFilter = "all" | "winnable" | "covered" | "monitoring" | "named" | "not_named" | "paused" | "new";

export function questionMatches(q: OverviewQuestion, filter: QuestionFilter, now: number): boolean {
  switch (filter) {
    case "all": return q.status !== "removed";
    case "winnable": case "covered": case "monitoring": return q.status === "active" && q.opportunity?.status === filter;
    case "named": return (q.latest?.named ?? 0) > 0;
    case "not_named": return !!q.latest && q.latest.answered > 0 && q.latest.named === 0;
    case "paused": return q.status === "paused";
    case "new": return now - q.createdAt < WEEK_MS;
  }
}

/** The competitor named most often for a question, with the answers it was named in. */
export function topCompetitor(q: OverviewQuestion): { name: string; answers: number } | null {
  return q.latest?.competitorsNamed?.[0] ?? null;
}

/**
 * Per competitor: the questions where answers named them and never the business (from each question's latest
 * result), most answers first. Each opens that question's evidence.
 */
export function rivalOnlyQuestions(questions: readonly OverviewQuestion[], competitor: string) {
  return questions
    .filter((q) => q.status !== "removed" && q.latest && q.latest.named === 0)
    .map((q) => ({ question: q, answers: q.latest!.competitorsNamed.find((c) => c.name === competitor)?.answers ?? 0 }))
    .filter((row) => row.answers > 0)
    .sort((a, b) => b.answers - a.answers);
}

export type Destination =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "hosted"; host: string; live: boolean; status: string; label: string }
  | { kind: "site"; method: string; label: string };

/** Where answer pages publish, said plainly (answerPublish.publishPage: the hosted address, else the site's connection). */
export function describeDestination(publishing: Publishing | null, connection: SiteConnection | null | undefined): Destination {
  if (publishing?.target === "hosted" && publishing.hostedDomain) {
    const live = publishing.hostedStatus === "live";
    return { kind: "hosted", host: publishing.hostedDomain, live, status: publishing.hostedStatus ?? "pending_dns",
      label: live ? publishing.hostedDomain : `${publishing.hostedDomain} (once its DNS record is live)` };
  }
  if (connection === undefined) return { kind: "loading" };
  const method = connection?.publishMethod ?? "manual";
  if (!connection || method === "manual") return { kind: "none" };
  const name = PUBLISH_METHOD_LABELS[method] ?? method;
  if (method === "github" && connection.repoOwner && connection.repoName) return { kind: "site", method, label: `${connection.repoOwner}/${connection.repoName} on GitHub` };
  if (method === "wordpress" && connection.wpUrl) return { kind: "site", method, label: `${displayUrl(connection.wpUrl)} (WordPress)` };
  if (method === "webhook") return { kind: "site", method, label: "your signed webhook" };
  return { kind: "site", method, label: `your ${name} site` };
}
