import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Geist";
import { captionPages, isRemote, LEAD_FRAMES, type VideoCaption } from "./types";

/** A web address as it is; a public-folder name through staticFile. */
export const asset = (src: string) => (isRemote(src) ? src : staticFile(src));

export const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] });

export const INK = "#F5F6F7";
export const MUTED = "#A3A8B3";
export const CANVAS = "#0A0B0D";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.bezier(0.16, 1, 0.3, 1);

/** Whether the video is the vertical cut (Shorts, Reels). */
export function useVertical() {
  const { width, height } = useVideoConfig();
  return height > width;
}

/** The canvas: near-black, two slow glows in the brand's colour, a faint dot grid and a vignette. */
export function Background({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame / 30;
  return (
    <AbsoluteFill style={{ backgroundColor: CANVAS, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: width * 0.9, height: width * 0.9, borderRadius: "50%", left: -width * 0.25 + Math.sin(t / 5) * 60,
        top: -height * 0.45 + Math.cos(t / 6) * 50, background: `radial-gradient(circle, ${accent}33 0%, ${accent}00 62%)` }} />
      <div style={{ position: "absolute", width: width * 0.8, height: width * 0.8, borderRadius: "50%", right: -width * 0.3 + Math.cos(t / 7) * 70,
        bottom: -height * 0.6 + Math.sin(t / 4) * 40, background: `radial-gradient(circle, ${accent}22 0%, ${accent}00 60%)` }} />
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1.2px, transparent 1.2px)", backgroundSize: "44px 44px",
        maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)" }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
    </AbsoluteFill>
  );
}

/** The business's name, top left, on every scene. */
export function BrandMark({ name, accent }: { name: string; accent: string }) {
  const vertical = useVertical();
  return (
    <div style={{ position: "absolute", top: vertical ? 110 : 64, left: vertical ? 80 : 96, display: "flex", alignItems: "center", gap: 14, fontFamily,
      fontSize: vertical ? 40 : 30, fontWeight: 600, color: INK, letterSpacing: "-0.01em" }}>
      <div style={{ width: vertical ? 40 : 30, height: vertical ? 40 : 30, borderRadius: 9, background: `linear-gradient(135deg, ${accent}, ${accent}88)`,
        boxShadow: `0 0 24px ${accent}55` }} />
      {name}
    </div>
  );
}

/** A line whose words rise in one after another; the emphasised words in the brand's colour. */
export function WordsIn({ text, emphasis, size, weight = 700, delay = 0, color = INK, accent, lineHeight = 1.08, style }: {
  text: string; emphasis: readonly string[]; size: number; weight?: number; delay?: number; color?: string; accent: string; lineHeight?: number; style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
  const marked = new Set(emphasis.map(bare));
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div style={{ fontFamily, fontSize: size, fontWeight: weight, lineHeight, letterSpacing: "-0.035em", color, display: "flex", flexWrap: "wrap",
      columnGap: size * 0.26, ...style }}>
      {words.map((word, i) => {
        const start = delay + i * 2.2;
        const hot = marked.has(bare(word));
        return (
          <span key={`${word}-${i}`} style={{ display: "inline-block", color: hot ? accent : undefined,
            opacity: interpolate(frame, [start, start + 10], [0, 1], clamp),
            translate: interpolate(frame, [start, start + 16], ["0px 34px", "0px 0px"], { ...clamp, easing: out }),
            filter: `blur(${interpolate(frame, [start, start + 12], [10, 0], clamp)}px)` }}>
            {word}
          </span>
        );
      })}
    </div>
  );
}

/** Fades and lifts its children in at a frame. */
export function Rise({ at, children, distance = 28, style }: { at: number; children: ReactNode; distance?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ opacity: interpolate(frame, [at, at + 12], [0, 1], clamp),
      translate: interpolate(frame, [at, at + 18], [`0px ${distance}px`, "0px 0px"], { ...clamp, easing: out }), ...style }}>
      {children}
    </div>
  );
}

/** The spoken words, a page at a time, the word being said lit in the brand's colour. Times are inside the scene's voice. */
export function Captions({ captions, accent }: { captions: readonly VideoCaption[]; accent: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const vertical = useVertical();
  const ms = ((frame - LEAD_FRAMES) / fps) * 1000;
  const pages = captionPages(captions);
  const page = pages.find((p) => ms >= p[0].startMs - 80 && ms < p[p.length - 1].endMs + 120);
  if (!page) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? 300 : 70, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ maxWidth: vertical ? 900 : 1400, padding: vertical ? "18px 30px" : "14px 28px", borderRadius: 18, background: "rgba(8,9,11,0.72)",
        border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(10px)", display: "flex", flexWrap: "wrap", justifyContent: "center",
        columnGap: vertical ? 14 : 12, fontFamily, fontWeight: 600, fontSize: vertical ? 50 : 40, lineHeight: 1.25, letterSpacing: "-0.01em" }}>
        {page.map((c, i) => {
          const spoken = ms >= c.startMs;
          const now = spoken && ms < c.endMs + 40;
          return <span key={`${c.text}-${i}`} style={{ color: now ? accent : spoken ? INK : "rgba(245,246,247,0.5)" }}>{c.text}</span>;
        })}
      </div>
    </div>
  );
}

/** A browser window showing the business's real site, slowly drifting closer. */
export function BrowserFrame({ src, domain, width, height, at }: { src: string; domain: string; width: number; height: number; at: number }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ width, height, borderRadius: 18, overflow: "hidden", background: "#15171A", border: "1px solid rgba(255,255,255,0.12)",
      boxShadow: "0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03)",
      opacity: interpolate(frame, [at, at + 14], [0, 1], clamp),
      translate: interpolate(frame, [at, at + 24], ["0px 60px", "0px 0px"], { ...clamp, easing: out }),
      scale: interpolate(frame, [at, at + 24], [0.96, 1], { ...clamp, easing: out }) }}>
      <div style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c }} />)}
        <div style={{ marginLeft: 18, flex: 1, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center",
          padding: "0 14px", fontFamily, fontSize: 17, color: MUTED }}>{domain}</div>
      </div>
      <div style={{ position: "relative", width, height: height - 52, overflow: "hidden" }}>
        <Img src={asset(src)} style={{ width, position: "absolute", top: 0, left: 0, transformOrigin: "50% 0%",
          scale: interpolate(frame, [at, at + 240], [1, 1.12], clamp),
          translate: interpolate(frame, [at + 30, at + 260], ["0px 0px", "0px -60px"], { ...clamp, easing: Easing.bezier(0.45, 0, 0.55, 1) }) }} />
      </div>
    </div>
  );
}

/** A thin bar along the bottom: how far through the video the viewer is. */
export function Progress({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: (width * frame) / Math.max(1, durationInFrames - 1),
      background: `linear-gradient(90deg, ${accent}AA, ${accent})` }} />
  );
}
