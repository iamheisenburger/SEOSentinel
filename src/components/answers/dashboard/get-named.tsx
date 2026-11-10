"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Copy, ExternalLink } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ChipScroller, Notice, Panel, PanelSkeleton, ScreenHeader } from "@/components/answers/ui";
import { plural } from "@/lib/answers/format";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

type Kind = "community" | "video" | "article" | "directory" | "social" | "rival";
const KIND_LABEL: Record<Kind, string> = {
  community: "Threads", video: "Videos", article: "Articles", directory: "Directories", social: "Social", rival: "Competitors' own pages",
};
const KIND_ACTION: Record<Kind, string> = {
  community: "Reply in the thread (drafts below)",
  video: "Make a video that answers the question",
  article: "Pitch the editor to add you",
  directory: "Get listed",
  social: "Post on your profile",
  rival: "Watch: a competitor's own page",
};

/** Get named: who the assistants recommend instead, the pages they read, and the work that puts the business there. */
export function AnswersGetNamed({ siteId }: { siteId: string }) {
  const plan = useQuery(api.answerGrowth.plan, { siteId: siteId as Id<"sites"> });
  if (plan === undefined) return <><ScreenHeader title="Get named" /><PanelSkeleton lines={8} /></>;
  if (plan === null) return <Notice>This site&apos;s plan isn&apos;t available.</Notice>;
  return <Body siteId={siteId} plan={plan} />;
}

type Plan = NonNullable<FunctionReturnType<typeof api.answerGrowth.plan>>;

function Body({ siteId, plan }: { siteId: string; plan: Plan }) {
  const prepare = useMutation(api.answerGrowth.prepare);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await prepare({ siteId: siteId as Id<"sites"> });
      toast("Preparing: who wins, pages to pitch and replies to post appear here as they're ready.", "success");
    } catch (e) {
      toast(userErrorMessage(e, "Pentra couldn't start. Try again."), "error");
    } finally { setBusy(false); }
  };
  const { you } = plan;
  return (
    <>
      <ScreenHeader title="Get named"
        meta={`From ${plural(you.answered, "answer")} to ${plural(you.questions, "question")} over the last ${plan.windowDays} days`}
        actions={<Button onClick={run} loading={busy} loadingLabel="Starting…">Prepare the work</Button>} />
      <Notice tone="you">
        <strong className="font-medium text-text">{you.name}</strong> is recommended in {you.named} of {you.answered} answers
        ({you.questionsNamed} of {you.questions} questions). Its pages are read as a source in {you.cited}.
        Assistants recommend the businesses the pages they read name: below is who wins now, those pages, and the work to get onto them.
      </Notice>
      <Recommended plan={plan} />
      <SourcesPanel plan={plan} />
      <Posts plan={plan} />
      <Pitches siteId={siteId} />
    </>
  );
}

function Recommended({ plan }: { plan: Plan }) {
  const rows = plan.recommended;
  return (
    <Panel title="Who the assistants recommend instead"
      description={plan.listed < plan.you.answered
        ? `From the ${plan.listed} of ${plan.you.answered} answers whose businesses are on record. "Prepare the work" lists the rest.`
        : "Answers naming each business, most first."}>
      {rows.length ? (
        <ol className="flex flex-col divide-y divide-border">
          {rows.map((r, i) => (
            <li key={r.name} className="flex items-center gap-3 py-2">
              <span className="w-6 text-right font-mono text-[12px] text-text-4">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[14px] text-text">{r.name}</span>
              <span className="font-mono text-[12px] tabular-nums text-text-3">{r.answers} of {plan.you.answered}</span>
            </li>
          ))}
        </ol>
      ) : <p className="text-[13px] text-text-3">Nothing on record yet. Press &ldquo;Prepare the work&rdquo;.</p>}
    </Panel>
  );
}

function SourcesPanel({ plan }: { plan: Plan }) {
  const kinds = (Object.keys(KIND_LABEL) as Kind[]).filter((k) => plan.kinds[k] > 0).sort((a, b) => plan.kinds[b] - plan.kinds[a]);
  const [kind, setKind] = useState<Kind | "all">("all");
  const rows = plan.sources.filter((s) => kind === "all" || s.kind === kind);
  return (
    <Panel title="The pages the assistants read" description="Every page the answers cite, most-cited first, with what to do about it. Each opens the page.">
      <ChipScroller label="Kind of page" className="mb-3">
        {(["all", ...kinds] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={cx("inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors",
              kind === k ? "border-border-strong bg-surface-3 text-text" : "border-border text-text-3 hover:bg-surface-2 hover:text-text")}>
            {k === "all" ? `All · ${plan.sources.length}` : `${KIND_LABEL[k]} · ${plan.kinds[k]} answers`}
          </button>
        ))}
      </ChipScroller>
      <ul className="flex flex-col divide-y divide-border">
        {rows.slice(0, 40).map((s) => (
          <li key={s.url} className="flex items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <a href={s.url} target="_blank" rel="noreferrer" className="group inline-flex max-w-full items-center gap-1.5 text-[14px] text-text hover:underline">
                <span className="truncate">{s.title || s.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-4 group-hover:text-text-2" strokeWidth={1.5} />
              </a>
              <p className="mt-0.5 truncate text-[12px] text-text-3"><span className="font-mono">{s.domain}</span> · {KIND_ACTION[s.kind as Kind]}</p>
            </div>
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-text-3">{plural(s.answers, "answer")}</span>
          </li>
        ))}
      </ul>
      {!rows.length && <p className="text-[13px] text-text-3">No pages of this kind yet.</p>}
    </Panel>
  );
}

