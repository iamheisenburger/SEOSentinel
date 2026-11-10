import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as dmSans } from "@remotion/google-fonts/DMSans";
import { loadFont as figtree } from "@remotion/google-fonts/Figtree";
import { loadFont as geist } from "@remotion/google-fonts/Geist";
import { loadFont as ibmPlexSans } from "@remotion/google-fonts/IBMPlexSans";
import { loadFont as inter } from "@remotion/google-fonts/Inter";
import { loadFont as lato } from "@remotion/google-fonts/Lato";
import { loadFont as manrope } from "@remotion/google-fonts/Manrope";
import { loadFont as montserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as nunitoSans } from "@remotion/google-fonts/NunitoSans";
import { loadFont as openSans } from "@remotion/google-fonts/OpenSans";
import { loadFont as outfit } from "@remotion/google-fonts/Outfit";
import { loadFont as plusJakartaSans } from "@remotion/google-fonts/PlusJakartaSans";
import { loadFont as poppins } from "@remotion/google-fonts/Poppins";
import { loadFont as roboto } from "@remotion/google-fonts/Roboto";
import { loadFont as spaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as workSans } from "@remotion/google-fonts/WorkSans";
import { captionPages, isRemote, LEAD_FRAMES, type VideoCaption } from "./types";
import { contrast, DEFAULT_THEME, mix, withAlpha, type VideoFont, type VideoTheme } from "./theme";

/** A web address as it is; a public-folder name through staticFile. */
export const asset = (src: string) => (isRemote(src) ? src : staticFile(src));

const latin = { subsets: ["latin"] as "latin"[] };
const FONT_LOADERS: Record<VideoFont, () => { fontFamily: string }> = {
  Geist: () => geist("normal", latin), Inter: () => inter("normal", latin), Roboto: () => roboto("normal", latin), Poppins: () => poppins("normal", latin),
  Montserrat: () => montserrat("normal", latin), "DM Sans": () => dmSans("normal", latin), Manrope: () => manrope("normal", latin),
  "Plus Jakarta Sans": () => plusJakartaSans("normal", latin), "Space Grotesk": () => spaceGrotesk("normal", latin), Lato: () => lato("normal", latin),
  "Open Sans": () => openSans("normal", latin), "Nunito Sans": () => nunitoSans("normal", latin), Figtree: () => figtree("normal", latin),
  Outfit: () => outfit("normal", latin), "Work Sans": () => workSans("normal", latin), "IBM Plex Sans": () => ibmPlexSans("normal", latin),
};

type Look = VideoTheme & { fontFamily: string };
const LookContext = createContext<Look>({ ...DEFAULT_THEME, fontFamily: "sans-serif" });

/** The business's look for every scene: its colours and its font (loaded once). */
export function LookProvider({ theme, children }: { theme: VideoTheme; children: ReactNode }) {
  const [fontFamily] = useState(() => (FONT_LOADERS[theme.font as VideoFont] ?? FONT_LOADERS.Geist)().fontFamily);
  return <LookContext.Provider value={{ ...theme, fontFamily }}>{children}</LookContext.Provider>;
}
export const useLook = () => useContext(LookContext);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.bezier(0.16, 1, 0.3, 1);

/** Whether the video is the vertical cut (Shorts, Reels). */
export function useVertical() {
  const { width, height } = useVideoConfig();
  return height > width;
}

/** The canvas in the business's background colour: two slow glows of its accent, a faint dot grid and, on dark sites, a
 * vignette. */
