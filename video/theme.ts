/** Answer videos in the business's own look (P405). Arshad, Nov 10: "the colours do not match the theme of dawnlist at
 * all ... this should be applicable for all sites." The background and text colours come from the business's homepage as
 * it renders (its screenshot), the accent and font from its own stylesheet; every colour pair the video draws is kept
 * readable (an accent too pale for the background marks words instead of colouring them). Pure. */
export type VideoTheme = {
  mode: "light" | "dark";
  background: string;
  text: string;
  muted: string;
  surface: string;
  line: string;
  accent: string;
  /** Text drawn on the accent (a button-like pill). */
  accentInk: string;
  /** How emphasised words stand out: in the accent's colour, or with an accent marker behind text-coloured words. */
  emphasis: "color" | "marker";
  font: string;
};

export const VIDEO_FONTS = ["Geist", "Inter", "Roboto", "Poppins", "Montserrat", "DM Sans", "Manrope", "Plus Jakarta Sans", "Space Grotesk", "Lato",
  "Open Sans", "Nunito Sans", "Figtree", "Outfit", "Work Sans", "IBM Plex Sans"] as const;
export type VideoFont = (typeof VIDEO_FONTS)[number];

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
export const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
export function rgb(color: string): [number, number, number] {
  const h = color.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number];
}
export function luminance(color: string): number {
  const lin = rgb(color).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** `share` of `a` over `b`. */
export function mix(a: string, b: string, share: number): string {
  const [p, q] = [rgb(a), rgb(b)];
  return hex(p[0] * share + q[0] * (1 - share), p[1] * share + q[1] * (1 - share), p[2] * share + q[2] * (1 - share));
}
export const withAlpha = (color: string, alpha: number) => `${color}${clamp255(alpha * 255).toString(16).padStart(2, "0")}`;

/** The page's background and body-text colours from its rendered pixels (RGBA, row by row): the most common colour in
 * the top of the page, and the most common colour that reads on it as text (contrast 4.5 or more). */
export function pageColors(rgba: Uint8Array, width: number, height: number, maxRows = 900): { background: string; text: string | null } {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const rows = Math.min(height, maxRows);
  for (let y = 0; y < rows; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] !== undefined && rgba[i + 3] < 200) continue;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const bucket = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b;
      counts.set(key, bucket);
    }
  }
  const buckets = [...counts.values()].sort((a, b) => b.n - a.n).map((c) => ({ n: c.n, color: hex(c.r / c.n, c.g / c.n, c.b / c.n) }));
  const background = buckets[0]?.color ?? "#FFFFFF";
  const text = buckets.find((c) => contrast(c.color, background) >= 4.5)?.color ?? null;
  return { background, text };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
/** The site's font, when it is one the video can load: from the body's font-family (a CSS variable's name counts, as
 * next/font names them: "var(--font-geist-sans)"), then any font-family or @font-face in its stylesheets. */
export function siteFont(css: readonly string[]): VideoFont | null {
  const known = VIDEO_FONTS.map((f) => ({ f, key: norm(f) }));
  const match = (value: string) => {
    for (const part of value.split(",")) {
      const v = norm(part.replace(/var\(--font-([a-z0-9-]+?)(?:-sans|-mono|-serif)?\)/i, "$1"));
      const hit = known.find((k) => v === k.key || v.startsWith(k.key));
      if (hit) return hit.f;
    }
    return null;
  };
  const text = css.join("\n");
  const body = /(?:^|[}\s,])(?:body|html)\s*\{[^}]*font-family\s*:\s*([^;}]+)/i.exec(text)?.[1];
  if (body) { const f = match(body); if (f) return f; }
  for (const m of text.matchAll(/font-family\s*:\s*([^;}]+)/gi)) { const f = match(m[1]); if (f) return f; }
  return null;
}

/** The video's colours: the site's background and text, a muted text between them, surfaces and lines just off the
 * background, and the site's accent, used as colour only where it reads. Without a known accent, the text colour leads. */
export function videoTheme(args: { background?: string | null; text?: string | null; accent?: string | null; font?: VideoFont | null }): VideoTheme {
  const background = args.background ?? "#0A0B0D";
  const mode: VideoTheme["mode"] = luminance(background) > 0.4 ? "light" : "dark";
  const text = args.text && contrast(args.text, background) >= 4.5 ? args.text : mode === "light" ? "#111216" : "#F5F6F7";
  const accent = args.accent ?? text;
  return {
    mode, background, text,
    muted: mix(text, background, 0.62),
    surface: mix(text, background, mode === "light" ? 0.04 : 0.06),
    line: mix(text, background, mode === "light" ? 0.12 : 0.14),
    accent,
    accentInk: contrast("#111216", accent) >= contrast("#FFFFFF", accent) ? "#111216" : "#FFFFFF",
    emphasis: contrast(accent, background) >= 3 ? "color" : "marker",
    font: args.font ?? "Geist",
  };
}

export const DEFAULT_THEME: VideoTheme = videoTheme({ background: "#0A0B0D", text: "#F5F6F7", accent: "#3DA5F5" });
