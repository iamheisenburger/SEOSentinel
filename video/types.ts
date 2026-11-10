/** Answer videos (P400): what one video is made of. Pentra writes the scenes from the business's own facts, voices each
 * scene separately (so every scene's length is its voice's length) and times the captions inside each scene; Remotion
 * draws and renders the video from these props. Pure. */
import type { VideoTheme } from "./theme";

/** A file the video uses: a web address as given, or a name in the render's public folder (local renders). */
export const isRemote = (src: string) => /^(https?:|data:|blob:)/.test(src);

export type SceneKind = "hook" | "statement" | "steps" | "checklist" | "product" | "cta";
export const SCENE_KINDS: readonly SceneKind[] = ["hook", "statement", "steps", "checklist", "product", "cta"];

export type VideoCaption = { text: string; startMs: number; endMs: number };

export type VideoScene = {
  kind: SceneKind;
  /** The scene's main line on screen. */
  heading: string;
  /** Steps, checks or product points (up to five, a few words each). */
  items: string[];
  /** Words of the heading drawn in the accent colour. */
  emphasis: string[];
  /** What the voice says in this scene (shown as captions, timed inside the scene's audio). */
  narration: string;
  /** The scene's voice: its own audio file and length. */
  audioSrc: string | null;
  audioMs: number;
};

export type AnswerVideoProps = {
  /** P405: the business's look (its background, text, accent and font, read from its own site); videos rendered before
   * it have only an accent and are drawn on the dark default. */
  brand: { name: string; domain: string; accent: string; theme?: VideoTheme };
  /** The business's homepage, captured full-page (the product scene shows its top). */
  screenshotSrc: string | null;
  scenes: VideoScene[];
};

export const FPS = 30;
/** Frames before a scene's voice starts (its entrance), and after it ends. */
export const LEAD_FRAMES = 8;
export const TAIL_FRAMES = 14;
/** Frames two scenes overlap in the cross-dissolve between them. */
export const TRANSITION_FRAMES = 12;

export const audioFrames = (scene: Pick<VideoScene, "audioMs">, fps = FPS) => Math.ceil((scene.audioMs / 1000) * fps);
/** A scene's length: entrance, voice, a beat, and the dissolve into the next scene. */
export const sceneFrames = (scene: Pick<VideoScene, "audioMs">, fps = FPS) => LEAD_FRAMES + audioFrames(scene, fps) + TAIL_FRAMES + TRANSITION_FRAMES;
/** The whole video: every scene, less the overlaps of the dissolves between them. */
export const totalFrames = (scenes: ReadonlyArray<Pick<VideoScene, "audioMs">>, fps = FPS) =>
  Math.max(1, scenes.reduce((n, s) => n + sceneFrames(s, fps), 0) - TRANSITION_FRAMES * Math.max(0, scenes.length - 1));

/** The narration as captions: each word gets the share of the scene's voice its letters take (a pause after a sentence
 * end or comma counts as a few letters), so words light up as they're spoken. */
export function timedCaptions(narration: string, audioMs: number): VideoCaption[] {
  const words = narration.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || audioMs <= 0) return [];
  const weight = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 2 + (/[.!?]$/.test(w) ? 6 : /[,;:]$/.test(w) ? 3 : 0);
  const weights = words.map(weight);
  const total = weights.reduce((a, b) => a + b, 0);
  let at = 0;
  return words.map((w, i) => {
    const startMs = Math.round((at / total) * audioMs);
    at += weights[i];
    return { text: w, startMs, endMs: Math.round((at / total) * audioMs) };
  });
}

/** Caption pages: one sentence at a time, a long sentence split into balanced pages of at most seven words (never a lone
 * word left on its own page). */
export function captionPages(captions: readonly VideoCaption[], maxWords = 7): VideoCaption[][] {
  const sentences: VideoCaption[][] = [];
  let sentence: VideoCaption[] = [];
  for (const c of captions) {
    sentence.push(c);
    if (/[.!?]$/.test(c.text)) { sentences.push(sentence); sentence = []; }
  }
  if (sentence.length) sentences.push(sentence);
  const pages: VideoCaption[][] = [];
  for (const s of sentences) {
    const count = Math.ceil(s.length / maxWords);
    const size = Math.ceil(s.length / count);
    for (let i = 0; i < s.length; i += size) pages.push(s.slice(i, i + size));
  }
  return pages;
}
