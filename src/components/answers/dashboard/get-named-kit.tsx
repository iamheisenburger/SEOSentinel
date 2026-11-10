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
import { chapters, segmentAt, segmentTimings } from "../../../../convex/lib/videoTiming";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

type Extras = NonNullable<FunctionReturnType<typeof api.answerGrowthKit.extras>>;
type Kit = NonNullable<FunctionReturnType<typeof api.answerGrowthKit.videoKit>>;

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
  const start = async (question: string) => { setBusy(question); await act(() => make({ siteId: siteId as Id<"sites">, question }), "Making it: the script, voice and screenshot take about a minute."); setBusy(null); };
  return (
    <Panel title="Videos to upload" description="The assistants read YouTube for these questions. Pentra writes a one-minute answer, makes the voice and a screenshot of your site; your browser puts the video together and you upload it with the title and description below. YouTube doesn't allow uploads by tools like this, so you press upload.">
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

function VideoRow({ video }: { video: Extras["videos"][number] }) {
  const setVideo = useMutation(api.answerGrowthKit.setVideo);
  const act = useAct();
  const [open, setOpen] = useState(video.status === "ready");
  const [url, setUrl] = useState("");
  return (
    <li className="rounded-card border border-border bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-text">{video.title ?? video.question}</p>
          <p className="mt-0.5 text-[12px] text-text-3">
            {video.status === "writing" ? "Making the script, voice and screenshot…" : video.status === "failed" ? `Not made: ${video.error ?? ""}`
              : video.status === "uploaded" ? "Uploaded" : video.status === "skipped" ? "Skipped" : `Ready · ${Math.round((video.durationMs ?? 0) / 1000)} seconds`}
            {video.youtubeUrl && <> · <a href={video.youtubeUrl} target="_blank" rel="noreferrer" className="underline">on YouTube</a></>}
          </p>
        </div>
        {video.status === "ready" && <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Open"}</Button>}
      </div>
      {open && video.status === "ready" && (
        <div className="mt-3 flex flex-col gap-3">
          <VideoMaker videoId={video.videoId} />
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

const W = 1280, H = 720;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function drawFrame(ctx: CanvasRenderingContext2D, kit: Kit, index: number, progress: number, shot: HTMLImageElement | null) {
  const seg = kit.segments[index];
  ctx.fillStyle = "#0B0C0E";
  ctx.fillRect(0, 0, W, H);
  const withShot = index === kit.productSegment && shot !== null;
  const textWidth = withShot ? 480 : 1040;
  ctx.fillStyle = "#F7F8F8";
  ctx.font = `600 ${index === 0 ? 56 : 48}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  let y = index === 0 ? 250 : 150;
  for (const line of wrap(ctx, seg.heading, textWidth).slice(0, 4)) { ctx.fillText(line, 120, y); y += index === 0 ? 70 : 60; }
  ctx.font = `400 32px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = "#B4B8C0";
  y += 24;
  for (const point of seg.lines) {
    const lines = wrap(ctx, point, textWidth - 40).slice(0, 2);
    ctx.fillStyle = "#3DA5F5";
    ctx.fillRect(120, y - 22, 10, 10);
    ctx.fillStyle = "#B4B8C0";
    for (const l of lines) { ctx.fillText(l, 150, y); y += 44; }
    y += 10;
  }
  if (withShot && shot) {
    const boxW = 600, boxH = Math.min(440, Math.round((shot.naturalHeight / shot.naturalWidth) * boxW));
    const x = 600 + 40, top = Math.round((H - boxH) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, top, boxW, boxH, 14);
    ctx.clip();
    const scale = boxW / shot.naturalWidth;
    ctx.drawImage(shot, 0, 0, shot.naturalWidth, boxH / scale, x, top, boxW, boxH);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, top, boxW, boxH, 14);
    ctx.stroke();
  }
  ctx.font = `500 24px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = "#8A8F98";
  ctx.fillText(kit.business.domain, 120, H - 56);
  ctx.fillStyle = "rgba(255,255,255,.08)";
  ctx.fillRect(0, H - 6, W, 6);
  ctx.fillStyle = "#3DA5F5";
  ctx.fillRect(0, H - 6, Math.round(W * Math.min(1, progress)), 6);
}

async function blobUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("A video part couldn't be loaded.");
  return URL.createObjectURL(await response.blob());
}

/** Puts one video together in this browser: the voice plays into a recorder while each segment is drawn in time. */
function VideoMaker({ videoId }: { videoId: string }) {
  const kit = useQuery(api.answerGrowthKit.videoKit, { videoId: videoId as Id<"answer_videos"> });
  const [state, setState] = useState<"idle" | "recording" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<{ url: string; name: string; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (kit === undefined) return <p className="text-[13px] text-text-3">Loading the video&apos;s parts…</p>;
  if (kit === null) return <p className="text-[13px] text-text-3">This video&apos;s parts aren&apos;t ready.</p>;

  const record = async () => {
    setState("recording"); setError(null); setProgress(0);
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser can't record video. Use Chrome, Edge or Firefox.");
      const audioCtx = new AudioContext();
      const buffer = await audioCtx.decodeAudioData(await (await fetch(await blobUrl(kit.audioUrl!))).arrayBuffer());
      let shot: HTMLImageElement | null = null;
      if (kit.screenshotUrl) {
        shot = await new Promise<HTMLImageElement | null>(async (resolve) => {
          try { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = await blobUrl(kit.screenshotUrl!); } catch { resolve(null); }
        });
      }
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const durationMs = buffer.duration * 1000;
      const timings = segmentTimings(kit.segments.map((s) => s.narration), durationMs);
      drawFrame(ctx, kit, 0, 0, shot);
      const video = canvas.captureStream(30);
      const dest = audioCtx.createMediaStreamDestination();
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(dest);
      const stream = new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 3_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      recorder.start(500);
      const startAt = audioCtx.currentTime + 0.4;
      source.start(startAt);
      await new Promise<void>((resolve) => {
        const tick = () => {
          const ms = Math.max(0, (audioCtx.currentTime - startAt) * 1000);
          drawFrame(ctx, kit, segmentAt(timings, ms), ms / durationMs, shot);
          setProgress(Math.min(1, ms / durationMs));
          if (ms >= durationMs + 600) resolve(); else window.setTimeout(tick, 33);
        };
        tick();
      });
      recorder.stop();
      await stopped;
      await audioCtx.close();
      const mime = recorder.mimeType || type || "video/webm";
      const blob = new Blob(chunks, { type: mime });
      const slug = kit.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "answer-video";
      setFile({ url: URL.createObjectURL(blob), name: `${slug}.${mime.includes("mp4") ? "mp4" : "webm"}`, type: mime });
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The video couldn't be put together.");
      setState("error");
    }
  };

  const description = kit.durationMs ? `${kit.description}\n\n${chapters(kit.segments.map((s) => s.heading), segmentTimings(kit.segments.map((s) => s.narration), kit.durationMs))}` : kit.description;
  return (
    <div className="rounded-card border border-border p-3">
      {state === "done" && file ? (
        <div className="flex flex-col gap-2">
          <video src={file.url} controls className="w-full max-w-[640px] rounded-[8px] border border-border" />
          <div className="flex flex-wrap gap-2">
            <a href={file.url} download={file.name} className="inline-flex h-8 items-center gap-1.5 rounded-control bg-white px-3 text-[13px] font-medium text-black">
              <Download className="h-3.5 w-3.5" strokeWidth={1.5} />Download video
            </a>
            <CopyButton text={description} label="Copy description with chapters" />
            <Button size="sm" variant="ghost" onClick={() => setState("idle")}>Make it again</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={record} disabled={state === "recording"} icon={<Film className="h-3.5 w-3.5" strokeWidth={1.5} />}>
            {state === "recording" ? `Putting it together… ${Math.round(progress * 100)}%` : "Put the video together"}
          </Button>
          <span className="text-[12px] text-text-3">{state === "recording" ? "Keep this tab open: it records in real time." : `About ${Math.round((kit.durationMs ?? 60_000) / 1000)} seconds. Keep this tab open while it records.`}</span>
          {error && <span className="text-[12px] text-[#F2994A]">{error}</span>}
        </div>
      )}
    </div>
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
