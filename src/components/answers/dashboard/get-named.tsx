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
import { Comparisons, Listings, Videos, type GetNamedExtras } from "@/components/answers/dashboard/get-named-kit";
import { Tabs, useTabParam } from "@/components/ui/tabs";
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

const TABS = ["today", "replies", "pitches", "videos", "listings", "comparisons", "research"] as const;
type Tab = (typeof TABS)[number];

function Body({ siteId, plan }: { siteId: string; plan: Plan }) {
  const prepare = useMutation(api.answerGrowth.prepare);
  const extras = useQuery(api.answerGrowthKit.extras, { siteId: siteId as Id<"sites"> });
  const pitches = useQuery(api.linkOpportunities.listForSite, { siteId: siteId as Id<"sites"> });
  const [tab, setTab] = useTabParam<Tab>("tab", TABS, "today");
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await prepare({ siteId: siteId as Id<"sites"> });
      toast("Preparing new work now. It appears here as it's ready.", "success");
    } catch (e) {
      toast(userErrorMessage(e, "Pentra couldn't start. Try again."), "error");
    } finally { setBusy(false); }
  };
  const { you } = plan;
  const replies = plan.posts.filter((p) => p.status === "todo").length;
  const ready = pitches?.items.filter((o) => o.status === "ready" && !o.approved).length ?? 0;
  const videos = extras?.videos.filter((v) => v.version === 2 && v.status === "ready").length ?? 0;
  const making = extras?.videos.filter((v) => v.status === "writing" || v.status === "rendering").length ?? 0;
  const listings = extras?.listing.directories.filter((d) => d.status === "todo").length ?? 0;
  const comparisons = extras?.comparisons ?? [];
  const toWrite = comparisons.filter((c) => !c.page || c.page.status === "not_written").length;
  return (
    <>
      <ScreenHeader title="Get named"
        meta={plan.preparedAt ? `New work is prepared every day · last ${new Date(plan.preparedAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "New work is prepared every day"}
        actions={<Button variant="secondary" onClick={run} loading={busy} loadingLabel="Starting…">Prepare more now</Button>} />
      <div>
        <Tabs label="Get named" idPrefix="named" active={tab} onChange={(id) => setTab(id as Tab)}
          tabs={[{ id: "today", label: "Today" }, { id: "replies", label: "Replies", count: replies }, { id: "pitches", label: "Pitches", count: ready },
            { id: "videos", label: "Videos", count: videos }, { id: "listings", label: "Listings", count: listings },
            { id: "comparisons", label: "Comparisons", count: toWrite }, { id: "research", label: "Where AI looks" }]} />
        <div id={`named-panel-${tab}`} role="tabpanel" aria-labelledby={`named-tab-${tab}`} className="mt-5 flex flex-col gap-5">
          {tab === "today" && (
            <>
              <Notice tone="you">
                <strong className="font-medium text-text">{you.name}</strong> is recommended in <strong className="font-medium text-text">{you.named} of {you.answered}</strong> AI
                answers so far. AI recommends the businesses that the pages it reads name. Each job below puts {you.name} on those pages.
              </Notice>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <TodoCard count={replies} unit="replies to post" what="Reddit and Quora threads the AI reads. Copy, post, mark posted." onOpen={() => setTab("replies")} />
                <TodoCard count={ready} unit="pitches to send" what="Emails to writers of the articles the AI quotes. Read, then Send." onOpen={() => setTab("pitches")} />
                <TodoCard count={videos} unit={making ? `videos ready · ${making} being made` : "videos to upload"} what="Finished one-minute videos. Download, upload to YouTube." onOpen={() => setTab("videos")} />
                <TodoCard count={listings} unit="directories to join" what="Sign up and paste the listing Pentra wrote." onOpen={() => setTab("listings")} />
                <TodoCard count={comparisons.filter((c) => c.page?.status === "published").length} unit={`of ${comparisons.length} comparison pages live`}
                  what="Pages beside the rivals the AI recommends. Pentra writes and publishes them." onOpen={() => setTab("comparisons")} done />
                <TodoCard count={plan.recommended.length} unit="businesses the AI recommends" what={plan.recommended.slice(0, 3).map((r) => r.name).join(", ") || "Who wins today, and the pages the AI reads."}
                  onOpen={() => setTab("research")} done />
              </div>
            </>
          )}
          {tab === "replies" && <Posts plan={plan} />}
          {tab === "pitches" && <Pitches siteId={siteId} />}
          {tab === "videos" && (extras ? <Videos siteId={siteId} extras={extras as GetNamedExtras} /> : <PanelSkeleton lines={5} />)}
          {tab === "listings" && (extras ? <Listings siteId={siteId} extras={extras as GetNamedExtras} /> : <PanelSkeleton lines={5} />)}
          {tab === "comparisons" && (extras ? <Comparisons siteId={siteId} extras={extras as GetNamedExtras} /> : <PanelSkeleton lines={5} />)}
          {tab === "research" && <><Recommended plan={plan} /><SourcesPanel plan={plan} /></>}
        </div>
      </div>
    </>
  );
}

/** One job on the Today tab: how many are waiting, what it is in one line, and the way in. */
function TodoCard({ count, unit, what, onOpen, done }: { count: number; unit: string; what: string; onOpen: () => void; done?: boolean }) {
  return (
    <button type="button" onClick={onOpen}
      className="group flex flex-col gap-2 rounded-card border border-border bg-surface-1 p-4 text-left transition-colors duration-[var(--d-instant)] hover:border-border-strong hover:bg-surface-2">
      <div className="flex items-baseline gap-2">
        <span className={cx("font-mono text-[26px] font-medium tabular-nums", count > 0 && !done ? "text-text" : "text-text-3")}>{count}</span>
        <span className="text-[13px] text-text-2">{unit}</span>
      </div>
      <p className="text-[13px] leading-[19px] text-text-3">{what}</p>
      <span className="text-[12px] font-medium text-text-2 group-hover:text-text">Open →</span>
    </button>
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
                  <p className="mt-0.5 text-[12px] text-text-3">{p.platform} · {p.found === "search" ? `found by searching "${p.questions[0] ?? ""}"` : `cited in ${plural(p.answers, "answer")}`}{p.threadRead ? "" : " · written from the title (the thread couldn't be read)"}{p.fits ? "" : " · doesn't name you: it didn't fit"}</p>
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
