"use node";

import { api } from "../_generated/api";
import { action } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";

const defaultModel = "claude-haiku-4-5-20251001";

type RichMediaOptions = {
  targetWords?: number;
  includeTables?: boolean;
  includeLists?: boolean;
  includeImages?: boolean;
  includeYouTube?: boolean;
};

const TopicSchema = z.object({
  label: z.string(),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()).default([]),
  intent: z.string().optional(),
  priority: z.number().optional(),
  notes: z.string().optional(),
});

const PlanSchema = z.array(TopicSchema);

const ArticleSchema = z.object({
  title: z.string(),
  slug: z.string(),
  markdown: z.string(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  metaKeywords: z.array(z.string()).optional(),
  sources: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().optional(),
      }),
    )
    .optional(),
});

const LinkSchema = z.array(
  z.object({
    anchor: z.string(),
    href: z.string(),
  }),
);

const parseJson = <T>(schema: z.ZodTypeAny, text: string): T => {
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");

  // If [ appears before { (or no { exists), treat as array response
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const arrEnd = text.lastIndexOf("]");
    if (arrEnd === -1) throw new Error("No closing ] found in response");
    const raw = text.slice(arrStart, arrEnd + 1);
    try {
      return schema.parse(JSON.parse(raw)) as T;
    } catch (err) {
      console.error("JSON parse failed. Raw text snippet:", raw.slice(0, 200));
      throw err;
    }
  }

  // Otherwise treat as object response
  if (objStart === -1) throw new Error("No JSON found in response");
  const objEnd = text.lastIndexOf("}");
  if (objEnd === -1) throw new Error("No closing } found in response");
  const raw = text.slice(objStart, objEnd + 1);

  try {
    return schema.parse(JSON.parse(raw)) as T;
  } catch (err) {
    console.error("JSON parse failed. Raw text snippet:", raw.slice(0, 200));
    throw err;
  }
};

const buildSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 90);

const anthropicClient = () => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey });
};

// Keep OpenAI client for web search (Claude doesn't have built-in web search)
const openaiClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set (needed for web research)");
  return new OpenAI({ apiKey });
};

/** Generate an AI hero image for an article. Returns a Convex storage URL. */
async function generateHeroImage(
  ctx: ActionCtx,
  title: string,
  niche: string,
  brandingPrompt?: string,
): Promise<string> {
  const client = openaiClient();
  const prompt = brandingPrompt
    ? `${brandingPrompt}. Topic: ${title}`
    : `Professional, modern blog hero image for an article titled "${title}" in the ${niche || "technology"} industry. ` +
      `Clean editorial style with subtle gradients and abstract shapes. NO text, NO words, NO letters, NO watermarks. ` +
      `Photorealistic quality, 16:9 aspect ratio, suitable for a premium blog.`;

  console.log(`Generating hero image for: "${title}"...`);

  const response = await client.images.generate({
    model: "gpt-image-1.5-2025-12-16",
    prompt,
    n: 1,
    size: "1536x1024",
    quality: "medium",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data returned from OpenAI");

  // Store in Convex file storage
  const imageBytes = Buffer.from(b64, "base64");
  const blob = new Blob([imageBytes], { type: "image/png" });
  const storageId = await ctx.storage.store(blob);
  const imageUrl = await ctx.storage.getUrl(storageId);
  if (!imageUrl) throw new Error("Failed to get storage URL for image");

  console.log(`Hero image generated and stored: ${storageId}`);
  return imageUrl;
}

/** Capture a real screenshot of a website. Stores in Convex file storage. */
async function captureScreenshot(
  ctx: ActionCtx,
  url: string,
  options?: { width?: number; cropHeight?: number },
): Promise<string> {
  const width = options?.width ?? 1280;
  const cropHeight = options?.cropHeight ?? 800;
  const targetUrl = url.startsWith("http") ? url : `https://${url}`;

  // thum.io — free screenshot API, no API key required
  const screenshotApiUrl = `https://image.thum.io/get/width/${width}/crop/${cropHeight}/noanimate/${targetUrl}`;

  console.log(`Capturing screenshot of ${targetUrl}...`);

  const response = await fetch(screenshotApiUrl);
  if (!response.ok) {
    throw new Error(`Screenshot API returned ${response.status}`);
  }

  const blob = await response.blob();
  const storageId = await ctx.storage.store(blob);
  const imageUrl = await ctx.storage.getUrl(storageId);
  if (!imageUrl) throw new Error("Failed to get storage URL for screenshot");

  console.log(`Screenshot captured and stored: ${storageId}`);
  return imageUrl;
}

/** Search for relevant infographics and data visualizations from the web. */
async function searchWebImages(
  topic: string,
  niche: string,
): Promise<{ url: string; alt: string; source: string }[]> {
  const client = openaiClient();

  const completion = await client.responses.create({
    model: "gpt-5-mini-2025-08-07",
    tools: [{ type: "web_search_preview" as any }],
    input: [
      {
        role: "system",
        content:
          "Search the web for high-quality infographics, charts, statistics images, and data visualizations. " +
          "Return ONLY URLs that point to actual, publicly accessible image files (.png, .jpg, .webp). " +
          "Prefer images from reputable sources (Statista, HubSpot, McKinsey, Gartner, industry blogs). " +
          "Output JSON only — no explanation.",
      },
      {
        role: "user",
        content:
          `Find 2-4 relevant infographics, charts, or data visualizations about: "${topic}" in the ${niche || "general"} space.\n` +
          `Return JSON: {"images": [{"url": "direct_image_url", "alt": "descriptive alt text for SEO", "source": "source website name"}]}`,
      },
    ],
  });

  const result = parseJson<{
    images: { url: string; alt: string; source: string }[];
  }>(
    z.object({
      images: z
        .array(
          z.object({
            url: z.string(),
            alt: z.string(),
            source: z.string(),
          }),
        )
        .default([]),
    }),
    completion.output_text,
  );

  // Validate URLs
  const validImages = result.images.filter((img) => {
    try {
      new URL(img.url);
      return true;
    } catch {
      return false;
    }
  });

  console.log(`Found ${validImages.length} web images for "${topic}".`);
  return validImages;
}

/** Crawl a page and extract text content (strips HTML). */
async function crawlPageContent(url: string): Promise<string> {
  try {
    const targetUrl = url.startsWith("http") ? url : `https://${url}`;
    const response = await fetch(targetUrl, {
      headers: { "User-Agent": "SEOSentinel/1.0 (content research)" },
    });
    if (!response.ok) return "";
    const html = await response.text();

    // Strip scripts, styles, then HTML tags
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, 5000);
  } catch {
    return "";
  }
}

/** Crawl site's key pages (pricing, features) for fresh, accurate data. */
async function crawlSiteData(
  domain: string,
): Promise<{ pricing: string; features: string; homepage: string }> {
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  const cleanBase = baseUrl.replace(/\/$/, "");

  console.log(`Crawling site data from ${cleanBase}...`);

  // Crawl key pages sequentially (respect user preference)
  const homepage = await crawlPageContent(cleanBase);
  const pricing = await crawlPageContent(`${cleanBase}/pricing`);
  const features = await crawlPageContent(`${cleanBase}/features`);

  console.log(
    `Crawled site data: homepage=${homepage.length}chars, pricing=${pricing.length}chars, features=${features.length}chars`,
  );

  return { pricing, features, homepage };
}

/** Search for relevant YouTube videos using OpenAI web search. */
async function searchYouTubeVideos(
  topic: string,
  niche: string,
): Promise<{ videoId: string; title: string }[]> {
  const client = openaiClient();

  const completion = await client.responses.create({
    model: "gpt-5-mini-2025-08-07",
    tools: [{ type: "web_search_preview" as any }],
    input: [
      {
        role: "system",
        content:
          "Search YouTube for the most relevant and popular videos on the given topic. " +
          "Return ONLY real YouTube video URLs that actually exist. " +
          "Output JSON only — no explanation.",
      },
      {
        role: "user",
        content:
          `Find 2-3 highly relevant YouTube videos about: "${topic}" in the ${niche || "general"} space.\n` +
          `Return JSON: {"videos": [{"videoId": "the_youtube_video_id", "title": "video title"}]}`,
      },
    ],
  });

  const result = parseJson<{ videos: { videoId: string; title: string }[] }>(
    z.object({
      videos: z
        .array(z.object({ videoId: z.string(), title: z.string() }))
        .default([]),
    }),
    completion.output_text,
  );

  // Validate video IDs (must be 11 chars, alphanumeric + dash/underscore)
  const validVideos = result.videos.filter(
    (v) => /^[a-zA-Z0-9_-]{11}$/.test(v.videoId),
  );

  console.log(`Found ${validVideos.length} YouTube videos for "${topic}".`);
  return validVideos;
}

/** Calculate reading time and word count from markdown. */
function calculateArticleStats(markdown: string): {
  readingTime: number;
  wordCount: number;
} {
  // Strip markdown syntax for accurate word count
  const plainText = markdown
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/`[^`]+`/g, "") // inline code
    .replace(/!\[.*?\]\(.*?\)/g, "") // images
    .replace(/\[([^\]]+)\]\(.*?\)/g, "$1") // links → text
    .replace(/#{1,6}\s/g, "") // headings
    .replace(/[*_~`]/g, "") // formatting
    .replace(/<[^>]+>/g, "") // HTML tags
    .trim();

  const words = plainText.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 238)); // avg reading speed

  return { readingTime, wordCount };
}

