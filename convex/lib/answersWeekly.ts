/** Pentra Answers (Nov 2026): the weekly email, plain and factual. Counts always keep their denominators, a change is
 * said plainly ("no change" when there is none), and every number points to the stored answers. Pure. */
import { ANSWER_ASSISTANT_NAMES, isAnswerAssistant } from "./answerEngine.ts";

export type AnswersWeeklyInput = {
  name: string; domain: string;
  thisWeek: { answered: number; named: number; byAssistant: ReadonlyArray<{ assistant: string; answered: number; named: number }>;
    competitors: ReadonlyArray<{ name: string; named: number }> } | null;
  lastWeek: { answered: number; named: number } | null;
  citations: ReadonlyArray<{ assistant: string; question: string; title: string | null; at: number }>;
  published: ReadonlyArray<{ title: string; url: string | null }>;
  rewritten: ReadonlyArray<{ title: string }>;
  questionsAdded: number;
  dashboardUrl: string;
};

const assistantName = (a: string) => isAnswerAssistant(a) ? ANSWER_ASSISTANT_NAMES[a] : a;
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export function answersWeeklyEmail(input: AnswersWeeklyInput): { subject: string; text: string } {
  const lines: string[] = [];
  const t = input.thisWeek;
  if (t) {
    lines.push(`This week AI assistants named ${input.name} in ${t.named} of ${t.answered} answers.`);
    if (input.lastWeek) {
      const before = input.lastWeek;
      lines.push(before.named === t.named && before.answered === t.answered ? `Last week: ${before.named} of ${before.answered} (no change).`
        : `Last week: ${before.named} of ${before.answered}.`);
    }
    lines.push("");
    for (const a of t.byAssistant) lines.push(`- ${assistantName(a.assistant)}: ${a.named} of ${a.answered}`);
    if (t.competitors.length) {
      lines.push("", "Named instead of you most often:");
      for (const c of t.competitors.slice(0, 3)) lines.push(`- ${c.name}: ${c.named} of ${t.answered}`);
    }
  } else {
    lines.push(`Pentra hasn't finished this week's run for ${input.domain} yet. The numbers arrive with the next email.`);
  }
  lines.push("");
  if (input.citations.length) {
    lines.push(`Citations won this week: ${input.citations.length}`);
    for (const c of input.citations.slice(0, 6)) {
      lines.push(`- ${assistantName(c.assistant)} cited ${c.title ? `"${c.title}"` : "your site"} for "${c.question}" (${day(c.at)})`);
    }
  } else {
    lines.push("No assistant cited your pages this week.");
  }
  if (input.published.length) {
    lines.push("", `Published this week: ${input.published.length}`);
    for (const p of input.published.slice(0, 6)) lines.push(`- ${p.title}${p.url ? ` (${p.url})` : ""}`);
  }
  if (input.rewritten.length) {
    lines.push("", `Rewritten because no assistant cited them: ${input.rewritten.length}`);
    for (const p of input.rewritten.slice(0, 4)) lines.push(`- ${p.title}`);
  }
  if (input.questionsAdded) lines.push("", `New questions tracked: ${input.questionsAdded}`);
  lines.push("", `Every answer behind these numbers: ${input.dashboardUrl}`, "",
    "We can't make an assistant recommend you. We show every answer we collect, so you can see exactly what changed.", "",
    "You get this weekly as part of Pentra. Turn it off in Settings.");
  const subject = t ? `Named in ${t.named} of ${t.answered} AI answers this week · ${input.domain}` : `Your Pentra week · ${input.domain}`;
  return { subject, text: lines.join("\n") };
}

export type AnswersReadyInput = {
  name: string; domain: string; questions: number;
  answered: number; named: number;
  byAssistant: ReadonlyArray<{ assistant: string; answered: number; named: number }>;
  competitors: ReadonlyArray<{ name: string; named: number }>;
  drafts: ReadonlyArray<{ title: string }>; writing: number;
  /** free: the plan publishes them; publishing: they go out by themselves; connect: the plan is on, the destination isn't set. */
  next: "free" | "publishing" | "connect" | "review";
  dashboardUrl: string; billingUrl: string; settingsUrl: string;
};

/** "Your first hour is ready": the first run's counts with their denominators, the drafts, and the one next step. Pure. */
export function answersReadyEmail(input: AnswersReadyInput): { subject: string; text: string } {
  const lines: string[] = [
    `Pentra asked ChatGPT, Perplexity, Gemini, Google AI Mode and Google's AI Overviews the ${input.questions} questions your buyers ask.`,
    "",
    `${input.name} was named in ${input.named} of ${input.answered} answers.`,
    "",
  ];
  for (const a of input.byAssistant) lines.push(`- ${assistantName(a.assistant)}: ${a.named} of ${a.answered}`);
  if (input.competitors.length) {
    lines.push("", "Named instead of you most often:");
    for (const c of input.competitors.slice(0, 3)) lines.push(`- ${c.name}: ${c.named} of ${input.answered}`);
  }
  lines.push("");
  if (input.drafts.length) {
    lines.push(`Answer pages drafted for the questions you can win: ${input.drafts.length}`);
    for (const d of input.drafts.slice(0, 6)) lines.push(`- ${d.title}`);
    if (input.writing) lines.push(`(${input.writing} more ${input.writing === 1 ? "is" : "are"} still being written.)`);
  } else if (input.writing) {
    lines.push(`Pentra is writing ${input.writing} answer ${input.writing === 1 ? "page" : "pages"} for the questions you can win. ${input.writing === 1 ? "It shows" : "They show"} on your dashboard when done.`);
  }
  lines.push("");
  if (input.next === "free") lines.push(`Publishing them on your site, getting them indexed and asking the assistants again every week is the Pentra plan ($249 a month): ${input.billingUrl}`);
  else if (input.next === "publishing") lines.push("They publish to your site automatically. Pentra then asks the assistants again and records every citation.");
  else if (input.next === "connect") lines.push(`Choose where they publish, and they go out automatically: ${input.settingsUrl}`);
  else lines.push(`They wait for your review before publishing: ${input.dashboardUrl}`);
  lines.push("", `Every answer, exactly as each assistant gave it: ${input.dashboardUrl}`, "",
    "We can't make an assistant recommend you. We show every answer we collect, so you can see exactly what changes.");
  return { subject: `Your first hour: named in ${input.named} of ${input.answered} AI answers · ${input.domain}`, text: lines.join("\n") };
}
