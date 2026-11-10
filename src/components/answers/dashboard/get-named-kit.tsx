"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Check, Copy, Download, ExternalLink, Film } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { fieldStyles } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Panel, PanelSkeleton } from "@/components/answers/ui";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

type Extras = NonNullable<FunctionReturnType<typeof api.answerGrowthKit.extras>>;

/** Get named, part two: comparison pages, answer videos and directory listings. */
export function GetNamedKit({ siteId }: { siteId: string }) {
  const extras = useQuery(api.answerGrowthKit.extras, { siteId: siteId as Id<"sites"> });
  if (extras === undefined) return <PanelSkeleton lines={6} />;
  if (extras === null) return null;
  return (
    <>
      <Videos siteId={siteId} extras={extras} />
      <Comparisons siteId={siteId} extras={extras} />
      <Listings siteId={siteId} extras={extras} />
    </>
  );
}

function useAct() {
  const { toast } = useToast();
  return async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok, "success"); return true; }
    catch (e) { toast(userErrorMessage(e, "Couldn't do that. Try again."), "error"); return false; }
  };
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); window.setTimeout(() => setDone(false), 1_800); } catch { /* select instead */ } }}
      icon={done ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />}>
      {done ? "Copied" : label}
    </Button>
  );
}

// ── Comparison pages ──