/** Call Claude and return the text response. */
async function callClaude(
  system: string,
  userMessage: string,
  maxTokens = 8192,
): Promise<string> {
  const client = anthropicClient();
  const response = await client.messages.create({
    model: defaultModel,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Claude");
  return block.text;
}

async function fetchHtml(domain: string) {
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  const res = await fetch(url);
  const html = await res.text();
  return { url, html };
}

// ── Brand Detection (ported from LeadPilot — fully programmatic) ──

interface BrandDetection {
  primaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  logoUrl: string | null;
}

interface ColorSignal { source: string; color: string }

const MIN_CONFIDENCE_SCORE = 60;

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
  };
  return rgbToHex(f(0), f(8), f(4));
}

function oklchToHex(L: number, C: number, H: number): string {
  const l = L > 1 ? L / 100 : L;
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const lr = l_ * l_ * l_;
  const mr = m_ * m_ * m_;
  const sr = s_ * s_ * s_;
  const r = +4.0767416621 * lr - 3.3077115913 * mr + 0.2309699292 * sr;
  const g = -1.2684380046 * lr + 2.6097574011 * mr - 0.3413193965 * sr;
  const bv = -0.0041960863 * lr - 0.7034186147 * mr + 1.7076147010 * sr;
  const toSrgb = (x: number) => {
    const c = Math.max(0, Math.min(1, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  return rgbToHex(Math.round(toSrgb(r) * 255), Math.round(toSrgb(g) * 255), Math.round(toSrgb(bv) * 255));
}

function normalizeHex(hex: string): string {
  hex = hex.trim();
  if (hex.length === 4) return "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  return hex.toUpperCase().slice(0, 7);
}

function isNeutral(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  if (brightness < 30 || brightness > 230) return true;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 25) return true;
  return false;
}

function colorDistance(hex1: string, hex2: string): number {
  const r1 = parseInt(hex1.slice(1, 3), 16), g1 = parseInt(hex1.slice(3, 5), 16), b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16), g2 = parseInt(hex2.slice(3, 5), 16), b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function parseAnyColor(value: string): string | null {
  value = value.trim();
  if (value.startsWith("#")) return normalizeHex(value);
  const rgbMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) return rgbToHex(parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3]));
  const hslMatch = value.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (hslMatch) return hslToHex(parseFloat(hslMatch[1]), parseFloat(hslMatch[2]), parseFloat(hslMatch[3]));
  const bareHsl = value.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (bareHsl) return hslToHex(parseFloat(bareHsl[1]), parseFloat(bareHsl[2]), parseFloat(bareHsl[3]));
  const oklchMatch = value.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)/i);
  if (oklchMatch) return oklchToHex(parseFloat(oklchMatch[1]), parseFloat(oklchMatch[2]), parseFloat(oklchMatch[3]));
  return null;
}

async function gatherColorSignals(html: string, siteUrl: string): Promise<ColorSignal[]> {
  if (!html) return [];
  const signals: ColorSignal[] = [];

  // 1. Meta theme-color
  const themeColor = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']theme-color["']/i);
  if (themeColor) { const c = parseAnyColor(themeColor[1]); if (c) signals.push({ source: "meta theme-color", color: c }); }

  // 2. msapplication-TileColor
  const tileColor = html.match(/<meta[^>]*name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i);
  if (tileColor) { const c = parseAnyColor(tileColor[1]); if (c) signals.push({ source: "msapplication-TileColor", color: c }); }

  // 3. Manifest
  let origin = "";
  try { origin = new URL(siteUrl).origin; } catch { /* ignore */ }
  if (origin) {
    const manifestLink = html.match(/<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/i);
    const manifestPaths = [...(manifestLink ? [manifestLink[1]] : []), "/manifest.json", "/site.webmanifest"];
    for (const path of manifestPaths) {
      try {
        const manifestUrl = path.startsWith("http") ? path : origin + path;
        const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(3000), headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOSentinel/1.0)" } });
        if (res.ok) {
          const manifest = await res.json();
          if (manifest.theme_color) { const c = parseAnyColor(manifest.theme_color); if (c) signals.push({ source: "manifest theme_color", color: c }); }
          break;
        }
      } catch { /* continue */ }
    }
  }

  // 4. CSS variables (brand-identity only)
  const cssVarRegex = /--(?:primary|brand|accent|main|theme|color-primary|color-accent|cta)(?:-color)?(?:-\d{1,3})?:\s*([^;}\n]+)/gi;
  for (const m of html.matchAll(cssVarRegex)) {
    const c = parseAnyColor(m[1].trim());
    if (c && !isNeutral(c)) signals.push({ source: "CSS variable", color: c });
  }

  // 5. External CSS files (critical for Tailwind sites)
  if (origin) {
    const cssUrls: string[] = [];
    for (const m of html.matchAll(/<link[^>]*href=["']([^"']+\.css[^"']*)["'][^>]*>/gi)) cssUrls.push(m[1]);
    for (const m of html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)) {
      if (!cssUrls.includes(m[1])) cssUrls.push(m[1]);
    }
    for (const cssPath of cssUrls.slice(0, 3)) {
      try {
        const cssUrl = cssPath.startsWith("http") ? cssPath : origin + (cssPath.startsWith("/") ? "" : "/") + cssPath;
        const cssRes = await fetch(cssUrl, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "Mozilla/5.0 (compatible; SEOSentinel/1.0)" } });
        if (!cssRes.ok) continue;
        const cssText = await cssRes.text();
        for (const m of cssText.matchAll(cssVarRegex)) {
          const c = parseAnyColor(m[1].trim());
          if (c && !isNeutral(c)) signals.push({ source: "external CSS variable", color: c });
        }
      } catch { /* continue */ }
    }
  }

  // 6. Button/link inline styles
  for (const m of html.matchAll(/<(?:button|a)\b[^>]*style=["']([^"']+)["'][^>]*>/gi)) {
    const bgMatch = m[1].match(/background(?:-color)?:\s*([^;]+)/i);
    if (bgMatch) { const c = parseAnyColor(bgMatch[1].trim()); if (c && !isNeutral(c)) signals.push({ source: "button/link color", color: c }); }
  }

  // Deduplicate
  const seen = new Set<string>();
  return signals.filter(s => { if (seen.has(s.color)) return false; seen.add(s.color); return true; });
}