export function Background() {
  const look = useLook();
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame / 30;
  const light = look.mode === "light";
  return (
    <AbsoluteFill style={{ backgroundColor: look.background, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: width * 0.9, height: width * 0.9, borderRadius: "50%", left: -width * 0.25 + Math.sin(t / 5) * 60,
        top: -height * 0.45 + Math.cos(t / 6) * 50, background: `radial-gradient(circle, ${withAlpha(look.accent, light ? 0.08 : 0.2)} 0%, ${withAlpha(look.accent, 0)} 62%)` }} />
      <div style={{ position: "absolute", width: width * 0.8, height: width * 0.8, borderRadius: "50%", right: -width * 0.3 + Math.cos(t / 7) * 70,
        bottom: -height * 0.6 + Math.sin(t / 4) * 40, background: `radial-gradient(circle, ${withAlpha(look.accent, light ? 0.05 : 0.13)} 0%, ${withAlpha(look.accent, 0)} 60%)` }} />
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(${withAlpha(look.text, light ? 0.1 : 0.08)} 1.2px, transparent 1.2px)`, backgroundSize: "44px 44px",
        maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)" }} />
      {!light && <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />}
    </AbsoluteFill>
  );
}

/** The business's name, top left, on every scene. */
export function BrandMark({ name }: { name: string }) {
  const look = useLook();
  const vertical = useVertical();
  return (
    <div style={{ position: "absolute", top: vertical ? 110 : 64, left: vertical ? 80 : 96, display: "flex", alignItems: "center", gap: 14, fontFamily: look.fontFamily,
      fontSize: vertical ? 40 : 30, fontWeight: 600, color: look.text, letterSpacing: "-0.01em" }}>
      <div style={{ width: vertical ? 40 : 30, height: vertical ? 40 : 30, borderRadius: 9, background: `linear-gradient(135deg, ${look.accent}, ${withAlpha(look.accent, 0.6)})`,
        boxShadow: `0 0 24px ${withAlpha(look.accent, 0.35)}` }} />
      {name}
    </div>
  );
}

/** A line whose words rise in one after another; the emphasised words in the accent, or marked with it when the accent
 * is too pale to read as text on the background. */
export function WordsIn({ text, emphasis, size, weight = 700, delay = 0, color, lineHeight = 1.08, style }: {
  text: string; emphasis: readonly string[]; size: number; weight?: number; delay?: number; color?: string; lineHeight?: number; style?: CSSProperties;
}) {
  const look = useLook();
  const frame = useCurrentFrame();
  const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
  const marked = new Set(emphasis.map(bare));
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div style={{ fontFamily: look.fontFamily, fontSize: size, fontWeight: weight, lineHeight, letterSpacing: "-0.035em", color: color ?? look.text, display: "flex",
      flexWrap: "wrap", columnGap: size * 0.26, ...style }}>
      {words.map((word, i) => {
        const start = delay + i * 2.2;
        const hot = marked.has(bare(word));
        const markerAt = start + 10;
        return (
          <span key={`${word}-${i}`} style={{ display: "inline-block", position: "relative", color: hot && look.emphasis === "color" ? look.accent : undefined,
            opacity: interpolate(frame, [start, start + 10], [0, 1], clamp),
            translate: interpolate(frame, [start, start + 16], ["0px 34px", "0px 0px"], { ...clamp, easing: out }),
            filter: `blur(${interpolate(frame, [start, start + 12], [10, 0], clamp)}px)` }}>
            {hot && look.emphasis === "marker" && (
              <span aria-hidden="true" style={{ position: "absolute", left: "-0.06em", right: "-0.06em", bottom: "0.04em", height: "0.42em", borderRadius: "0.08em",
                background: withAlpha(look.accent, 0.55), transformOrigin: "0% 50%",
                scale: `${interpolate(frame, [markerAt, markerAt + 14], [0, 1], { ...clamp, easing: out })} 1` }} />
            )}
            <span style={{ position: "relative" }}>{word}</span>
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

/** The spoken words, a page at a time, on a pill in the business's text colour; the word being said lit in its accent
 * when the accent reads on the pill. Times are inside the scene's voice. */
export function Captions({ captions }: { captions: readonly VideoCaption[] }) {
  const look = useLook();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const vertical = useVertical();
  const ms = ((frame - LEAD_FRAMES) / fps) * 1000;
  const pages = captionPages(captions);
  const page = pages.find((p) => ms >= p[0].startMs - 80 && ms < p[p.length - 1].endMs + 120);
  if (!page) return null;
  const pill = look.mode === "light" ? look.text : "#08090B";
  const ink = look.mode === "light" ? look.background : "#F5F6F7";
  const lit = contrast(look.accent, pill) >= 3 ? look.accent : ink;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? 300 : 70, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ maxWidth: vertical ? 900 : 1400, padding: vertical ? "18px 30px" : "14px 28px", borderRadius: 18, background: withAlpha(pill, 0.9),
        boxShadow: look.mode === "light" ? "0 12px 30px rgba(0,0,0,0.12)" : "none", display: "flex", flexWrap: "wrap", justifyContent: "center",
        columnGap: vertical ? 14 : 12, fontFamily: look.fontFamily, fontWeight: 600, fontSize: vertical ? 50 : 40, lineHeight: 1.25, letterSpacing: "-0.01em" }}>
        {page.map((c, i) => {
          const spoken = ms >= c.startMs;
          const now = spoken && ms < c.endMs + 40;
          return (
            <span key={`${c.text}-${i}`} style={{ color: now ? lit : spoken ? ink : withAlpha(ink, 0.5),
              textDecoration: now && lit === ink ? `underline ${look.accent} 4px` : undefined, textUnderlineOffset: 8 }}>{c.text}</span>
          );
        })}
      </div>
    </div>
  );
}

/** A browser window showing the business's real site, slowly drifting closer. */
export function BrowserFrame({ src, domain, width, height, at }: { src: string; domain: string; width: number; height: number; at: number }) {
  const look = useLook();
  const frame = useCurrentFrame();
  return (
    <div style={{ width, height, borderRadius: 18, overflow: "hidden", background: look.surface, border: `1px solid ${look.line}`,
      boxShadow: look.mode === "light" ? "0 30px 80px rgba(17,18,22,0.14), 0 2px 6px rgba(17,18,22,0.06)" : "0 40px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03)",
      opacity: interpolate(frame, [at, at + 14], [0, 1], clamp),
      translate: interpolate(frame, [at, at + 24], ["0px 60px", "0px 0px"], { ...clamp, easing: out }),
      scale: interpolate(frame, [at, at + 24], [0.96, 1], { ...clamp, easing: out }) }}>
      <div style={{ height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderBottom: `1px solid ${look.line}` }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c }} />)}
        <div style={{ marginLeft: 18, flex: 1, height: 30, borderRadius: 8, background: mix(look.text, look.background, 0.06), display: "flex", alignItems: "center",
          padding: "0 14px", fontFamily: look.fontFamily, fontSize: 17, color: look.muted }}>{domain}</div>
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
export function Progress() {
  const look = useLook();
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: (width * frame) / Math.max(1, durationInFrames - 1),
      background: `linear-gradient(90deg, ${withAlpha(look.accent, 0.7)}, ${look.accent})` }} />
  );
}