function Comparisons({ siteId, extras }: { siteId: string; extras: Extras }) {
  const write = useMutation(api.answerGrowthKit.writeComparison);
  const act = useAct();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Panel title="Comparison pages" description={`A page on your site beside each competitor the assistants recommend: who each suits, ${extras.business.name} described from its own pages and the competitor from theirs (never their prices, never what they lack). Published like your answer pages.`}>
      {extras.comparisons.length ? (
        <ul className="flex flex-col divide-y divide-border">
          {extras.comparisons.map((c) => (
            <li key={c.domain} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-text">{extras.business.name} vs {c.name}</p>
                <p className="truncate text-[12px] text-text-3"><span className="font-mono">{c.domain}</span> · recommended in {c.answers} answers
                  {c.page ? ` · ${c.page.status === "published" ? "published" : c.page.status === "not_written" ? `not written: ${c.page.reason ?? ""}` : c.page.status}` : ""}</p>
              </div>
              {c.page?.publishedUrl ? (
                <a href={c.page.publishedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-text-2 hover:text-text">Open <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} /></a>
              ) : (!c.page || c.page.status === "not_written") ? (
                <Button size="sm" variant="secondary" loading={busy === c.domain} loadingLabel="Starting…"
                  onClick={async () => { setBusy(c.domain); await act(() => write({ siteId: siteId as Id<"sites">, name: c.name, domain: c.domain }), "Writing it: it appears under Answer pages, then publishes."); setBusy(null); }}>
                  Write the page
                </Button>
              ) : <span className="text-[12px] text-text-3">{c.page.status === "writing" ? "Writing…" : c.page.status}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-text-3">No competitor with its own site in the answers yet. They appear once the answers are listed (&ldquo;Prepare the work&rdquo;).</p>}
    </Panel>
  );
}

// ── Answer videos ──

function Videos({ siteId, extras }: { siteId: string; extras: Extras }) {
  const make = useMutation(api.answerGrowthKit.makeVideo);
  const act = useAct();
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const start = async (question: string) => { setBusy(question); await act(() => make({ siteId: siteId as Id<"sites">, question }), "Making it: about three minutes, start to finish."); setBusy(null); };
  return (
    <Panel title="Videos to upload" description="The assistants read YouTube for these questions. Pentra writes a one-minute animated answer in your brand's colour, voices it, shows your real site and renders the finished video. YouTube doesn't allow uploads by tools like this, so you download it and upload it with the title and description below.">
      {extras.videoSuggestions.length > 0 && (
        <ul className="mb-4 flex flex-col divide-y divide-border">
          {extras.videoSuggestions.map((s) => (
            <li key={s.question} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 text-[14px] text-text">{s.question}</span>
              <span className="text-[12px] text-text-3">{s.videoAnswers ? `${s.videoAnswers} answers cite videos` : ""}</span>
              <Button size="sm" variant="secondary" loading={busy === s.question} loadingLabel="Starting…" onClick={() => start(s.question)} icon={<Film className="h-3.5 w-3.5" strokeWidth={1.5} />}>Make video</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mb-4 flex max-w-[640px] gap-2">
        <label htmlFor="video-question" className="sr-only">Another question</label>
        <input id="video-question" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or type a question buyers ask" className={cx(fieldStyles, "h-9 min-w-0 flex-1 text-[14px]")} />
        <Button size="sm" variant="secondary" className="h-9" disabled={custom.trim().length < 8} onClick={async () => { await start(custom.trim()); setCustom(""); }}>Make video</Button>
      </div>
      {extras.videos.length ? (
        <ul className="flex flex-col gap-3">
          {extras.videos.map((video) => <VideoRow key={video.videoId} video={video} />)}
        </ul>
      ) : <p className="text-[13px] text-text-3">No videos yet.</p>}
    </Panel>
  );
}

function DownloadButton({ url, name, label }: { url: string; name: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      // The file is on another address, so the browser's download attribute alone would open it instead of saving it.
      const blob = await (await fetch(url)).blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch { window.open(url, "_blank", "noopener"); } finally { setBusy(false); }
  };
  return <Button size="sm" onClick={download} loading={busy} loadingLabel="Downloading…" icon={<Download className="h-3.5 w-3.5" strokeWidth={1.5} />}>{label}</Button>;
}

function VideoRow({ video }: { video: Extras["videos"][number] }) {
  const setVideo = useMutation(api.answerGrowthKit.setVideo);
  const makeVertical = useMutation(api.answerGrowthKit.makeVertical);
  const retry = useMutation(api.answerGrowthKit.retryVideo);
  const act = useAct();
  const [open, setOpen] = useState(video.status === "ready");
  const [url, setUrl] = useState("");
  const legacy = video.version !== 2;
  const done = !legacy && (video.status === "ready" || video.status === "uploaded" || video.status === "skipped") && video.landscapeUrl;
  const slug = (video.title ?? video.question).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "answer-video";
  const status = legacy ? "Made with the first video maker (a slideshow). Make it again for the animated version."
    : video.status === "writing" ? "Writing the scenes and recording the voice…"
    : video.status === "rendering" ? "Rendering the video: about two minutes…"
    : video.status === "failed" ? `Not made: ${video.error ?? ""}`
    : video.status === "uploaded" ? "Uploaded" : video.status === "skipped" ? "Skipped" : `Ready · ${Math.round((video.durationMs ?? 0) / 1000)} seconds of voice`;
  return (
    <li className="rounded-card border border-border bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-text">{video.title ?? video.question}</p>
          <p className="mt-0.5 text-[12px] text-text-3">{status}
            {video.youtubeUrl && <> · <a href={video.youtubeUrl} target="_blank" rel="noreferrer" className="underline">on YouTube</a></>}</p>
        </div>
        {(legacy || video.status === "failed") && <Button size="sm" variant="secondary" onClick={() => act(() => retry({ videoId: video.videoId }), "Making it again.")}>{legacy ? "Make it again" : "Try again"}</Button>}
        {done && <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Open"}</Button>}
      </div>
      {done && open && video.landscapeUrl && (
        <div className="mt-3 flex flex-col gap-3">
          <video src={video.landscapeUrl} controls preload="metadata" className="w-full max-w-[720px] rounded-[10px] border border-border bg-black" />
          <div className="flex flex-wrap items-center gap-2">
            <DownloadButton url={video.landscapeUrl} name={`${slug}.mp4`} label="Download for YouTube (16:9)" />
            {video.verticalUrl ? <DownloadButton url={video.verticalUrl} name={`${slug}-shorts.mp4`} label="Download for Shorts (9:16)" />
              : video.verticalState === "queued" || video.verticalState === "rendering" ? <span className="text-[12px] text-text-3">Rendering the Shorts version…</span>
              : <Button size="sm" variant="secondary" onClick={() => act(() => makeVertical({ videoId: video.videoId }), "Rendering the Shorts version: about two minutes.")}>Make the Shorts version</Button>}
            {video.verticalError && !video.verticalUrl && <span className="text-[12px] text-[#F2994A]">{video.verticalError}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={video.title ?? video.question} label="Copy title" />
            <CopyButton text={video.description ?? ""} label="Copy description" />
            <CopyButton text={(video.tags ?? []).join(", ")} label="Copy tags" />
          </div>
          <div className="flex max-w-[640px] gap-2">
            <label htmlFor={`yt-${video.videoId}`} className="sr-only">YouTube address</label>
            <input id={`yt-${video.videoId}`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the YouTube address once it's up" className={cx(fieldStyles, "h-9 min-w-0 flex-1 text-[14px]")} />
            <Button size="sm" className="h-9" disabled={!url.trim()} onClick={() => act(() => setVideo({ videoId: video.videoId, status: "uploaded", youtubeUrl: url.trim() }), "Saved.")}>Mark uploaded</Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => act(() => setVideo({ videoId: video.videoId, status: "skipped" }))}>Skip</Button>
          </div>
        </div>
      )}
    </li>
  );
}

// ── Directory listings ──

function Listings({ siteId, extras }: { siteId: string; extras: Extras }) {
  const make = useMutation(api.answerGrowthKit.makeListingKit);
  const setListing = useMutation(api.answerGrowthKit.setListing);
  const act = useAct();
  const [live, setLive] = useState<Record<string, string>>({});
  const kit = extras.listing.kit;
  const f = kit?.fields ?? null;
  return (
    <Panel title="Directory listings" description="Directories and review sites the assistants read, and the ones that fit your kind of business. Pentra writes your listing once from your own pages; you paste it into each one (they need your account, so you sign up).">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button size="sm" variant={f ? "secondary" : "primary"} disabled={kit?.status === "writing"}
          onClick={() => act(() => make({ siteId: siteId as Id<"sites"> }), "Writing your listing: about a minute.")}>
          {kit?.status === "writing" ? "Writing your listing…" : f ? "Write it again" : "Write my listing"}
        </Button>
        <span className="font-mono text-[12px] text-text-3">{extras.listing.counts.live} live · {extras.listing.counts.submitted} submitted · {extras.listing.counts.total} to do</span>
        {kit?.status === "failed" && <span className="text-[12px] text-[#F2994A]">{kit.error}</span>}
      </div>
      {f && (
        <div className="mb-4 grid gap-3 rounded-card border border-border bg-surface-2/40 p-4 sm:grid-cols-2">
          {([["Tagline", f.tagline], ["Short description", f.shortDescription], ["Description", f.longDescription], ["Categories", f.categories.join(", ")],
            ["Features", f.features.map((x) => `- ${x}`).join("\n")], ["Use cases", f.useCases.map((x) => `- ${x}`).join("\n")], ["Pricing", f.pricing], ["Who it's for", f.audience],
            ["FAQ", f.faqs.map((q) => `${q.q}\n${q.a}`).join("\n\n")]] as const).map(([label, text]) => (
            <div key={label} className={cx("min-w-0", (label === "Description" || label === "FAQ") && "sm:col-span-2")}>
              <div className="mb-1 flex items-center justify-between gap-2"><span className="mono-caps text-text-3">{label}</span><CopyButton text={text} /></div>
              <p className="whitespace-pre-wrap text-[13px] leading-[20px] text-text-2">{text}</p>
            </div>
          ))}
        </div>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {extras.listing.directories.map((d) => (
          <li key={d.domain} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <a href={d.submitUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[14px] text-text hover:underline">{d.name}<ExternalLink aria-hidden="true" className="h-3.5 w-3.5 text-text-4" strokeWidth={1.5} /></a>
              <p className="text-[12px] text-text-3">{d.citedIn ? `The assistants read it: ${d.citedIn} answers · ` : ""}{d.note ?? ""}{d.liveUrl ? <> · <a href={d.liveUrl} target="_blank" rel="noreferrer" className="underline">your listing</a></> : null}</p>
            </div>
            <span className={cx("text-[12px]", d.status === "live" ? "text-text" : "text-text-3")}>{d.status === "todo" ? "" : d.status}</span>
            {d.status !== "live" && (
              <>
                {d.status !== "submitted" && <Button size="sm" variant="ghost" onClick={() => act(() => setListing({ siteId: siteId as Id<"sites">, domain: d.domain, name: d.name, status: "submitted" }))}>Submitted</Button>}
                <input aria-label={`${d.name} listing address`} value={live[d.domain] ?? ""} onChange={(e) => setLive({ ...live, [d.domain]: e.target.value })} placeholder="Listing address"
                  className={cx(fieldStyles, "h-8 w-[180px] text-[13px]")} />
                <Button size="sm" variant="secondary" disabled={!(live[d.domain] ?? "").trim()}
                  onClick={() => act(() => setListing({ siteId: siteId as Id<"sites">, domain: d.domain, name: d.name, status: "live", liveUrl: (live[d.domain] ?? "").trim() }), "Saved.")}>Live</Button>
                <Button size="sm" variant="ghost" onClick={() => act(() => setListing({ siteId: siteId as Id<"sites">, domain: d.domain, name: d.name, status: "skipped" }))}>Skip</Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