function selectBrandColors(signals: ColorSignal[]): { primary: string | null; accent: string | null } {
  if (signals.length === 0) return { primary: null, accent: null };
  const scored: { hex: string; score: number }[] = [];
  for (const signal of signals) {
    const hex = signal.color;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (brightness > 210 || brightness < 35) continue;
    if (saturation < 0.12) continue;
    let score = 0;
    if (brightness >= 60 && brightness <= 180) score += 25;
    else if (brightness >= 35 && brightness <= 210) score += 10;
    score += saturation * 35;
    if (signal.source === "meta theme-color") score += 55;
    if (signal.source === "manifest theme_color") score += 50;
    if (signal.source === "external CSS variable") score += 48;
    if (signal.source === "msapplication-TileColor") score += 45;
    if (signal.source === "CSS variable") score += 35;
    if (signal.source.includes("button/link color")) score += 30;
    if (signal.source === "manifest background_color") score += 5;
    if (score > 0) scored.push({ hex, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const confident = scored.filter(c => c.score >= MIN_CONFIDENCE_SCORE);
  const primary = confident[0]?.hex ?? null;
  let accent: string | null = null;
  for (const c of confident.slice(1)) {
    if (primary && colorDistance(primary, c.hex) >= 60) { accent = c.hex; break; }
  }
  return { primary, accent };
}

async function extractBrandFromHtml(html: string, siteUrl: string): Promise<BrandDetection> {
  const result: BrandDetection = { primaryColor: null, accentColor: null, fontFamily: null, logoUrl: null };

  // Colors (programmatic scoring)
  const signals = await gatherColorSignals(html, siteUrl);
  const colors = selectBrandColors(signals);
  result.primaryColor = colors.primary;
  result.accentColor = colors.accent;

  // Font (Google Fonts URL or CSS body font-family)
  const googleFontMatch = html.match(/fonts\.googleapis\.com\/css2?\?family=([^&"']+)/i);
  if (googleFontMatch) {
    result.fontFamily = decodeURIComponent(googleFontMatch[1]).split(":")[0].replace(/\+/g, " ");
  } else {
    const fontFamilyMatch = html.match(/(?:body|:root|html)\s*\{[^}]*font-family:\s*["']?([^;,"'}\n]+)/i);
    if (fontFamilyMatch) {
      result.fontFamily = fontFamilyMatch[1].trim().split(",")[0].replace(/["']/g, "").trim();
    }
  }

  // Logo (img with "logo" in attributes, fallback to og:image)
  let origin = "";
  try { origin = new URL(siteUrl).origin; } catch { /* ignore */ }
  const logoImg = html.match(/<img[^>]*(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/i);
  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  const logoSrc = logoImg?.[1] || ogImage?.[1] || null;
  if (logoSrc) {
    if (logoSrc.startsWith("http")) result.logoUrl = logoSrc;
    else if (origin) result.logoUrl = origin + (logoSrc.startsWith("/") ? "" : "/") + logoSrc;
  }

  return result;
}

async function inferSiteProfile(
  ctx: ActionCtx,
  html: string,
  siteId: Id<"sites">,
  site: {
    domain: string;
    tone?: string;
    niche?: string;
    inferToneNiche?: boolean;
  },
) {
  if (site.tone && site.niche && site.inferToneNiche !== true) return;
  const text = await callClaude(
    "Infer the site's niche and tone of voice concisely. Return JSON only.",
    'Return JSON like {"niche":"...","tone":"..."} based on this HTML snapshot:\n' + html.slice(0, 6000),
    1024,
  );
  const inferred = parseJson<{ niche?: string; tone?: string }>(
    z.object({
      niche: z.string().optional(),
      tone: z.string().optional(),
    }),
    text,
  );
  if (inferred.niche || inferred.tone) {
    await ctx.runMutation(api.sites.upsert, {
      id: siteId,
      domain: site.domain,
      niche: inferred.niche ?? site.niche,
      tone: inferred.tone ?? site.tone,
    });
  }
}

async function factCheckArticle(
  markdown: string,
  sources: z.infer<typeof ArticleSchema>["sources"],
) {
  const text = await callClaude(
    "You are a fact-checking editor. Review the article against provided sources and score factual accuracy.\n\n" +
    "CRITICAL RULES:\n" +
    "1. The 'markdown' field MUST contain the FULL article — same article, with only factual corrections applied.\n" +
    "2. Do NOT add fact-check summaries or editorial commentary into the markdown.\n" +
    "3. Do NOT shorten or truncate the article. Return the complete article.\n" +
    "4. For each factual claim you can identify, assess whether it is supported by the provided sources.\n" +
    "5. 'confidenceScore' = overall percentage (0-100) of how well-supported the article's claims are.\n" +
    "   - 90-100: All major claims verified against sources\n" +
    "   - 70-89: Most claims verified, minor gaps\n" +
    "   - 50-69: Several unverifiable claims\n" +
    "   - Below 50: Major factual concerns\n" +
    "6. 'claimCount' = total factual claims found. 'verifiedCount' = claims supported by sources.\n" +
    "7. Output JSON only.",
    `Return JSON: {"markdown":"<full corrected article>","notes":"<reviewer summary>","confidenceScore":<0-100>,"claimCount":<number>,"verifiedCount":<number>,"citations":[{"url":"...","title":"..."}]}\n\nSources to validate against: ${JSON.stringify(
      sources ?? [],
    )}\n\nArticle to review:\n${markdown}`,
    16384,
  );

  const reviewed = parseJson<{
    markdown: string;
    notes?: string;
    confidenceScore?: number;
    claimCount?: number;
    verifiedCount?: number;
    citations?: { url: string; title?: string }[];
  }>(
    z.object({
      markdown: z.string(),
      notes: z.string().optional(),
      confidenceScore: z.number().optional(),
      claimCount: z.number().optional(),
      verifiedCount: z.number().optional(),
      citations: z
        .array(
          z.object({
            url: z.string(),
            title: z.string().optional(),
          }),
        )
        .optional(),
    }),
    text,
  );
  return reviewed;
}

async function webResearch(
  topic: {
    label: string;
    primaryKeyword: string;
    secondaryKeywords?: string[];
    intent?: string;
  },
  siteNiche?: string,
): Promise<{ researchSummary: string; sources: { url: string; title?: string }[] }> {
  // Web research uses OpenAI's web_search_preview tool (Claude doesn't have built-in web search)
  const client = openaiClient();
  const searchQuery = `${topic.primaryKeyword} ${topic.label} ${siteNiche ?? ""}`.trim();

  console.log(`Web research: searching for "${searchQuery}"...`);

  const completion = await client.responses.create({
    model: "o4-mini-deep-research-2025-06-26",
    tools: [{ type: "web_search_preview" as any }],
    input: [
      {
        role: "system",
        content:
          "You are a research assistant. Search the web for current, factual information on the given topic. " +
          "Compile a detailed research brief with key facts, statistics, trends, and expert opinions. " +
          "Include all source URLs you find. Output JSON only.",
      },
      {
        role: "user",
        content:
          `Research this topic thoroughly for an SEO article:\n` +
          `Topic: ${topic.label}\n` +
          `Primary Keyword: ${topic.primaryKeyword}\n` +
          `Secondary Keywords: ${topic.secondaryKeywords?.join(", ") ?? "none"}\n` +
          `Search Intent: ${topic.intent ?? "informational"}\n\n` +
          `Return JSON: {"researchSummary": "detailed findings with facts, stats, and quotes...", "sources": [{"url": "...", "title": "..."}]}`,
      },
    ],
  });

  const result = parseJson<{
    researchSummary: string;
    sources: { url: string; title?: string }[];
  }>(
    z.object({
      researchSummary: z.string(),
      sources: z
        .array(z.object({ url: z.string(), title: z.string().optional() }))
        .default([]),
    }),
    completion.output_text,
  );

  console.log(`Web research complete: ${result.sources.length} sources found.`);
  return result;
}

async function handleOnboarding(
  ctx: ActionCtx,
  siteId: Id<"sites">,
): Promise<{
  siteId: Id<"sites">;
  pages: { slug: string; title: string; summary: string; keywords?: string[] }[];
  siteSummary: string;
}> {
  const site = await ctx.runQuery(api.sites.get, { siteId });
  if (!site) throw new Error("Site not found");
  const { html } = await fetchHtml(site.domain);

  const text = await callClaude(
    "You are an SEO onboarding agent. Extract up to 8 important pages for internal linking.",
    `Return JSON only in shape {"siteSummary": string, "pages":[{"slug":string,"title":string,"summary":string,"keywords":string[]}]} based on this HTML:\n${html.slice(0, 8000)}`,
    4096,
  );

  const data = parseJson<{
    siteSummary?: string;
    pages: { slug: string; title: string; summary: string; keywords?: string[] }[];
  }>(z.object({
    siteSummary: z.string().optional(),
    pages: z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        summary: z.string(),
        keywords: z.array(z.string()).optional(),
      }),
    ),
  }), text);

  const pages = data.pages ?? [];
  if (pages.length) {
    await ctx.runMutation(api.pages.bulkUpsert, {
      siteId,
      pages: pages.map((p) => ({
        url: `${site.domain.replace(/\/$/, "")}/${p.slug.replace(/^\//, "")}`,
        slug: p.slug.startsWith("/") ? p.slug : `/${p.slug}`,
        title: p.title,
        keywords: p.keywords,
        summary: p.summary,
      })),
    });
  }

  await inferSiteProfile(ctx, html, siteId, {
    domain: site.domain,
    tone: site.tone,
    niche: site.niche,
    inferToneNiche: site.inferToneNiche,
  });

  return {
    siteId,
    pages,
    siteSummary: data.siteSummary ?? "",
  };
}

async function handlePlan(
  ctx: ActionCtx,
  siteId: Id<"sites">,
): Promise<{ count: number }> {
  const site = await ctx.runQuery(api.sites.get, { siteId });
  if (!site) throw new Error("Site not found");

  // Fetch ALL existing topics so the AI knows what's already covered
  const existingTopics = await ctx.runQuery(api.topics.listBySite, { siteId });
  const existingKeywords = existingTopics.map(
    (t: { primaryKeyword: string }) => t.primaryKeyword,
  );
  const existingLabels = existingTopics.map(
    (t: { label: string }) => t.label,
  );

  console.log(`Existing topics: ${existingTopics.length} — generating diverse new topics...`);

  const text = await callClaude(
    "You are an expert SEO strategist specializing in topical authority and content diversification. " +
    "Your goal is to propose NEW topic clusters that expand the site's search footprint into adjacent, " +
    "high-value territory — NOT repeat what already exists. Output JSON only.",
    `Domain: ${site.domain}\n` +
    `Site: ${site.siteName ?? site.domain}\n` +
    `Niche: ${site.niche ?? ""}\n` +
    `Blog Theme: ${site.blogTheme ?? ""}\n` +
    `Target Audience: ${site.targetAudienceSummary ?? ""}\n` +
    `Pain Points: ${site.painPoints?.join("; ") ?? ""}\n` +
    `Key Features: ${site.keyFeatures?.join("; ") ?? ""}\n` +
    `Tone: ${site.tone ?? "neutral"}\n` +
    `Language: ${site.language ?? "en"}\n` +
    (site.competitors?.length ? `Competitors (avoid these): ${site.competitors.join(", ")}\n` : "") +
    (site.anchorKeywords?.length ? `Priority Keywords: ${site.anchorKeywords.join(", ")}\n` : "") +
    `\n` +
    `EXISTING TOPICS ALREADY COVERED (DO NOT DUPLICATE OR OVERLAP WITH THESE):\n` +
    existingKeywords.map((kw: string, i: number) => `- "${kw}" (${existingLabels[i]})`).join("\n") +
    `\n\n` +
    `RULES:\n` +
    `1. Do NOT generate topics with primaryKeywords that overlap, duplicate, or are synonyms of the existing topics listed above.\n` +
    `2. EXPAND into adjacent search territory that still relates to the site's niche. Examples: personal finance tips, budgeting strategies, money-saving hacks, SaaS industry trends, fintech app reviews, digital spending habits, financial literacy, cost comparison guides, productivity tools.\n` +
    `3. Include a MIX of search intents: ~40% informational, ~30% commercial, ~30% transactional.\n` +
    `4. Prefer long-tail keywords (3-5 words) with lower competition over broad head terms.\n` +
    `5. Each topic should target a UNIQUE search query — no two topics should compete for the same SERP.\n` +
    `6. Generate 10-15 new topics.\n\n` +
    `Return JSON array: [{"label":"...","primaryKeyword":"...","secondaryKeywords":["..."],"intent":"informational|commercial|transactional","priority":1-5,"notes":"short reason why this topic is valuable"}]`,
    8192,
  );

  const plan = parseJson<z.infer<typeof PlanSchema>>(PlanSchema, text);
  await ctx.runMutation(api.topics.upsertMany, { siteId, topics: plan });
  console.log(`Generated ${plan.length} new diverse topics.`);
  return { count: plan.length };
}

async function handleArticle(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  topicId?: Id<"topic_clusters">,
  options?: RichMediaOptions,
  jobId?: Id<"jobs">,
): Promise<{ articleId: Id<"articles"> }> {
  const TOTAL_STEPS = 9;
  const reportProgress = async (step: number, label: string) => {
    if (!jobId) return;
    try {
      await ctx.runMutation(api.jobs.updateProgress, {
        jobId,
        current: step,
        total: TOTAL_STEPS,
        stepLabel: label,
      });
    } catch {
      // Never break pipeline for progress reporting
    }
  };

  const site = await ctx.runQuery(api.sites.get, { siteId });
  const topic = topicId
    ? await ctx.runQuery(api.topics.get, { topicId })
    : null;
  if (!site) throw new Error("Site not found");
  if (topicId && !topic) throw new Error("Topic not found");

  // ── Step 1: Web Research (graceful degradation) ──
  await reportProgress(1, "Researching the web...");
  let researchContext = "";
  let researchSources: { url: string; title?: string }[] = [];

  if (topic) {
    try {
      const research = await webResearch(
        {
          label: topic.label,
          primaryKeyword: topic.primaryKeyword,
          secondaryKeywords: topic.secondaryKeywords,
          intent: topic.intent ?? undefined,
        },
        site.niche ?? undefined,
      );
      researchContext = research.researchSummary;
      researchSources = research.sources;
      console.log(`Research gathered: ${researchContext.length} chars, ${researchSources.length} sources`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`Web research failed (continuing without): ${msg}`);
    }
  }

  // ── Step 1b: YouTube Video Search (graceful degradation) ──
  await reportProgress(2, "Searching YouTube videos...");
  let youtubeVideos: { videoId: string; title: string }[] = [];
  const enableYouTube = site.youtubeEmbeds !== false;

  if (enableYouTube && topic) {
    try {
      youtubeVideos = await searchYouTubeVideos(
        topic.label,
        site.niche ?? "",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`YouTube search failed (continuing without): ${msg}`);
    }
  }

  // ── Step 1c: Screenshot Capture (graceful degradation) ──
  await reportProgress(3, "Capturing site screenshot...");
  let screenshotUrl: string | undefined;

  try {
    screenshotUrl = await captureScreenshot(ctx, site.domain);
    console.log(`Site screenshot captured: ${screenshotUrl}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`Screenshot capture failed (continuing without): ${msg}`);
  }

  // ── Step 1d: Web Image Search (graceful degradation) ──
  await reportProgress(4, "Searching for images...");
  let webImages: { url: string; alt: string; source: string }[] = [];

  if (topic) {
    try {
      webImages = await searchWebImages(topic.label, site.niche ?? "");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`Web image search failed (continuing without): ${msg}`);
    }
  }

  // ── Step 1e: Live Site Data Crawl (graceful degradation) ──
  await reportProgress(5, "Crawling site data...");
  let siteData = { pricing: "", features: "", homepage: "" };

  try {
    siteData = await crawlSiteData(site.domain);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`Site data crawl failed (continuing without): ${msg}`);
  }

  // ── Step 2: Generate Article (with full site context + real media) ──
  await reportProgress(6, "Writing article content...");
  console.log(`Generating article for topic: ${topic?.label ?? "General"}`);

  const researchBlock = researchContext
    ? `\n\nRESEARCH BRIEF (use these facts, statistics, and information — cite them with inline [1], [2] etc.):\n${researchContext}`
    : "";

  // Build YouTube embed block
  const youtubeBlock = youtubeVideos.length > 0
    ? `\nYOUTUBE VIDEOS TO EMBED: Embed these relevant videos at appropriate points in the article (after a relevant section, not all at once). Use this exact HTML for each:\n` +
      youtubeVideos.map((v) =>
        `- "${v.title}": <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:1.5em 0;border-radius:8px;"><iframe src="https://www.youtube.com/embed/${v.videoId}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen></iframe></div>`
      ).join("\n")
    : "";

  // Build competitor exclusion block
  const competitorBlock = site.competitors?.length
    ? `\nCOMPETITOR EXCLUSIONS: NEVER mention or link to these companies: ${site.competitors.join(", ")}.`
    : "";

  // Build CTA block
  const ctaBlock = site.ctaText && site.ctaUrl
    ? `\nCALL TO ACTION: Naturally weave in a CTA at least once in the article body and once at the end. CTA text: "${site.ctaText}" linking to ${site.ctaUrl}. Make it feel organic, not salesy.`
    : "";

  // Build audience context
  const audienceBlock = site.targetAudienceSummary
    ? `\nTARGET AUDIENCE: ${site.targetAudienceSummary}` +
      (site.painPoints?.length ? `\nPAIN POINTS to address: ${site.painPoints.join("; ")}` : "") +
      (site.productUsage ? `\nHOW THEY USE THE PRODUCT: ${site.productUsage}` : "")
    : "";

  // Build anchor keyword priorities
  const anchorBlock = site.anchorKeywords?.length
    ? `\nANCHOR KEYWORDS: Naturally incorporate these keywords where relevant: ${site.anchorKeywords.join(", ")}.`
    : "";

  // Build screenshot embed block
  const screenshotBlock = screenshotUrl
    ? `\nSITE SCREENSHOT: A real screenshot of ${site.domain} has been captured and is available at this URL: ${screenshotUrl}\n` +
      `Embed it naturally in the article (introduction or product overview) using: ![${site.siteName ?? site.domain} website](${screenshotUrl})\n` +
      `This is a REAL screenshot — use it to show readers what the product/site actually looks like.`
    : "";

  // Build web images block
  const webImagesBlock = webImages.length > 0
    ? `\nWEB IMAGES (real infographics/charts found on the web — NOT AI-generated): Embed these at relevant points in the article with attribution:\n` +
      webImages
        .map(
          (img) =>
            `- Image: ![${img.alt}](${img.url})\n  Caption: *Source: ${img.source}*`,
        )
        .join("\n")
    : "";

  // Build live crawl data block
  const liveDataBlock =
    siteData.pricing || siteData.features
      ? `\nLIVE CRAWLED DATA FROM ${site.domain.toUpperCase()} — use this for ACCURATE tables and product information:\n` +
        (siteData.pricing
          ? `\n--- PRICING PAGE DATA ---\n${siteData.pricing.slice(0, 3000)}\n`
          : "") +
        (siteData.features
          ? `\n--- FEATURES PAGE DATA ---\n${siteData.features.slice(0, 3000)}\n`
          : "") +
        `\nIMPORTANT: When building comparison tables or mentioning pricing/features, use the REAL data above. Do NOT make up numbers.`
      : "";

  // Citation and linking settings
  const citationRule = site.sourceCitations !== false
    ? "9. INLINE CITATIONS: Use numbered citations [1], [2], [3] throughout the article when referencing statistics, quotes, or factual claims. Add a '## Sources' section at the very end listing each source as: [1] Title — URL"
    : "9. Do NOT add inline citations or a sources section.";

  const externalLinkRule = site.externalLinking !== false
    ? "10. EXTERNAL LINKS: Include 5-10 outbound links to authoritative sources naturally within the text (not just in the sources section)."
    : "10. Do NOT include external links in the article body.";

  const articleText = await callClaude(
    "You are an elite SEO content writer producing articles that rank on page 1 of Google. " +
    "Your articles are data-driven, authoritative, and genuinely useful — not generic filler.\n\n" +
    "MANDATORY ARTICLE STRUCTURE:\n" +
    "1. HOOK: Open with a compelling statistic, surprising fact, or data point from the research. Example: 'According to a 2024 Gartner report, 73% of...' — NEVER start with a generic statement.\n" +
    "2. TL;DR BOX: After the hook paragraph, include a '> **TL;DR:** ...' blockquote summarizing the key takeaway in 2-3 sentences.\n" +
    "3. TABLE OF CONTENTS: After the TL;DR, add '## Table of Contents' with a bullet list linking to each H2 section using markdown anchors: `- [Section Title](#section-title)`. This improves UX and helps Google generate sitelinks.\n" +
    "4. WORD COUNT: 3500-4500 words. Non-negotiable.\n" +
    "5. SECTIONS: 8-12 H2 sections with H3 subsections. Each section must provide specific, actionable information.\n" +
    "6. COMPARISON TABLE: Include at least one markdown comparison table with real data.\n" +
    "7. PRACTICAL ELEMENTS: Include a 'Pro Tips' or 'Best Practices' section with numbered actionable items.\n" +
    "8. FAQ: End with a '## Frequently Asked Questions' section with 8-10 questions in this exact format:\n" +
    "   ### Question here?\n" +
    "   Answer paragraph here.\n" +
    "   (This triggers Google's FAQ rich snippets.)\n" +
    citationRule + "\n" +
    externalLinkRule + "\n" +
    "11. TONE: Write in a " + (site.tone ?? "professional") + " tone throughout.\n" +
    "12. NO FLUFF: Every paragraph must contain specific information, data, examples, or actionable advice. Cut generic filler.\n" +
    "13. KEY TAKEAWAYS: Include a '## Key Takeaways' section near the end with 5-7 bullet points summarizing the main insights.\n" +
    "14. YOUTUBE EMBEDS: If YouTube video HTML is provided below, embed them at relevant points in the article (after related sections). Copy the HTML exactly as provided.\n" +
    "15. REAL IMAGES: If a site screenshot URL or web infographic URLs are provided below, embed them in the article using standard markdown image syntax: ![alt text](url). Place the site screenshot in the intro/overview section. Place infographics near relevant data sections. Add italic captions below images.\n" +
    "16. REAL DATA: If live crawled data from the site is provided below (pricing, features), use the ACTUAL numbers and details to build comparison tables and product descriptions. NEVER fabricate pricing tiers or feature lists — use only what was crawled.\n" +
    "17. EXPERT QUOTES: Include 2-3 blockquotes from real industry experts, executives, or researchers. Use the format: > *\"Quote text.\"* — **Name**, Title, Company [citation]. Pull these from the research brief — NEVER fabricate quotes.\n" +
    "18. REAL COMPANY CASE STUDIES: Include 3-5 real company examples (e.g. LEGO, HubSpot, Shopify) with specific metrics and outcomes. Example: 'Domino's chatbot managed millions of orders monthly, leading to a 25% increase in customer satisfaction.' Pull from research — NEVER fabricate case studies.\n" +
    "19. NO META-TALK: Output the article content only within the JSON structure. No explanations outside.\n" +
    "20. JSON ONLY: Output a single JSON object. No markdown code blocks around it.\n" +
    "21. SOURCES: Include real, verifiable source URLs. Prefer sources from the research brief.",
    `SITE CONTEXT:\n` +
    `Domain: ${site.domain}\n` +
    `Site: ${site.siteName ?? site.domain}\n` +
    `Summary: ${site.siteSummary ?? ""}\n` +
    `Niche: ${site.niche ?? ""}\n` +
    `Blog Theme: ${site.blogTheme ?? ""}` +
    audienceBlock +
    competitorBlock +
    ctaBlock +
    anchorBlock +
    youtubeBlock +
    screenshotBlock +
    webImagesBlock +
    liveDataBlock +
    `\n\nARTICLE TARGET:\n` +
    `Topic: ${topic?.label ?? "General"}\n` +
    `Primary Keyword: ${topic?.primaryKeyword ?? ""}\n` +
    `Secondary Keywords: ${topic?.secondaryKeywords?.join(", ") ?? ""}\n` +
    `Search Intent: ${topic?.intent ?? "informational"}` +
    researchBlock +
    `\n\nReturn JSON: {"title": "string", "slug": "string", "markdown": "string (the full 3500-4500 word article with ToC, YouTube embeds, key takeaways)", "metaTitle": "string (max 60 chars, include primary keyword)", "metaDescription": "string (max 155 chars, compelling + keyword)", "metaKeywords": ["keyword1", "keyword2", ...] (8-12 SEO-relevant keywords/phrases), "sources": [{"url": "string", "title": "string"}]}`,
    16384,
  );

  const article = parseJson<z.infer<typeof ArticleSchema>>(
    ArticleSchema,
    articleText,
  );

  // Merge research sources with article-generated sources (deduplicate by URL)
  const allSources = [...(article.sources ?? []), ...researchSources];
  const seenUrls = new Set<string>();
  const dedupedSources = allSources.filter((s) => {
    if (seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });

  // ── Step 3: Fact Check (graceful degradation) ──
  await reportProgress(7, "Fact-checking claims...");
  let finalMarkdown = article.markdown;
  let finalSources = dedupedSources;
  let factCheckScore: number | undefined;
  let factCheckNotes: string | undefined;

  try {
    console.log("Running fact check...");
    const reviewed = await factCheckArticle(finalMarkdown, dedupedSources);
    finalMarkdown = reviewed.markdown;
    if (reviewed.citations?.length) {
      const additionalSources = reviewed.citations.filter(
        (c) => !seenUrls.has(c.url),
      );
      finalSources = [...dedupedSources, ...additionalSources];
    }
    factCheckScore = reviewed.confidenceScore;
    if (reviewed.notes) {
      factCheckNotes = reviewed.notes;
      console.log(`Fact-check notes: ${reviewed.notes}`);
    }
    if (reviewed.confidenceScore != null) {
      const verified = reviewed.verifiedCount ?? "?";
      const total = reviewed.claimCount ?? "?";
      console.log(`Fact-check score: ${reviewed.confidenceScore}% (${verified}/${total} claims verified)`);
    }
    console.log("Fact check complete.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`Fact check failed (using original article): ${msg}`);
  }

  // ── Step 4: Featured Image (screenshot first, AI fallback) ──
  await reportProgress(8, "Generating featured image...");
  let featuredImage: string | undefined = screenshotUrl;

  if (featuredImage) {
    console.log(`Using site screenshot as featured image: ${featuredImage}`);
  } else {
    // Fallback to AI-generated hero image
    try {
      featuredImage = await generateHeroImage(
        ctx,
        article.title,
        site.niche ?? "",
        site.imageBrandingPrompt ?? undefined,
      );
      console.log(`AI hero image generated as fallback: ${featuredImage}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`Image generation failed (continuing without): ${msg}`);
    }
  }

  // ── Step 5: Calculate Article Stats ──
  const { readingTime, wordCount } = calculateArticleStats(finalMarkdown);
  console.log(`Article stats: ${wordCount} words, ${readingTime} min read`);

  // ── Step 6: Create Draft ──
  const slug = article.slug || buildSlug(article.title);

  const articleId = await ctx.runMutation(api.articles.createDraft, {
    siteId,
    topicId: topicId ?? undefined,
    title: article.title,
    slug: slug.startsWith("/") ? slug : `/${slug}`,
    markdown: finalMarkdown,
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
    metaKeywords: article.metaKeywords,
    sources: finalSources.length > 0 ? finalSources : undefined,
    language: site.language,
    featuredImage,
    readingTime,
    wordCount,
    factCheckScore,
    factCheckNotes,
  });

  if (topicId) {
    await ctx.runMutation(api.topics.updateStatus, {
      topicId,
      status: "used",
    });
  }

  return { articleId };
}

async function handleLinks(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  articleId: Id<"articles">,
): Promise<{ count: number }> {
  const site = await ctx.runQuery(api.sites.get, { siteId });
  const article = await ctx.runQuery(api.articles.get, { articleId });
  if (!site || !article) throw new Error("Missing site or article");
  const pages = await ctx.runQuery(api.pages.listBySite, { siteId });

  const linkText = await callClaude(
    "Suggest concise internal links. Output JSON array only: [{\"anchor\":\"...\",\"href\":\"/path\"}].",
    `Use this article and site pages to propose 5-10 internal links. Article title: ${article.title}. Slug: ${article.slug}. Pages: ${pages
      .map((p: { slug: string; title?: string }) => `${p.slug}:${p.title ?? ""}`)
      .join("; ")}`,
    2048,
  );

  const links = parseJson<z.infer<typeof LinkSchema>>(LinkSchema, linkText);
  await ctx.runMutation(api.articles.updateLinks, { articleId, internalLinks: links });

  // Inject links into the article markdown body for actual SEO value
  if (links.length > 0 && article.markdown) {
    let updatedMarkdown = article.markdown;
    for (const link of links) {
      // Skip if this link target is the article's own slug
      if (link.href === article.slug) continue;
      // Only replace the first occurrence, and only if not already a markdown link
      const anchor = link.anchor;
      const escapedAnchor = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match anchor text that is NOT already inside a markdown link [...](...)
      const regex = new RegExp(`(?<!\\[)${escapedAnchor}(?!\\]\\()`, "i");
      const replacement = `[${anchor}](${link.href})`;
      if (regex.test(updatedMarkdown)) {
        updatedMarkdown = updatedMarkdown.replace(regex, replacement);
      }
    }
    // Save the updated markdown with embedded links
    if (updatedMarkdown !== article.markdown) {
      await ctx.runMutation(api.articles.updateMarkdown, {
        articleId,
        markdown: updatedMarkdown,
      });
    }
  }

  return { count: links.length };
}

/** Deep AI analysis of a crawled site — extracts profile, audience, strategy. */
async function handleAnalyzeSite(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  html: string,
  pages: { slug: string; title: string; summary: string; keywords?: string[] }[],
): Promise<{
  siteName: string;
  siteType: string;
  siteSummary: string;
  blogTheme: string;
  keyFeatures: string[];
  pricingInfo: string;
  founders: string;
  niche: string;
  tone: string;
  targetCountry: string;
  targetAudienceSummary: string;
  painPoints: string[];
  productUsage: string;
  suggestedCompetitors: string[];
  suggestedAnchorKeywords: string[];
}> {
  const site = await ctx.runQuery(api.sites.get, { siteId });
  if (!site) throw new Error("Site not found");

  // Feed homepage HTML + all page summaries to Claude for deep analysis
  const pageContext = pages
    .map((p) => `[${p.title}] (${p.slug})\n${p.summary}\nKeywords: ${p.keywords?.join(", ") ?? "none"}`)
    .join("\n\n");

  const AnalysisSchema = z.object({
    siteName: z.string(),
    siteType: z.string(),
    siteSummary: z.string(),
    blogTheme: z.string(),
    keyFeatures: z.array(z.string()),
    pricingInfo: z.string(),
    founders: z.string(),
    niche: z.string(),
    tone: z.string(),
    targetCountry: z.string(),
    targetAudienceSummary: z.string(),
    painPoints: z.array(z.string()),
    productUsage: z.string(),
    suggestedCompetitors: z.array(z.string()),
    suggestedAnchorKeywords: z.array(z.string()),
  });

  const text = await callClaude(
    "You are an expert SEO strategist and business analyst. You have been given REAL content crawled from a website. " +
    "Analyze it thoroughly and extract a complete site profile. Be specific and data-driven — use actual information from the crawled content, never guess.\n\n" +
    "RULES:\n" +
    "1. Only state facts you can confirm from the crawled content.\n" +
    "2. If information is not available, say 'Not found on website' — never fabricate.\n" +
    "3. For target audience, infer from the product/service who would benefit most.\n" +
    "4. For competitors, suggest 3-5 real companies in the same space.\n" +
    "5. For anchor keywords, suggest 5-10 primary keywords the site should rank for.\n" +
    "6. Blog theme should describe what topics the blog should cover to drive organic traffic.\n" +
    "7. Pain points should be specific problems the target audience faces that this product solves.\n" +
    "8. Tone should be one of: professional, friendly, casual, authoritative, technical.\n" +
    "9. Output JSON only.",
    `Domain: ${site.domain}\n\n` +
    `HOMEPAGE HTML (first 10000 chars):\n${html.slice(0, 10000)}\n\n` +
    `CRAWLED PAGES (${pages.length} pages):\n${pageContext}\n\n` +
    `Return JSON:\n` +
    `{\n` +
    `  "siteName": "company/product name",\n` +
    `  "siteType": "SaaS Product | E-commerce | Blog | Agency | Marketplace | Media | Non-profit | Other",\n` +
    `  "siteSummary": "3-5 sentence description of what this company/product does",\n` +
    `  "blogTheme": "what the blog should focus on to drive SEO traffic",\n` +
    `  "keyFeatures": ["feature 1", "feature 2", ...],\n` +
    `  "pricingInfo": "pricing tiers/model if found, otherwise 'Not found on website'",\n` +
    `  "founders": "founder names if found, otherwise 'Not found on website'",\n` +
    `  "niche": "specific industry/market niche",\n` +
    `  "tone": "professional|friendly|casual|authoritative|technical",\n` +
    `  "targetCountry": "primary target country/region",\n` +
    `  "targetAudienceSummary": "detailed description of who the ideal customer is",\n` +
    `  "painPoints": ["pain point 1", "pain point 2", ...],\n` +
    `  "productUsage": "how the target audience would use this product/service",\n` +
    `  "suggestedCompetitors": ["competitor1.com", "competitor2.com", ...],\n` +
    `  "suggestedAnchorKeywords": ["keyword 1", "keyword 2", ...]\n` +
    `}`,
    8192,
  );

  const analysis = parseJson<z.infer<typeof AnalysisSchema>>(AnalysisSchema, text);

  // If pricing wasn't found in the HTML (common with client-rendered sites), try web search
  if (
    analysis.pricingInfo.toLowerCase().includes("not found") ||
    analysis.pricingInfo.toLowerCase().includes("not available") ||
    analysis.pricingInfo.toLowerCase().includes("not provided")
  ) {
    try {
      console.log("Pricing not found in crawl — searching the web...");
      const client = openaiClient();
      const completion = await client.responses.create({
        model: "gpt-5-mini-2025-08-07",
        tools: [{ type: "web_search_preview" as any }],
        input: [
          {
            role: "user",
            content: `What are the pricing plans and tiers for ${site.domain}? Include plan names, prices, and key features for each tier. Be specific with numbers.`,
          },
        ],
      });
      const pricingText = completion.output
        .filter((b: any) => b.type === "message")
        .map((b: any) =>
          b.content
            .filter((c: any) => c.type === "output_text")
            .map((c: any) => c.text)
            .join(""),
        )
        .join("");
      if (pricingText && pricingText.length > 20) {
        // Summarize with Claude for clean format
        const summary = await callClaude(
          "Summarize this pricing information into a concise format. List each plan with name, price, and key features. Be factual — only include what's stated.",
          pricingText.slice(0, 4000),
          1024,
        );
        analysis.pricingInfo = summary;
        console.log("Pricing found via web search");
      }
    } catch (e) {
      console.log("Pricing web search failed (non-critical):", e);
    }
  }

  // Save analysis to the site record
  await ctx.runMutation(api.sites.upsert, {
    id: siteId,
    domain: site.domain,
    siteName: analysis.siteName,
    siteType: analysis.siteType,
    siteSummary: analysis.siteSummary,
    blogTheme: analysis.blogTheme,
    keyFeatures: analysis.keyFeatures,
    pricingInfo: analysis.pricingInfo,
    founders: analysis.founders,
    niche: analysis.niche,
    tone: analysis.tone,
    targetCountry: analysis.targetCountry,
    targetAudienceSummary: analysis.targetAudienceSummary,
    painPoints: analysis.painPoints,
    productUsage: analysis.productUsage,
    competitors: analysis.suggestedCompetitors,
    anchorKeywords: analysis.suggestedAnchorKeywords,
  });

  console.log(`Site analysis complete for ${site.domain}: ${analysis.siteName} (${analysis.siteType})`);
  return analysis;
}

export const onboardSite = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => handleOnboarding(ctx, siteId),
});

/** Crawl + deep AI analysis in one step. Returns everything the wizard needs. */
export const crawlAndAnalyze = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    // Step 1: Crawl (reuse existing handleOnboarding)
    const crawlResult = await handleOnboarding(ctx, siteId);

    // Step 2: Fetch homepage HTML again for deep analysis + brand detection
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");
    const { html, url } = await fetchHtml(site.domain);

    // Step 2.5: Programmatic brand extraction (colors, fonts, logo)
    let brand: BrandDetection = { primaryColor: null, accentColor: null, fontFamily: null, logoUrl: null };
    try {
      brand = await extractBrandFromHtml(html, url);
      console.log(`Brand detection: primary=${brand.primaryColor}, accent=${brand.accentColor}, font=${brand.fontFamily}, logo=${brand.logoUrl ? "found" : "none"}`);
      await ctx.runMutation(api.sites.upsert, {
        id: siteId,
        domain: site.domain,
        brandPrimaryColor: brand.primaryColor ?? undefined,
        brandAccentColor: brand.accentColor ?? undefined,
        brandFontFamily: brand.fontFamily ?? undefined,
        brandLogoUrl: brand.logoUrl ?? undefined,
      });
    } catch (err) {
      console.error(`Brand detection failed (non-critical): ${err instanceof Error ? err.message : "unknown"}`);
    }

    // Step 3: Deep AI analysis
    const analysis = await handleAnalyzeSite(ctx, siteId, html, crawlResult.pages);

    return {
      pages: crawlResult.pages,
      analysis,
      brand: {
        primaryColor: brand.primaryColor,
        accentColor: brand.accentColor,
        fontFamily: brand.fontFamily,
        logoUrl: brand.logoUrl,
      },
    };
  },
});

export const generatePlan = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => handlePlan(ctx, siteId),
});

export const generateArticle = action({
  args: {
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
    options: v.optional(
      v.object({
        targetWords: v.optional(v.number()),
        includeTables: v.optional(v.boolean()),
        includeLists: v.optional(v.boolean()),
        includeImages: v.optional(v.boolean()),
        includeYouTube: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { siteId, topicId, options }) => {
    const site = await ctx.runQuery(api.sites.get, { siteId });

    // Create a tracking job for progress visibility
    const jobId = await ctx.runMutation(api.jobs.create, {
      siteId,
      type: "article",
    });
    await ctx.runMutation(api.jobs.markRunning, { jobId });

    let res: { articleId: Id<"articles"> };
    try {
      res = await handleArticle(ctx, siteId, topicId, options ?? undefined, jobId);
    } catch (err) {
      await ctx.runMutation(api.jobs.markFailed, {
        jobId,
        error: err instanceof Error ? err.message : "unknown",
      });
      throw err;
    }

    // Add internal links before publishing (graceful degradation)
    try {
      await ctx.runMutation(api.jobs.updateProgress, {
        jobId,
        current: 9,
        total: 9,
        stepLabel: "Adding internal links...",
      });
      console.log(`Adding internal links to article ${res.articleId}...`);
      const linkResult = await handleLinks(ctx, siteId, res.articleId);
      console.log(`Added ${linkResult.count} internal links.`);
    } catch (err) {
      const linkError = err instanceof Error ? err.message : "unknown link error";
      console.error(`Internal linking failed (publishing without links): ${linkError}`);
    }

    await ctx.runMutation(api.jobs.markDone, { jobId, result: { articleId: res.articleId } });

    // If approval is required, hold at "review" status — don't auto-publish
    if (site?.approvalRequired) {
      await ctx.runMutation(api.articles.updateStatus, {
        articleId: res.articleId,
        status: "review",
      });
      console.log(`Approval required — article ${res.articleId} held at "review" status.`);
      return res;
    }

    // For manual mode, hold at "ready" — user copies from UI
    if (site?.publishMethod === "manual") {
      await ctx.runMutation(api.articles.updateStatus, {
        articleId: res.articleId,
        status: "ready",
      });
      console.log(`Manual publish mode — article ${res.articleId} held at "ready" for user to copy.`);
      return res;
    }

    // Auto-publish (best-effort; don't fail generation if publish fails)
    try {
      await ctx.runAction(api.publisher.publishArticle, {
        siteId,
        articleId: res.articleId,
      });
    } catch (err) {
      const pubError = err instanceof Error ? err.message : "unknown publish error";
      console.error(`Publish failed for article ${res.articleId}: ${pubError}`);
    }

    return res;
  },
});

// Publish an approved article (called from the UI after user approves)
export const publishApproved = action({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
  },
  handler: async (ctx, { siteId, articleId }) => {
    const article = await ctx.runQuery(api.articles.get, { articleId });
    if (!article) throw new Error("Article not found");
    if (article.status !== "ready") {
      throw new Error(`Article must be in "ready" status to publish, got "${article.status}"`);
    }

    await ctx.runAction(api.publisher.publishArticle, {
      siteId,
      articleId,
    });

    return { published: true, articleId };
  },
});

// Generate an article immediately (bypass cron), picking the next available topic
export const generateNow = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    const topics = await ctx.runQuery(api.topics.listBySite, { siteId });
    const available = topics.filter(
      (t: { status?: string }) =>
        t.status === "planned" || t.status === "pending",
    );

    if (available.length === 0) {
      throw new Error("No available topics. Generate a content plan first.");
    }

    // Pick the highest priority available topic
    const sorted = [...available].sort(
      (a: { priority?: number }, b: { priority?: number }) =>
        (b.priority ?? 0) - (a.priority ?? 0),
    );
    const topic = sorted[0];

    console.log(`Run Now: generating article for topic "${topic.primaryKeyword}"`);

    // Create a tracking job for progress visibility
    const jobId = await ctx.runMutation(api.jobs.create, {
      siteId,
      type: "article",
    });
    await ctx.runMutation(api.jobs.markRunning, { jobId });

    let res: { articleId: Id<"articles"> };
    try {
      res = await handleArticle(ctx, siteId, topic._id, undefined, jobId);
    } catch (err) {
      await ctx.runMutation(api.jobs.markFailed, {
        jobId,
        error: err instanceof Error ? err.message : "unknown",
      });
      throw err;
    }

    // Add internal links (graceful degradation)
    try {
      await ctx.runMutation(api.jobs.updateProgress, {
        jobId,
        current: 9,
        total: 9,
        stepLabel: "Adding internal links...",
      });
      const linkResult = await handleLinks(ctx, siteId, res.articleId);
      console.log(`Added ${linkResult.count} internal links.`);
    } catch (err) {
      console.error(`Internal linking failed: ${err instanceof Error ? err.message : "unknown"}`);
    }

    await ctx.runMutation(api.jobs.markDone, { jobId, result: { articleId: res.articleId } });

    // If approval is required, hold at "review"
    if (site.approvalRequired) {
      await ctx.runMutation(api.articles.updateStatus, {
        articleId: res.articleId,
        status: "review",
      });
      console.log(`Approval required — article held at "review".`);
      return res;
    }

    // For manual mode, hold at "ready" — user copies from UI
    if (site.publishMethod === "manual") {
      await ctx.runMutation(api.articles.updateStatus, {
        articleId: res.articleId,
        status: "ready",
      });
      console.log(`Manual publish mode — article held at "ready" for user to copy.`);
      return res;
    }

    // Auto-publish
    try {
      await ctx.runAction(api.publisher.publishArticle, {
        siteId,
        articleId: res.articleId,
      });
    } catch (err) {
      console.error(`Publish failed: ${err instanceof Error ? err.message : "unknown"}`);
    }

    return res;
  },
});

export const suggestInternalLinks = action({
  args: { siteId: v.id("sites"), articleId: v.id("articles") },
  handler: async (ctx, { siteId, articleId }) =>
    handleLinks(ctx, siteId, articleId),
});

// Cron driver to run autopilot across all sites
export const autopilotCron = action({
  args: {},
  handler: async (ctx) => {
    const sites = await ctx.runQuery(api.sites.list, {});
    if (!sites?.length) return { processed: 0 };
    let processed = 0;
    for (const site of sites) {
      const res = await ctx.runAction(api.actions.pipeline.autopilotTick as any, {
        siteId: site._id,
      });
      processed += res?.processed ? 1 : 0;
    }
    return { processed };
  },
});

// Programmatic SEO template generator
export const generateProgrammaticTemplate = action({
  args: {
    siteId: v.id("sites"),
    entityType: v.string(), // e.g., "locations", "products"
    attributes: v.array(v.string()), // e.g., ["city","service","price"]
    exampleRows: v.optional(v.array(v.record(v.string(), v.string()))),
  },
  handler: async (
    ctx,
    { siteId, entityType, attributes, exampleRows },
  ): Promise<{
    template: string;
    fields: string[];
    samplePage: string;
  }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");
    const text = await callClaude(
      "You generate programmatic SEO templates (MDX/Markdown) with slots and examples.",
      `Domain: ${site.domain}\nEntity: ${entityType}\nAttributes: ${attributes.join(
        ", ",
      )}\nExamples: ${JSON.stringify(
        exampleRows ?? [],
      )}\nReturn JSON like {"template":"...","fields":["..."],"samplePage":"..."} with placeholders for the attributes.`,
      8192,
    );
    return parseJson<{
      template: string;
      fields: string[];
      samplePage: string;
    }>(
      z.object({
        template: z.string(),
        fields: z.array(z.string()),
        samplePage: z.string(),
      }),
      text,
    );
  },
});

// News generator
export const generateNewsArticle = action({
  args: {
    siteId: v.id("sites"),
    topic: v.string(),
    region: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { siteId, topic, region },
  ): Promise<{
    title: string;
    slug: string;
    markdown: string;
    sources?: { url: string; title?: string }[];
  }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");
    const newsText = await callClaude(
      "You are a news-focused SEO writer. Produce a concise news article with sources and a quick facts box. Output JSON only.",
      `Site: ${site.domain}\nTopic: ${topic}\nRegion: ${
        region ?? "global"
      }\nReturn JSON like {"title":"...","slug":"...","markdown":"...","sources":[{"url":"..."}]}.`,
      8192,
    );
    return parseJson(
      z.object({
        title: z.string(),
        slug: z.string(),
        markdown: z.string(),
        sources: z
          .array(z.object({ url: z.string(), title: z.string().optional() }))
          .optional(),
      }),
      newsText,
    );
  },
});

// Backlink suggestions
export const suggestBacklinks = action({
  args: { siteId: v.id("sites"), niche: v.optional(v.string()) },
  handler: async (
    ctx,
    { siteId, niche },
  ): Promise<
    { site: string; reason: string; anchor: string; targetUrl: string }[]
  > => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");
    const backlinkText = await callClaude(
      "List high-quality backlink prospects with anchor suggestions. Output JSON only.",
      `Domain: ${site.domain}\nNiche: ${niche ?? site.niche ?? ""}\nReturn JSON like [{"site":"...","reason":"...","anchor":"...","targetUrl":"..."}]`,
      4096,
    );
    return parseJson(
      z.array(
        z.object({
          site: z.string(),
          reason: z.string(),
          anchor: z.string(),
          targetUrl: z.string(),
        }),
      ),
      backlinkText,
    );
  },
});

// Autopilot tick: runs onboarding/plan/scheduling and processes a few jobs
export const autopilotTick = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    // 1. Reset any stuck "running" jobs first
    await ctx.runMutation(api.jobs.resetStuckJobs, {});

    // 2. If no pages, run onboarding
    const pages = await ctx.runQuery(api.pages.listBySite, { siteId });
    if (!pages.length) {
      await handleOnboarding(ctx, siteId);
    }

    // 3. If topics are low, replenish the plan (hands-off replenishment)
    const topics = await ctx.runQuery(api.topics.listBySite, { siteId });
    const availableTopics = topics.filter(
      (t: { status?: string }) => t.status !== "used" && t.status !== "queued",
    );
    if (availableTopics.length < 5) {
      console.log(`Topics low (${availableTopics.length}), replenishing...`);
      await handlePlan(ctx, siteId);
    }

    // 4. Schedule articles for the week
    await ctx.runAction(api.actions.scheduler.scheduleCadence, { siteId });

    // 5. Process ONLY ONE job per tick. 
    // This ensures we never exceed the 10-minute action timeout.
    // With crons running 4x daily, this still processes 28 jobs/week.
    const pending = await ctx.runQuery(api.jobs.listPending, {});
    if (pending.length > 0) {
      console.log(`Processing next job: ${pending[0].type} (${pending[0]._id})`);
      await ctx.runAction(api.actions.pipeline.processNextJob as any, {});
      return { processed: 1 };
    }

    return { processed: 0 };
  },
});

export const processNextJob = action({
  args: {},
  handler: async (
    ctx: ActionCtx,
  ): Promise<{ processed: boolean; jobId?: Id<"jobs">; error?: string }> => {
    const pending = await ctx.runQuery(api.jobs.listPending, {});
    const job = pending[0];
    if (!job) return { processed: false };
    await ctx.runMutation(api.jobs.markRunning, { jobId: job._id });
    try {
      type JobPayload = {
        topicId?: Id<"topic_clusters">;
        articleId?: Id<"articles">;
      };
      const payload = job.payload as JobPayload | undefined;

      if (job.type === "onboarding") {
        if (!job.siteId) throw new Error("Missing siteId on onboarding job");
        await handleOnboarding(ctx, job.siteId);
      } else if (job.type === "plan") {
        if (!job.siteId) throw new Error("Missing siteId on plan job");
        await handlePlan(ctx, job.siteId);
      } else if (job.type === "article") {
        if (!job.siteId) throw new Error("Missing siteId on article job");
        const site = await ctx.runQuery(api.sites.get, { siteId: job.siteId });
        const articleResult = await handleArticle(ctx, job.siteId, payload?.topicId, undefined, job._id);

        // Add internal links BEFORE publishing (graceful degradation)
        try {
          await ctx.runMutation(api.jobs.updateProgress, {
            jobId: job._id,
            current: 9,
            total: 9,
            stepLabel: "Adding internal links...",
          });
          console.log(`Adding internal links to article ${articleResult.articleId}...`);
          const linkResult = await handleLinks(ctx, job.siteId, articleResult.articleId);
          console.log(`Added ${linkResult.count} internal links.`);
        } catch (err: unknown) {
          const linkError = err instanceof Error ? err.message : "unknown link error";
          console.error(`Internal linking failed (publishing without links): ${linkError}`);
        }

        // If approval is required, hold at "review" status — don't auto-publish
        if (site?.approvalRequired) {
          await ctx.runMutation(api.articles.updateStatus, {
            articleId: articleResult.articleId,
            status: "review",
          });
          console.log(`Approval required — article ${articleResult.articleId} held at "review" status.`);
        } else if (site?.publishMethod === "manual") {
          // Manual mode — hold at "ready" for user to copy
          await ctx.runMutation(api.articles.updateStatus, {
            articleId: articleResult.articleId,
            status: "ready",
          });
          console.log(`Manual publish — article ${articleResult.articleId} held at "ready".`);
        } else {
          // Auto-publish (GitHub, WordPress, Webhook)
          try {
            console.log(`Publishing article ${articleResult.articleId}...`);
            await ctx.runAction(api.publisher.publishArticle, {
              siteId: job.siteId,
              articleId: articleResult.articleId,
            });
            console.log(`Article ${articleResult.articleId} published successfully.`);
          } catch (err: unknown) {
            const pubError = err instanceof Error ? err.message : "unknown publish error";
            console.error(`Publish failed for article ${articleResult.articleId}: ${pubError}`);
            await ctx.runMutation(api.jobs.markFailed, {
              jobId: job._id,
              error: `Article generated but publish failed: ${pubError}`,
            });
            return { processed: true, jobId: job._id, error: pubError };
          }
        }
      } else if (job.type === "links") {
        if (!job.siteId) throw new Error("Missing siteId on links job");
        if (!payload?.articleId)
          throw new Error("Missing articleId on links job");
        await handleLinks(ctx, job.siteId, payload.articleId);
      }
      await ctx.runMutation(api.jobs.markDone, {
        jobId: job._id,
        result: "ok",
      });
      return { processed: true, jobId: job._id };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      await ctx.runMutation(api.jobs.markFailed, {
        jobId: job._id,
        error: message,
      });
      return { processed: false, error: message };
    }
  },
});