function Posts({ plan }: { plan: Plan }) {
  const setStatus = useMutation(api.answerGrowth.setPostStatus);
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const todo = plan.posts.filter((p) => p.status === "todo");
  const done = plan.posts.filter((p) => p.status !== "todo");
  const mark = async (postId: string, status: "posted" | "skipped") => {
    try { await setStatus({ postId: postId as Id<"answer_posts">, status }); }
    catch (e) { toast(userErrorMessage(e, "Couldn't save. Try again."), "error"); }
  };
  const copy = async (postId: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(postId); window.setTimeout(() => setCopied(null), 2_000); }
    catch { toast("Couldn't copy. Select the text instead.", "error"); }
  };
  return (
    <Panel title="Replies to post" description="Threads the assistants read, each with a reply drafted from your own facts. Forums ban automated posting, so you post it: open the thread, paste, edit if you like, then mark it posted.">
      {todo.length ? (
        <ul className="flex flex-col gap-4">
          {todo.map((p) => (
            <li key={p.postId} className="rounded-card border border-border bg-surface-2/40 p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[14px] font-medium text-text hover:underline">
                    <span className="truncate">{p.title || p.url}</span><ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-4" strokeWidth={1.5} />
                  </a>
                  <p className="mt-0.5 text-[12px] text-text-3">{p.platform} · cited in {plural(p.answers, "answer")}{p.threadRead ? "" : " · written from the title (the thread couldn't be read)"}{p.fits ? "" : " · doesn't name you: it didn't fit"}</p>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-[14px] leading-[22px] text-text-2">{p.draft}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => copy(p.postId, p.draft)}
                  icon={copied === p.postId ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />}>
                  {copied === p.postId ? "Copied" : "Copy reply"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => mark(p.postId, "posted")}>Mark posted</Button>
                <Button size="sm" variant="ghost" onClick={() => mark(p.postId, "skipped")}>Skip</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-text-3">{plan.posts.length ? "All done. New threads get replies the next time the work is prepared." : "No replies yet. Press “Prepare the work”."}</p>}
      {done.length > 0 && <p className="mt-3 text-[12px] text-text-3">{done.filter((p) => p.status === "posted").length} posted · {done.filter((p) => p.status === "skipped").length} skipped</p>}
    </Panel>
  );
}

function Pitches({ siteId }: { siteId: string }) {
  const data = useQuery(api.linkOpportunities.listForSite, { siteId: siteId as Id<"sites"> });
  const approve = useMutation(api.linkOpportunities.approve);
  const dismiss = useMutation(api.linkOpportunities.dismiss);
  const { toast } = useToast();
  const [open, setOpen] = useState<string | null>(null);
  if (data === undefined) return <PanelSkeleton lines={4} />;
  if (data === null) return null;
  const ready = data.items.filter((o) => o.status === "ready");
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, "success"); } catch (e) { toast(userErrorMessage(e, "Couldn't do that. Try again."), "error"); }
  };
  return (
    <Panel title="Pitches to editors"
      description={data.mode === "send" ? "Sent automatically from your mailbox, a few a day; every reply and live link is tracked."
        : "Emails to the editors of pages that name your competitors. Nothing goes out until you press Send."}>
      <p className="mb-3 font-mono text-[12px] text-text-3">
        {data.counts.found} pages found · {data.counts.ready} ready · {data.counts.contacted} contacted · {data.counts.replied} replied · {data.counts.won} links won
      </p>
      {ready.length ? (
        <ul className="flex flex-col divide-y divide-border">
          {ready.map((o) => (
            <li key={o.id} className="py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <a href={o.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[14px] text-text hover:underline">
                    <span className="truncate">{o.title}</span><ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-4" strokeWidth={1.5} />
                  </a>
                  <p className="mt-0.5 truncate text-[12px] text-text-3">to {o.contact ?? "?"} · links to {o.linksTo.join(", ")}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? "Hide" : "Read"}</Button>
              </div>
              {open === o.id && o.pitch && (
                <div className="mt-2 rounded-card border border-border bg-surface-2/40 p-3">
                  <p className="text-[13px] font-medium text-text">{o.pitch.subject}</p>
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-[20px] text-text-2">{o.pitch.body}</p>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => act(() => approve({ siteId: siteId as Id<"sites">, id: o.id }), "Queued: it goes out at the next allowed moment.")} disabled={o.approved}>
                  {o.approved ? "Queued" : "Send"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => act(() => dismiss({ siteId: siteId as Id<"sites">, id: o.id }), "Set aside.")}>Set aside</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-text-3">No pitch ready yet. Pentra looks for pages when the work is prepared; pages that name no competitor are set aside.</p>}
    </Panel>
  );
}
