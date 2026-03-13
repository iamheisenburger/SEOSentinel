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
  articleType: z.string().optional(),
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
  // Strip markdown code blocks
  const clean = text.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*$/g, "").trim();

  const objStart = clean.indexOf("{");
  const arrStart = clean.indexOf("[");

  let raw: string;
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const arrEnd = clean.lastIndexOf("]");
    if (arrEnd === -1) throw new Error("No closing ] found in response");
    raw = clean.slice(arrStart, arrEnd + 1);
  } else {
    if (objStart === -1) throw new Error("No JSON found in response");
    const objEnd = clean.lastIndexOf("}");
    if (objEnd === -1) throw new Error("No closing } found in response");
    raw = clean.slice(objStart, objEnd + 1);
  }

  // Attempt 1: direct parse
  try {
    return schema.parse(JSON.parse(raw)) as T;
  } catch {}

  // Attempt 2: fix trailing commas (very common LLM mistake)
  try {
    const fixed = raw.replace(/,\s*([\]}])/g, "$1");
    return schema.parse(JSON.parse(fixed)) as T;
  } catch {}

  // Attempt 3: fix unescaped control characters inside JSON strings
  try {
    let fixed = raw.replace(/,\s*([\]}])/g, "$1");
    // Replace literal tabs/newlines that aren't already escaped
    fixed = fixed.replace(/(?<!\\)\t/g, "\\t");
    return schema.parse(JSON.parse(fixed)) as T;
  } catch (err) {
    console.error("All JSON parse attempts failed. First 500 chars:", raw.slice(0, 500));
    console.error("Last 300 chars:", raw.slice(-300));
    throw new Error(`JSON parse failed: ${err instanceof Error ? err.message : "unknown"}`);
  }
};

// ── Article Type Templates ──
// Each type modifies the article_structure prompt section
type ArticleType = "standard" | "listicle" | "how-to" | "checklist" | "comparison" | "roundup" | "ultimate-guide";

function getArticleTypeStructure(articleType: ArticleType, productName: string): string {
  switch (articleType) {
    case "listicle":
      return [
        `ARTICLE TYPE: LISTICLE (N Best/Top X format)`,
        `REQUIRED CONTENT ORDER:`,
        `1. HOOK: Open with why this list matters — a compelling stat or pain point. Briefly introduce ${productName} as a standout option.`,
        `2. TL;DR: "> **TL;DR:** ..." blockquote (2-3 sentences summarizing the top picks).`,
        `3. TABLE OF CONTENTS: "## Table of Contents" linking to each list item.`,
        `4. QUICK COMPARISON TABLE: A summary table comparing all items at a glance.`,
        `5. LIST ITEMS: Each as an H2 (e.g., "## 1. [Item Name] — [One-line value prop]").`,
        `   Each item: 250-400 words covering key features, pros/cons, pricing, and who it's best for.`,
        `   Include a real screenshot or image for at least 3 items.`,
        `6. HOW ${productName} FITS IN: A dedicated section showing how ${productName} compares or complements these options.`,
        `7. HOW TO CHOOSE: Decision criteria or flowchart to help readers pick.`,
        `8. FAQ: 6-8 questions about the category.`,
        `9. KEY TAKEAWAYS: 5-7 bullet points.`,
        `10. SOURCES + STYLED CTA BOX.`,
      ].join("\n");

    case "how-to":
      return [
        `ARTICLE TYPE: HOW-TO GUIDE (Step-by-step tutorial)`,
        `REQUIRED CONTENT ORDER:`,
        `1. HOOK: Start with what the reader will achieve by following this guide. Briefly mention ${productName} as a solution that makes this achievable.`,
        `2. TL;DR: "> **TL;DR:** ..." blockquote with the quick steps summary.`,
        `3. TABLE OF CONTENTS: Linking to each major section.`,
        `4. PREREQUISITES: "## What You'll Need" — tools, knowledge, or setup required.`,
        `5. STEPS: Each step as an H2 (e.g., "## Step 1: [Action]"). In at least one early step, naturally reference how ${productName} handles or simplifies this.`,
        `   Each step: 300-500 words with detailed instructions, code snippets or examples where relevant.`,
        `   Include numbered sub-steps where needed.`,
        `   Add "💡 Pro Tip:" callouts for advanced users.`,
        `6. COMMON MISTAKES: "## Common Mistakes to Avoid" — 4-6 pitfalls.`,
        `7. HOW ${productName} HELPS: Show how ${productName} simplifies or automates part of this process.`,
        `8. FAQ: 6-8 questions about the process.`,
        `9. KEY TAKEAWAYS: Step summary as bullet points.`,
        `10. SOURCES + STYLED CTA BOX.`,
      ].join("\n");

    case "checklist":
      return [
        `ARTICLE TYPE: CHECKLIST (Actionable checkbox-style guide)`,
        `REQUIRED CONTENT ORDER:`,
        `1. HOOK: Why this checklist matters — what happens if you skip items. Mention ${productName} as a tool that automates key items.`,
        `2. TL;DR: "> **TL;DR:** ..." blockquote.`,
        `3. TABLE OF CONTENTS: Linking to each checklist section.`,
        `4. CHECKLIST SECTIONS: Group items into 4-6 categories, each as an H2.`,
        `   Format each item as: "### ☐ [Action Item]" followed by 100-200 words explaining why and how.`,
        `   Include 15-25 total checklist items across all sections.`,
        `5. PRINTABLE SUMMARY: "## Quick Reference Checklist" — all items in a single bulleted list.`,
        `6. HOW ${productName} HELPS: Which checklist items ${productName} handles automatically.`,
        `7. FAQ: 5-7 questions.`,
        `8. KEY TAKEAWAYS + SOURCES + STYLED CTA BOX.`,
      ].join("\n");

    case "comparison":
      return [
        `ARTICLE TYPE: COMPARISON / VS ARTICLE`,
        `REQUIRED CONTENT ORDER:`,
        `1. HOOK: Frame the decision the reader is facing. Mention ${productName} as one option worth considering.`,
        `2. TL;DR: "> **TL;DR:** ..." blockquote with the quick verdict.`,
        `3. TABLE OF CONTENTS.`,
        `4. OVERVIEW: Brief intro to both/all options being compared.`,
        `5. DETAILED COMPARISON TABLE: Comprehensive feature-by-feature markdown table.`,
        `6. CATEGORY BREAKDOWNS: 5-7 H2 sections comparing specific aspects (e.g., "## Pricing", "## Ease of Use", "## Performance").`,
        `   Each section: 200-400 words with specific data, not opinions.`,
        `7. WHO SHOULD USE WHAT: "## Which One Is Right for You?" — scenario-based recommendations.`,
        `8. HOW ${productName} COMPARES: Where ${productName} fits in this landscape.`,
        `9. FAQ: 6-8 questions about the comparison.`,
        `10. VERDICT + KEY TAKEAWAYS + SOURCES + STYLED CTA BOX.`,
      ].join("\n");

    case "roundup":
      return [
        `ARTICLE TYPE: ROUNDUP (Expert opinions or resource collection)`,
        `REQUIRED CONTENT ORDER:`,
        `1. HOOK: Why this topic has multiple expert perspectives worth hearing. Briefly mention ${productName} as a relevant solution in this space.`,
        `2. TL;DR: "> **TL;DR:** ..." blockquote.`,
        `3. TABLE OF CONTENTS.`,
        `4. CONTEXT: Background on why this topic matters now.`,
        `5. EXPERT INSIGHTS / RESOURCES: 7-12 items, each as an H2 or H3.`,
        `   Each: attributed quote or resource summary (200-300 words), with source link.`,
        `6. KEY THEMES: "## Common Themes" — patterns across the insights.`,
        `7. HOW ${productName} APPLIES: Connect the insights to what ${productName} does.`,
        `8. FAQ: 5-7 questions.`,
        `9. KEY TAKEAWAYS + SOURCES + STYLED CTA BOX.`,
      ].join("\n");

    case "ultimate-guide":
      return [
        `ARTICLE TYPE: ULTIMATE GUIDE (Comprehensive, definitive resource — 5000+ words)`,
        `REQUIRED CONTENT ORDER:`,
        `1. HOOK: Establish this as THE definitive resource on the topic. Reference ${productName} as a practical tool readers will learn about.`,
        `2. TL;DR: "> **TL;DR:** ..." blockquote (what the reader will learn).`,
        `3. TABLE OF CONTENTS: Comprehensive, linking to all major sections.`,
        `4. FUNDAMENTALS: "## What Is [Topic]?" — definitions, history, why it matters.`,
        `5. CORE SECTIONS: 6-8 H2 sections covering every major aspect of the topic.`,
        `   Each section: 500-800 words with sub-headings (H3), examples, data, and actionable advice.`,
        `   Include tables, lists, and visuals throughout.`,
        `6. ADVANCED STRATEGIES: 2-3 sections for experienced readers.`,
        `7. TOOLS & RESOURCES: Including how ${productName} fits into the toolkit.`,
        `8. COMMON MISTAKES: 5-7 pitfalls to avoid.`,
        `9. EXPERT QUOTES: 3-5 real expert quotes with citations.`,
        `10. FAQ: 8-12 comprehensive questions.`,
        `11. KEY TAKEAWAYS + SOURCES + STYLED CTA BOX.`,
        ``,
        `WORD COUNT: 5000-7000 words (this is an ULTIMATE guide — be thorough).`,
      ].join("\n");

    default: // "standard"
      return ""; // Use the existing default structure
  }
}

/** Map country name to DataForSEO location code. Defaults to US (2840). */
function mapCountryToLocation(country?: string): number {
  if (!country) return 2840;
  const c = country.toLowerCase().trim();
  const map: Record<string, number> = {
    "us": 2840, "usa": 2840, "united states": 2840,
    "uk": 2826, "united kingdom": 2826, "gb": 2826,
    "ca": 2124, "canada": 2124,
    "au": 2036, "australia": 2036,
    "de": 2276, "germany": 2276,
    "fr": 2250, "france": 2250,
    "in": 2356, "india": 2356,
    "br": 2076, "brazil": 2076,
    "jp": 2392, "japan": 2392,
    "es": 2724, "spain": 2724,
    "it": 2380, "italy": 2380,
    "nl": 2528, "netherlands": 2528,
    "se": 2752, "sweden": 2752,
    "sg": 2702, "singapore": 2702,
    "ae": 2784, "uae": 2784, "united arab emirates": 2784,
    "mx": 2484, "mexico": 2484,
    "global": 2840, "worldwide": 2840,
  };
  return map[c] ?? 2840;
}

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
  brandColor?: string,
): Promise<string> {
  const client = openaiClient();
  const colorHint = brandColor ? ` Use ${brandColor} as the primary accent color.` : "";
  const prompt = brandingPrompt
    ? `${brandingPrompt}. Topic: ${title}`
    : `Create a photorealistic, editorially styled blog hero image that visually represents: "${title}".` +
      ` Industry: ${niche || "technology"}.` +
      ` The image should look like a premium stock photo or editorial illustration that directly relates to the specific topic.` +
      ` Think: what real-world scene, object, or concept does this article title evoke?` +
      ` For example: if about lead capture, show a laptop with a chat widget and notifications.` +
      ` If about sales automation, show a modern workspace with AI dashboard screens.` +
      ` If about chatbots, show a phone or screen with a conversation UI.` +
      ` If about conversion optimization, show a funnel visualization on a real monitor.` +
      ` The visual must be UNIQUE to this specific topic — not a generic tech illustration.` +
      ` Warm, professional lighting. Shallow depth of field. High production value.${colorHint}` +
      ` NO text, NO words, NO letters, NO numbers, NO watermarks, NO stock photo badges.` +
      ` Photorealistic or high-end 3D render quality. 16:9 aspect ratio.`;

  console.log(`Generating hero image for: "${title}"...`);

  const response = await client.images.generate({
    model: "gpt-image-1.5",
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

/** Generate a mid-article process/stats infographic to embed inline. Returns a Convex storage URL. */
async function generateInfographic(
  ctx: ActionCtx,
  title: string,
  primaryKeyword: string,
  niche: string,
  brandColor?: string,
): Promise<string> {
  const client = openaiClient();
  const colorHint = brandColor ? ` Primary accent color: ${brandColor}.` : "";
  const prompt =
    `Create a detailed process flow infographic for the topic: "${primaryKeyword || title}". Industry: ${niche || "technology"}.` +
    ` Style: Step-by-step process diagram or statistical overview — think McKinsey or HubSpot blog infographic.` +
    ` Light/white background with clean typography and numbered steps or percentage statistics.${colorHint}` +
    ` Include visual elements: numbered steps, arrows, icons, metric callouts, flowchart nodes.` +
    ` NO logos, NO watermarks, NO text that says "infographic".` +
    ` Ultra-clean, modern, professional quality. Tall/portrait format (2:3 ratio).`;

  console.log(`Generating mid-article infographic for: "${primaryKeyword}"...`);

  const response = await client.images.generate({
    model: "gpt-image-1.5",
    prompt,
    n: 1,
    size: "1024x1536",
    quality: "medium",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data returned from OpenAI");

  const imageBytes = Buffer.from(b64, "base64");
  const blob = new Blob([imageBytes], { type: "image/png" });
  const storageId = await ctx.storage.store(blob);
  const imageUrl = await ctx.storage.getUrl(storageId);
  if (!imageUrl) throw new Error("Failed to get storage URL for infographic");

  console.log(`Infographic generated and stored: ${storageId}`);
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
  // Clean URL: strip trailing slashes, ensure https
  let targetUrl = url.replace(/\/+$/, "").trim();
  if (!targetUrl.startsWith("http")) targetUrl = `https://${targetUrl}`;

  // thum.io free screenshot API — wait/3 lets JS hydrate
  const screenshotApiUrl = `https://image.thum.io/get/width/${width}/crop/${cropHeight}/wait/3/${targetUrl}`;
  console.log(`Capturing screenshot: ${screenshotApiUrl}`);

  const response = await fetch(screenshotApiUrl);
  if (!response.ok) {
    throw new Error(`Screenshot API returned ${response.status}`);
  }

  const blob = await response.blob();
  console.log(`Screenshot fetched: ${blob.size} bytes`);
  if (blob.size < 5000) {
    throw new Error(`Screenshot too small (${blob.size} bytes) — likely blank`);
  }
  const storageId = await ctx.storage.store(blob);
  const imageUrl = await ctx.storage.getUrl(storageId);
  if (!imageUrl) throw new Error("Failed to get storage URL for screenshot");

  console.log(`Screenshot stored: ${imageUrl}`);
  return imageUrl;
}

/** Search for relevant infographics and data visualizations from the web. */
async function searchWebImages(
  topic: string,
  niche: string,
): Promise<{ url: string; alt: string; source: string }[]> {
  const client = openaiClient();

  const completion = await client.responses.create({
    model: "gpt-4o-mini",
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

  // Validate URLs and check they're actual image files (not HTML pages)
  const validImages: typeof result.images = [];
  for (const img of result.images) {
    try {
      const u = new URL(img.url);
      // Must end with image extension or be from known image CDNs
      const isImageUrl = /\.(png|jpg|jpeg|webp|gif|svg)(\?.*)?$/i.test(u.pathname) ||
        u.hostname.includes('imgur') || u.hostname.includes('cloudinary') ||
        u.hostname.includes('unsplash') || u.hostname.includes('pexels');
      if (!isImageUrl) continue;
      // HEAD check to verify image is accessible (skip if blocked)
      try {
        const headRes = await fetch(img.url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
        const ct = headRes.headers.get('content-type') || '';
        if (!ct.startsWith('image/')) continue;
      } catch { continue; }
      validImages.push(img);
    } catch { continue; }
  }

  console.log(`Found ${validImages.length} web images for "${topic}".`);
  return validImages;
}

/** Crawl a page and extract text content (strips HTML). */
async function crawlPageContent(url: string): Promise<string> {
  try {
    const targetUrl = url.startsWith("http") ? url : `https://${url}`;
    const response = await fetch(targetUrl, {
      headers: { "User-Agent": "Pentra/1.0 (content research)" },
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
  primaryKeyword: string,
  niche: string,
  language: string = "en",
): Promise<{ videoId: string; title: string }[]> {
  const searchTerm = primaryKeyword?.trim() || topic;
  console.log(`YouTube search: "${searchTerm}" (niche: ${niche})`);

  // ── Method 1: Direct YouTube HTML scrape (most reliable) ──
  // Fetch YouTube search results page and extract video IDs + titles from the HTML
  try {
    const query = encodeURIComponent(searchTerm + " " + (niche || "") + " tutorial guide");
    const ytUrl = `https://www.youtube.com/results?search_query=${query}`;
    const res = await fetch(ytUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": language === "en" ? "en-US,en;q=0.9" : `${language},en;q=0.5`,
      },
    });
    if (res.ok) {
      const html = await res.text();
      // YouTube embeds search results in a JSON blob inside the HTML
      // Extract video IDs and titles from the ytInitialData JSON
      const videoMatches: { videoId: string; title: string }[] = [];

      // Pattern 1: Extract from ytInitialData videoRenderer blocks (proper titles)
      const videoRendererRegex = /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"\}/g;
      let match;
      const seenIds = new Set<string>();
      while ((match = videoRendererRegex.exec(html)) !== null && videoMatches.length < 6) {
        const [, videoId, title] = match;
        if (seenIds.has(videoId)) continue;
        seenIds.add(videoId);
        videoMatches.push({ videoId, title });
      }

      // If pattern 1 didn't work, try a simpler pattern
      if (videoMatches.length === 0) {
        const simpleIdRegex = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
        while ((match = simpleIdRegex.exec(html)) !== null && videoMatches.length < 6) {
          const videoId = match[1];
          if (seenIds.has(videoId)) continue;
          seenIds.add(videoId);
          videoMatches.push({ videoId, title: searchTerm });
        }
      }

      if (videoMatches.length > 0) {
        // Filter out obvious garbage
        const garbagePatterns = /\b(official\s*video|music\s*video|rick\s*astley|rickroll|remix|lyric|karaoke|comedy|prank|meme|tiktok|shorts|trailer|movie\s*clip|full\s*episode|reaction|\|\s*ep\s*\d)\b/i;
        const filtered = videoMatches.filter(v => !garbagePatterns.test(v.title));
        const final = (filtered.length > 0 ? filtered : videoMatches).slice(0, 3);
        console.log(`YouTube HTML scrape found ${final.length} videos: ${final.map(v => v.videoId).join(", ")}`);
        return final;
      }
      console.log("YouTube HTML scrape: got HTML but no video IDs found, falling back to GPT search...");
    } else {
      console.log(`YouTube HTML scrape failed (status ${res.status}), falling back to GPT search...`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.log(`YouTube HTML scrape error: ${msg}, falling back to GPT search...`);
  }

  // ── Method 2: GPT-4o-mini web search (fallback) ──
  const client = openaiClient();
  const langLabel = language === "en" ? "English" : language;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.responses.create({
        model: "gpt-4o-mini",
        tools: [{ type: "web_search_preview" as any }],
        input: [
          {
            role: "system",
            content:
              "You are a research assistant. Search the web for YouTube videos on the given topic. " +
              "Return ONLY real video IDs from actual YouTube URLs you find. " +
              "Pick educational/informational videos only. " +
              "Your entire response must be a single JSON object — nothing else.",
          },
          {
            role: "user",
            content:
              `Search for YouTube videos about "${searchTerm}" (${niche || "general"}).\n` +
              `Find 2-3 real videos in ${langLabel}. Return ONLY this JSON:\n` +
              `{"videos": [{"videoId": "XXXXXXXXXXX", "title": "exact video title"}]}`,
          },
        ],
      });

      const result = parseJson<{ videos: { videoId: string; title: string }[] }>(
        z.object({
          videos: z.array(z.object({ videoId: z.string(), title: z.string() })).default([]),
        }),
        completion.output_text,
      );

      // Extract clean 11-char video IDs (GPT often returns full URLs)
      const extractVideoId = (raw: string): string | null => {
        if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
        const m = raw.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
        return m ? m[1] : null;
      };

      const videos = result.videos
        .map((v) => ({ ...v, videoId: extractVideoId(v.videoId) ?? "" }))
        .filter((v) => v.videoId.length === 11)
        .slice(0, 3);

      if (videos.length > 0) {
        console.log(`YouTube GPT search found ${videos.length} videos: ${videos.map(v => v.videoId).join(", ")}`);
        return videos;
      }
      console.log(`YouTube GPT attempt ${attempt + 1}: no valid videos, retrying...`);
    } catch (parseErr) {
      console.log(`YouTube GPT attempt ${attempt + 1}: JSON parse failed, retrying...`);
    }
  }

  console.log("YouTube search: both methods failed, returning empty.");
  return [];
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
        const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(3000), headers: { "User-Agent": "Mozilla/5.0 (compatible; Pentra/1.0)" } });
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
        const cssRes = await fetch(cssUrl, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "Mozilla/5.0 (compatible; Pentra/1.0)" } });
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
  bannedNames: string[] = [],
) {
  const text = await callClaude(
    "You are a fact-checking editor. Review the article against provided sources and score factual accuracy.\n\n" +
    "CRITICAL RULES:\n" +
    "1. The 'markdown' field MUST contain the FULL article — same article, with only factual corrections applied.\n" +
    "2. Do NOT add fact-check summaries or editorial commentary into the markdown.\n" +
    "3. Do NOT shorten or truncate the article. Return the complete article.\n" +
    "4. NEVER remove product names, brand mentions, CTA links, or product feature descriptions. These are intentional marketing content — they are not factual claims that need verification.\n" +
    "5. ONLY correct external third-party statistics, quotes attributed to real people, and factual data claims.\n" +
    (bannedNames.length > 0 ? `6. BANNED NAMES: The following names must be REMOVED from the article and replaced with generic terms ("your CRM", "popular tools", "other platforms"): ${bannedNames.join(", ")}. Replace every occurrence.\n` : "") +
    "6. For each factual claim you can identify, assess whether it is supported by the provided sources.\n" +
    "7. 'confidenceScore' = overall percentage (0-100) of how well-supported the article's claims are.\n" +
    "   - 90-100: All major claims verified against sources\n" +
    "   - 70-89: Most claims verified, minor gaps\n" +
    "   - 50-69: Several unverifiable claims\n" +
    "   - Below 50: Major factual concerns\n" +
    "8. 'claimCount' = total factual claims found. 'verifiedCount' = claims supported by sources.\n" +
    "9. Output JSON only.",
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
  competitorDomains?: string[],
): Promise<{ researchSummary: string; sources: { url: string; title?: string }[] }> {
  // Web research uses OpenAI's web_search_preview tool (Claude doesn't have built-in web search)
  const client = openaiClient();
  const searchQuery = `${topic.primaryKeyword} ${topic.label} ${siteNiche ?? ""}`.trim();

  const competitorExclusion = competitorDomains?.length
    ? `\n\nCRITICAL: Do NOT include any information about, mentions of, or sources from these competitor companies/domains: ${competitorDomains.join(", ")}. ` +
      `Do NOT research their products, features, pricing, or quote their executives. Focus ONLY on general industry data, statistics, and trends.`
    : "";

  console.log(`Web research: searching for "${searchQuery}"...`);

  const completion = await client.responses.create({
    model: "gpt-4o-mini",
    tools: [{ type: "web_search_preview" as any }],
    input: [
      {
        role: "system",
        content:
          "You are a research assistant. Search the web for current, factual information on the given topic. " +
          "Compile a detailed research brief with key facts, statistics, trends, and expert opinions. " +
          "Include all source URLs you find. Output JSON only." +
          competitorExclusion,
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
  jobId?: Id<"jobs">,
): Promise<{ count: number }> {
  const PLAN_STEPS = 6;
  const reportProgress = async (step: number, label: string) => {
    if (!jobId) return;
    try { await ctx.runMutation(api.jobs.updateProgress, { jobId, current: step, total: PLAN_STEPS, stepLabel: label }); } catch { /* non-critical */ }
  };

  const site = await ctx.runQuery(api.sites.get, { siteId });
  if (!site) throw new Error("Site not found");

  const existingTopics = await ctx.runQuery(api.topics.listBySite, { siteId });
  const existingKeywords = existingTopics.map((t: { primaryKeyword: string }) => t.primaryKeyword);

  await reportProgress(1, "Analyzing site authority...");

  const productName = site.siteName ?? site.domain;
  const locationCode = mapCountryToLocation(site.targetCountry);

  // ══════════════════════════════════════════════════════════════════════
  // STEP 1: Gather all intelligence about this site
  // ══════════════════════════════════════════════════════════════════════

  // 1a. Domain authority — what can this site realistically rank for?
  let domainMetrics: { domainRank: number; organicTraffic: number; backlinks: number; referringDomains: number } | null = null;
  let maxKD = 35;
  try {
    const { getDomainAuthority, computeMaxKD } = await import("./seoData");
    domainMetrics = await getDomainAuthority(site.domain);
    maxKD = computeMaxKD(domainMetrics);
    console.log(domainMetrics
      ? `Domain: DR=${domainMetrics.domainRank}, traffic=${domainMetrics.organicTraffic}/mo → maxKD=${maxKD}`
      : `Domain: no data → maxKD=${maxKD}`);
  } catch (err) { console.log("Domain authority unavailable:", err); }

  const dr = domainMetrics?.domainRank ?? 0;
  const kdWeight = dr >= 50 ? 0.4 : dr >= 20 ? 0.5 : 0.6;

  // 1b. Niche vocabulary — what terms define this business?
  const nicheTerms = new Set<string>();
  const stopList = new Set(["the","and","for","with","how","what","that","this","from","have","will","your","about","more","than","our","are","can","you","its","all","into","also","who","been","very","just","most","many","such","each","other","some","them","not","but"]);
  const extractTerms = (text?: string) => {
    if (!text) return;
    for (const w of text.toLowerCase().replace(/[-_/]/g, " ").split(/\s+/)) {
      const c = w.replace(/[^a-z0-9]/g, "");
      if (c.length >= 3 && !stopList.has(c)) nicheTerms.add(c);
    }
  };
  [site.niche, site.blogTheme, site.siteSummary, site.siteName, site.productUsage].forEach(extractTerms);
  (site.keyFeatures ?? []).forEach((f: string) => extractTerms(f));
  (site.painPoints ?? []).forEach((p: string) => extractTerms(p));
  (site.anchorKeywords ?? []).forEach((k: string) => extractTerms(k));
  extractTerms(site.domain.replace(/\.\w+$/, ""));
  console.log(`Niche vocabulary: ${nicheTerms.size} terms`);

  // 1c. Competitor brands — what names to always block?
  const blockedBrands = new Set<string>();
  for (const c of site.competitors ?? []) {
    const brand = c.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").replace(/\.\w+$/, "").toLowerCase();
    if (brand.length > 2) blockedBrands.add(brand);
  }
  // Well-known SaaS brands — keyword containing these drives traffic to THEM, not the user
  const knownBrands = ["chatgpt","openai","jasper","writesonic","copyai","surfer","semrush","ahrefs","moz","grammarly","hubspot","wordpress","shopify","wix","squarespace","notion","canva","mailchimp","salesforce","zapier","hootsuite","buffer","yoast","clearscope","frase","scalenut","rytr","anyword","peppertype","contentbot"];
  const ownBrand = (site.siteName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const b of knownBrands) {
    if (b !== ownBrand && !ownBrand.includes(b)) blockedBrands.add(b);
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP 2: Discover real keywords from DataForSEO
  // ══════════════════════════════════════════════════════════════════════

  await reportProgress(2, "Discovering high-opportunity keywords...");

  let discoveredKeywords: { keyword: string; searchVolume: number; difficulty: number; cpc: number }[] = [];
  try {
    const { discoverKeywords, findKeywordGaps } = await import("./seoData");

    // Build seed keywords from the full site profile
    const seeds: string[] = [];
    const addSeed = (text: string) => {
      const clean = text.trim().toLowerCase();
      if (clean.length > 3 && clean.split(/\s+/).length <= 4 && !seeds.includes(clean)) seeds.push(clean);
    };
    if (site.niche) for (const p of site.niche.split(/[,;]/)) addSeed(p);
    if (site.anchorKeywords?.length) for (const kw of site.anchorKeywords.slice(0, 5)) addSeed(kw);
    if (site.keyFeatures?.length) for (const f of site.keyFeatures.slice(0, 5)) addSeed(f.split(/[,.:;]/)[0]);
    if (site.painPoints?.length) for (const p of site.painPoints.slice(0, 5)) addSeed(p.split(/[,.:;]/)[0]);
    if (site.blogTheme) for (const p of site.blogTheme.split(/[,;.]/)) addSeed(p);
    if (seeds.length === 0) seeds.push(site.domain.replace(/\.\w+$/, ""));

    // Expand seeds with modifiers for long-tail discovery — cast a WIDE net
    const baseSeedCount = seeds.length;
    const modifiers = ["how to","best","tool","software","guide","strategy","automation","platform","for business","for startups","tips","examples","vs","alternatives","free","services","agency","checklist","template","mistakes"];
    for (const core of seeds.slice(0, 5)) {
      for (const mod of modifiers) {
        const combo = `${core} ${mod}`;
        if (combo.split(/\s+/).length <= 5 && !seeds.includes(combo)) seeds.push(combo);
      }
      if (seeds.length >= 40) break;
    }
    console.log(`Seeds: ${baseSeedCount} base + ${seeds.length - baseSeedCount} expanded = ${seeds.length} total`);

    // Request 700 keywords — we need volume to ensure 10+ survive all filters
    discoveredKeywords = (await discoverKeywords(seeds, locationCode, site.language ?? "en", 700))
      .filter(k => k.searchVolume >= 10)
      .map(k => ({ keyword: k.keyword, searchVolume: k.searchVolume, difficulty: k.difficulty, cpc: k.cpc }));
    console.log(`Discovered ${discoveredKeywords.length} keywords with volume`);

    // Add competitor gap keywords
    if ((site.competitors ?? []).length > 0) {
      try {
        const gaps = await findKeywordGaps(site.domain, site.competitors!, locationCode, site.language ?? "en");
        const seen = new Set(discoveredKeywords.map(k => k.keyword.toLowerCase()));
        let added = 0;
        for (const g of gaps) {
          if (!seen.has(g.keyword.toLowerCase()) && g.searchVolume >= 10) {
            discoveredKeywords.push({ keyword: g.keyword, searchVolume: g.searchVolume, difficulty: g.difficulty, cpc: 0 });
            seen.add(g.keyword.toLowerCase());
            added++;
          }
        }
        if (added > 0) console.log(`Competitor gaps: +${added} keywords`);
      } catch (e) { console.log("Competitor gap analysis failed:", e); }
    }
  } catch (err) { console.log("Keyword discovery unavailable:", err); }

  // ══════════════════════════════════════════════════════════════════════
  // STEP 3: Filter, score, and rank keyword candidates
  // ══════════════════════════════════════════════════════════════════════

  const existingSet = new Set(existingKeywords.map((kw: string) => kw.toLowerCase()));

  // Keyword-level quality filter — only blocks brands (niche relevance left to the AI)
  const isKeywordBlocked = (kw: string): string | null => {
    const kwLower = kw.toLowerCase();
    // Block third-party brand keywords
    for (const brand of blockedBrands) {
      if (kwLower.includes(brand)) return `brand:${brand}`;
    }
    return null;
  };

  // Score each keyword
  const scoreKeyword = (k: { searchVolume: number; difficulty: number; cpc: number }) => {
    const vol = k.searchVolume > 0 ? Math.min(Math.log10(k.searchVolume) * 13, 40) : 0;
    // KD 0 + high volume = genuinely easy, reward it. KD 0 + low volume = uncertain, small penalty.
    const kd = k.difficulty > 0
      ? Math.max(0, (100 - k.difficulty) * kdWeight)
      : (k.searchVolume >= 200 ? 30 : 10); // High-vol KD0 = easy win, low-vol KD0 = uncertain
    const cpc = Math.min(k.cpc * 4, 20);
    return Math.max(0, Math.round(vol + kd + cpc));
  };

  // Dedup helper
  const _stemWord = (w: string) => w.replace(/(tion|sion|ment|ness|ity|ing|ive|ous|ful|less|able|ible|ated|ize|ise)$/, "");
  const _kwStopWords = new Set(["the","and","for","with","how","what","why","are","can","your","that","this","from","have","will","into","more","best","top","free","online","guide","tips","using","about"]);
  const tokenize = (s: string) => s.toLowerCase().replace(/-/g, " ").split(/\s+/).filter(w => w.length > 2 && !_kwStopWords.has(w)).map(_stemWord);
  const isTooSimilar = (a: string, b: string) => {
    const aSet = new Set(tokenize(a));
    const bSet = new Set(tokenize(b));
    if (aSet.size === 0 || bSet.size === 0) return false;
    const overlap = [...aSet].filter(w => bSet.has(w)).length;
    return overlap / Math.min(aSet.size, bSet.size) > 0.5;
  };

  let candidates: { keyword: string; searchVolume: number; difficulty: number; cpc: number; opportunity: number }[] = [];

  if (discoveredKeywords.length >= 10) {
    // Data-first: rank real keywords
    const raw = discoveredKeywords
      .filter(k => !existingSet.has(k.keyword.toLowerCase()))
      .filter(k => k.difficulty <= maxKD + 10 || k.difficulty === 0) // Slightly permissive, quality gate handles the rest
      .filter(k => !isKeywordBlocked(k.keyword))
      .map(k => ({ ...k, opportunity: scoreKeyword(k) }))
      .sort((a, b) => b.opportunity - a.opportunity);

    // Dedup — keep a large pool so AI has plenty to choose from
    for (const kw of raw) {
      if (!candidates.some(c => isTooSimilar(c.keyword, kw.keyword))) {
        candidates.push(kw);
      }
      if (candidates.length >= 80) break;
    }
    console.log(`Candidate pool: ${candidates.length} keywords (from ${discoveredKeywords.length} discovered)`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP 4: AI Topic Generation
  // ══════════════════════════════════════════════════════════════════════

  await reportProgress(3, "AI strategist selecting optimal topics...");

  // Build the comprehensive site context (used for both data-first and AI-first)
  const siteContext = [
    `<business>`,
    `Name: ${productName}`,
    `Domain: ${site.domain}`,
    site.siteType ? `Type: ${site.siteType}` : "",
    site.siteSummary ? `What it does: ${site.siteSummary}` : "",
    site.niche ? `Niche: ${site.niche}` : "",
    site.blogTheme ? `Blog theme: ${site.blogTheme}` : "",
    site.keyFeatures?.length ? `Key features: ${site.keyFeatures.join("; ")}` : "",
    site.pricingInfo ? `Pricing: ${site.pricingInfo}` : "",
    `</business>`,
    ``,
    `<target_audience>`,
    site.targetAudienceSummary ? `Who: ${site.targetAudienceSummary}` : "",
    site.painPoints?.length ? `Pain points: ${site.painPoints.join("; ")}` : "",
    site.productUsage ? `How they use it: ${site.productUsage}` : "",
    site.targetCountry ? `Market: ${site.targetCountry}` : "",
    `</target_audience>`,
    ``,
    `<seo_intelligence>`,
    `Domain Rank: ${dr}/100 (${dr <= 10 ? "new/low authority" : dr <= 30 ? "developing" : dr <= 50 ? "moderate" : "strong"})`,
    domainMetrics ? `Monthly organic traffic: ${domainMetrics.organicTraffic}` : "",
    domainMetrics ? `Backlinks: ${domainMetrics.backlinks} from ${domainMetrics.referringDomains} domains` : "",
    `Max targetable keyword difficulty: ${maxKD}/100`,
    `Strategy: ${dr <= 15
      ? "NEW SITE — target long-tail keywords (3-5 words) with KD under " + maxKD + ". Focus on specific queries where small sites can win: how-to guides, niche comparisons, question-based searches, specific use-case tutorials."
      : dr <= 35
        ? "GROWING SITE — mix of long-tail and medium-competition. Can compete for KD up to " + maxKD + ". Start building topical authority clusters."
        : "ESTABLISHED SITE — target medium-to-high competition keywords. Build pillar content and dominate key topics."}`,
    `</seo_intelligence>`,
  ].filter(Boolean).join("\n");

  let plan: z.infer<typeof PlanSchema>;

  if (candidates.length >= 10) {
    // ── DATA-FIRST: real keywords drive selection ──
    const prompt = [
      `You are an SEO strategist. Your job: select the best keywords from the list below to create a content plan for ${productName}.`,
      ``,
      siteContext,
      ``,
      `<your_task>`,
      `From the keyword list below, select 20-25 that are MOST STRATEGIC for ${productName}. For each, create an article topic. Select MORE than you think we need — our quality filters will narrow it down to the best 10.`,
      ``,
      `SELECTION CRITERIA (in order of importance):`,
      `1. RELEVANCE — Would someone searching this keyword be a potential ${productName} user? If not, SKIP IT.`,
      `2. SEARCH VOLUME — Higher volume = more potential traffic`,
      `3. DIFFICULTY — Lower KD = easier to rank (this site's ceiling is KD ${maxKD})`,
      `4. COMMERCIAL VALUE — Higher CPC signals buyer intent`,
      `5. FUNNEL COVERAGE — Mix TOFU (awareness), MOFU (consideration), BOFU (decision)`,
      ``,
      `HARD RULES:`,
      `- SKIP keywords about other products/brands (ChatGPT, Jasper, Semrush, etc.)`,
      `- SKIP keywords unrelated to ${productName}'s niche — if you can't explain how it connects to the product, don't include it`,
      `- SKIP generic marketing buzzwords that mega-sites dominate ("content marketing best practices", "digital marketing strategy")`,
      `- Each keyword must target a DIFFERENT search intent — no near-duplicates`,
      `- Use the EXACT keyword string from the list as primaryKeyword`,
      site.competitors?.length ? `- NEVER reference these competitors: ${site.competitors.join(", ")}` : "",
      `</your_task>`,
      ``,
      `<keywords>`,
      ...candidates.slice(0, 80).map(k => `- "${k.keyword}" (vol:${k.searchVolume}/mo, KD:${k.difficulty}, CPC:$${k.cpc.toFixed(2)}, score:${k.opportunity})`),
      `</keywords>`,
      ``,
      existingKeywords.length > 0 ? `<already_covered>\n${existingKeywords.map((kw: string) => `- "${kw}"`).join("\n")}\n</already_covered>` : "",
      ``,
      `Return a JSON array. Use EXACT keyword strings as primaryKeyword:`,
      `[{"label":"article title","primaryKeyword":"exact keyword","secondaryKeywords":["kw1","kw2"],"intent":"informational|commercial|transactional","priority":3,"articleType":"standard|listicle|how-to|checklist|comparison|roundup|ultimate-guide","notes":"why this keyword serves ${productName}'s audience"}]`,
      ``,
      `Article types: standard (deep dive), listicle (list-based), how-to (tutorial), checklist (actionable), comparison (X vs Y), roundup (resources), ultimate-guide (5000+ words). Pick what fits the keyword's SERP intent.`,
      site.language && site.language !== "en" ? `Write all labels and keywords in ${site.language}.` : "",
      site.anchorKeywords?.length ? `Priority keywords to incorporate: ${site.anchorKeywords.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const text = await callClaude(prompt, `Select 20-25 strategic keywords and create topics. Use exact keyword strings from the list. We will filter down to the best 10.`, 12000);
    plan = parseJson<z.infer<typeof PlanSchema>>(PlanSchema, text).slice(0, 25);
    console.log(`AI selected ${plan.length} topics from ${candidates.length} candidates`);

    // Snap AI-modified keywords back to exact discovered matches
    // Use candidate list (scored keywords) as primary snap target, then discovered as fallback
    const candidateLower = new Map(candidates.map(k => [k.keyword.toLowerCase(), k.keyword]));
    const discoveredLower = new Map(discoveredKeywords.map(k => [k.keyword.toLowerCase(), k.keyword]));
    for (const topic of plan) {
      const kwLower = topic.primaryKeyword.toLowerCase();
      // Already an exact match in candidates or discovered? Keep it.
      if (candidateLower.has(kwLower) || discoveredLower.has(kwLower)) continue;

      // Fuzzy snap: find best match by word overlap ratio (must be >= 50%)
      const topicWords = new Set(kwLower.split(/\s+/));
      let bestMatch = "", bestScore = 0;
      for (const [cl, orig] of candidateLower) {
        const clWords = new Set(cl.split(/\s+/));
        const overlap = [...topicWords].filter(w => clWords.has(w)).length;
        const score = overlap / Math.max(topicWords.size, clWords.size);
        if (score > bestScore) { bestScore = score; bestMatch = orig; }
      }
      // Also check full discovered pool
      if (bestScore < 0.5) {
        for (const [cl, orig] of discoveredLower) {
          const clWords = new Set(cl.split(/\s+/));
          const overlap = [...topicWords].filter(w => clWords.has(w)).length;
          const score = overlap / Math.max(topicWords.size, clWords.size);
          if (score > bestScore) { bestScore = score; bestMatch = orig; }
        }
      }
      if (bestMatch && bestScore >= 0.5) {
        console.log(`Snap: "${topic.primaryKeyword}" → "${bestMatch}" (${Math.round(bestScore * 100)}%)`);
        topic.primaryKeyword = bestMatch;
      } else {
        console.log(`No snap match for: "${topic.primaryKeyword}" (best: ${Math.round(bestScore * 100)}%)`);
      }
    }
  } else {
    // ── AI-FIRST: no DataForSEO data, let AI generate keywords ──
    const prompt = [
      `You are an SEO strategist creating a content plan for ${productName}.`,
      ``,
      siteContext,
      ``,
      `Generate 15 blog topics. Each must target a REAL search keyword that people actually Google.`,
      ``,
      `RULES:`,
      `1. Keywords must be 2-5 words, natural search queries`,
      `2. Every topic must be relevant to ${productName}'s niche and audience`,
      `3. Max keyword difficulty: ${maxKD} (this is a ${dr <= 15 ? "new" : "growing"} site)`,
      `4. Mix: 40% informational, 30% commercial, 30% transactional`,
      `5. No competitor brand names. No generic buzzwords.`,
      `6. Each keyword targets a DIFFERENT search intent`,
      existingKeywords.length > 0 ? `7. Already covered (skip): ${existingKeywords.join(", ")}` : "",
      site.anchorKeywords?.length ? `Priority keywords: ${site.anchorKeywords.join(", ")}` : "",
      site.language && site.language !== "en" ? `Language: ${site.language}` : "",
      ``,
      `Return JSON array:`,
      `[{"label":"title","primaryKeyword":"search keyword","secondaryKeywords":["kw1","kw2"],"intent":"informational|commercial|transactional","priority":3,"articleType":"standard|listicle|how-to|checklist|comparison|roundup|ultimate-guide","notes":"why"}]`,
    ].filter(Boolean).join("\n");

    const text = await callClaude(prompt, `Generate 15 strategic topics for ${productName}. Real keywords only.`, 8192);
    plan = parseJson<z.infer<typeof PlanSchema>>(PlanSchema, text).slice(0, 15);
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP 5: Programmatic quality enforcement
  // ══════════════════════════════════════════════════════════════════════

  await reportProgress(4, "Validating keywords with real data...");

  // 5a. Dedup
  const deduped: typeof plan = [];
  for (const topic of plan) {
    if (deduped.some(k => k.primaryKeyword.toLowerCase() === topic.primaryKeyword.toLowerCase() || isTooSimilar(k.primaryKeyword, topic.primaryKeyword))) {
      console.log(`Dedup: "${topic.primaryKeyword}"`);
      continue;
    }
    deduped.push(topic);
  }
  plan = deduped;
  console.log(`After dedup: ${plan.length} topics`);

  // 5b. Build metrics from candidates (which already have real data) + fetch fresh for any unknowns
  try {
    const { getKeywordMetrics, analyzeSERP } = await import("./seoData");

    // Build a comprehensive metrics map from ALL discovered keywords (not just candidates)
    const candidateMap = new Map(candidates.map(k => [k.keyword.toLowerCase(), k]));
    const discoveredMap = new Map(discoveredKeywords.map(k => [k.keyword.toLowerCase(), k]));

    type Metric = { keyword: string; searchVolume: number; difficulty: number; cpc: number; competition: number; intent: string; trend: number[] };
    const metricsMap = new Map<string, Metric>();

    // Pre-populate from discovered keywords (broadest source)
    for (const k of discoveredKeywords) {
      metricsMap.set(k.keyword.toLowerCase(), { keyword: k.keyword, searchVolume: k.searchVolume, difficulty: k.difficulty, cpc: k.cpc, competition: 0, intent: "informational", trend: [] });
    }

    // Find keywords that aren't in our discovered pool at all
    const needFresh = plan
      .map(t => t.primaryKeyword)
      .filter(kw => !metricsMap.has(kw.toLowerCase()));

    if (needFresh.length > 0) {
      console.log(`Fetching fresh metrics for ${needFresh.length} unknown keywords: ${needFresh.join(", ")}`);
      try {
        const fresh = await getKeywordMetrics(needFresh, locationCode, site.language ?? "en");
        for (const m of fresh) metricsMap.set(m.keyword.toLowerCase(), m);
      } catch (e) { console.log("Fresh metrics fetch failed:", e); }
    }

    // Fuzzy matcher: if exact match fails, find closest candidate by word overlap
    const findMetrics = (kw: string): Metric | null => {
      const exact = metricsMap.get(kw.toLowerCase());
      if (exact) return exact;

      // Fuzzy: find best overlap match in discovered keywords
      const words = new Set(kw.toLowerCase().split(/\s+/));
      let bestMatch: Metric | null = null, bestScore = 0;
      for (const [key, m] of metricsMap) {
        const mWords = new Set(key.split(/\s+/));
        const overlap = [...words].filter(w => mWords.has(w)).length;
        const score = overlap / Math.max(words.size, mWords.size);
        if (score > bestScore && score >= 0.5) { // At least 50% word overlap
          bestScore = score;
          bestMatch = m;
        }
      }
      if (bestMatch) {
        console.log(`Fuzzy match: "${kw}" → "${bestMatch.keyword}" (${Math.round(bestScore * 100)}% overlap)`);
      }
      return bestMatch;
    };

    // 5c. Quality gate — single pass, clean logic
    const enrichedPlan: (typeof plan[0] & {
      searchVolume?: number; keywordDifficulty?: number; cpc?: number;
      serpIntent?: string; volumeTrend?: number[]; recommendedArticleType?: string; paaQuestions?: string[];
    })[] = [];
    let kd0Count = 0;
    let noDataCount = 0;

    for (const topic of plan) {
      const kw = topic.primaryKeyword.toLowerCase();

      // Brand check
      const brandBlock = isKeywordBlocked(topic.primaryKeyword);
      if (brandBlock) {
        console.log(`Blocked: "${topic.primaryKeyword}" (${brandBlock})`);
        continue;
      }

      const m = findMetrics(topic.primaryKeyword);
      if (!m) {
        // No data even after fuzzy match — keep up to 3 (AI thinks they're relevant, just no DataForSEO data)
        noDataCount++;
        if (noDataCount > 3) {
          console.log(`Blocked: "${topic.primaryKeyword}" (no metrics data, cap reached)`);
          continue;
        }
        console.log(`⚠ "${topic.primaryKeyword}": no metrics data, keeping (${noDataCount}/3 no-data slots)`);
        enrichedPlan.push(topic);
        continue;
      }

      // Hard kills
      if (m.searchVolume === 0 && m.difficulty === 0 && m.cpc === 0) {
        console.log(`Blocked: "${topic.primaryKeyword}" (no search data)`);
        continue;
      }

      // KD ceiling — allow up to maxKD+10 if volume justifies it (>1000/mo), strict maxKD otherwise
      const effectiveMaxKD = m.searchVolume >= 1000 ? maxKD + 10 : maxKD;
      if (m.difficulty > effectiveMaxKD) {
        console.log(`Blocked: "${topic.primaryKeyword}" (KD ${m.difficulty} > ${effectiveMaxKD})`);
        continue;
      }

      // KD 0 with low volume = speculative keyword (cap at 3)
      // KD 0 with high volume = genuinely easy keyword (always allow)
      if (m.difficulty === 0 && m.searchVolume < 200) {
        kd0Count++;
        if (kd0Count > 3) {
          console.log(`Blocked: "${topic.primaryKeyword}" (KD0+low-vol cap: ${kd0Count}th speculative keyword)`);
          continue;
        }
      }

      // Score it
      const opportunity = scoreKeyword(m);
      const priority = opportunity >= 70 ? 5 : opportunity >= 55 ? 4 : opportunity >= 40 ? 3 : opportunity >= 20 ? 2 : 1;

      enrichedPlan.push({
        ...topic,
        priority,
        searchVolume: m.searchVolume,
        keywordDifficulty: m.difficulty,
        cpc: m.cpc,
        serpIntent: m.intent,
        volumeTrend: m.trend.length > 0 ? m.trend : undefined,
      });
      console.log(`✓ "${topic.primaryKeyword}": opp=${opportunity}, KD=${m.difficulty}, vol=${m.searchVolume}, pri=${priority}`);
    }

    console.log(`Quality gate: ${plan.length} → ${enrichedPlan.length} topics`);

    // 5d. SERP analysis — determine optimal article format for each surviving topic
    await reportProgress(5, "Analyzing SERPs for article format optimization...");
    for (const topic of enrichedPlan) {
      try {
        const serp = await analyzeSERP(topic.primaryKeyword, locationCode, site.language ?? "en");
        topic.recommendedArticleType = serp.recommendedArticleType;
        topic.articleType = serp.recommendedArticleType as any;
        topic.paaQuestions = serp.paaQuestions.length > 0 ? serp.paaQuestions : undefined;
        console.log(`SERP: "${topic.primaryKeyword}" → ${serp.recommendedArticleType} (${serp.paaQuestions.length} PAA)`);
      } catch (e) { console.error(`SERP failed for "${topic.primaryKeyword}":`, e); }
    }

    // ══════════════════════════════════════════════════════════════════════
    // STEP 6: Save fully enriched topics to DB (ONE atomic save — no half-baked topics)
    // ══════════════════════════════════════════════════════════════════════

    plan = enrichedPlan.slice(0, 10);
    await ctx.runMutation(api.topics.upsertMany, { siteId, topics: plan });
    console.log(`Saved ${plan.length} fully-enriched topics`);
  } catch (err) {
    console.error(`SEO enrichment failed, saving raw topics:`, err instanceof Error ? err.message : err);
    plan = plan.slice(0, 10);
    await ctx.runMutation(api.topics.upsertMany, { siteId, topics: plan });
  }

  await reportProgress(6, "Content strategy ready!");
  return { count: plan.length };
}

async function handleArticle(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  topicId?: Id<"topic_clusters">,
  options?: RichMediaOptions,
  jobId?: Id<"jobs">,
): Promise<{ articleId: Id<"articles"> }> {
  const TOTAL_STEPS = 11;
  const site = await ctx.runQuery(api.sites.get, { siteId });
  const topic = topicId
    ? await ctx.runQuery(api.topics.get, { topicId })
    : null;

  const reportProgress = async (step: number, label: string) => {
    if (!jobId) return;
    try {
      await ctx.runMutation(api.jobs.updateProgress, {
        jobId,
        current: step,
        total: TOTAL_STEPS,
        stepLabel: label,
        topicLabel: topic?.label,
      });
    } catch {
      // Never break pipeline for progress reporting
    }
  };
  if (!site) throw new Error("Site not found");
  if (topicId && !topic) throw new Error("Topic not found");

  // ── Step 0: SERP Analysis + Article Type Selection (graceful degradation) ──
  let serpPaaQuestions: string[] = [];
  let serpDifficulty: string | undefined;
  let serpRecommendedType: string | undefined;

  if (topic) {
    await reportProgress(1, "Analyzing search results...");
    try {
      // Use cached PAA questions from topic if available, otherwise run fresh analysis
      if ((topic as any).paaQuestions?.length > 0) {
        serpPaaQuestions = (topic as any).paaQuestions;
        serpRecommendedType = (topic as any).recommendedArticleType;
        console.log(`Using cached SERP data: type=${serpRecommendedType}, PAA=${serpPaaQuestions.length}`);
      } else {
        const { analyzeSERP } = await import("./seoData");
        const locationCode = mapCountryToLocation(site.targetCountry);
        const serpAnalysis = await analyzeSERP(topic.primaryKeyword, locationCode, site.language ?? "en");
        serpPaaQuestions = serpAnalysis.paaQuestions;
        serpDifficulty = serpAnalysis.difficulty;
        serpRecommendedType = serpAnalysis.recommendedArticleType;
        console.log(`SERP analysis: format=${serpAnalysis.dominantFormat}, type=${serpRecommendedType}, PAA=${serpPaaQuestions.length}, difficulty=${serpDifficulty}`);

        // Save SERP data back to topic for future reference
        if (topicId) {
          try {
            await ctx.runMutation(api.topics.updateSEOMetrics, {
              topicId,
              recommendedArticleType: serpRecommendedType,
              paaQuestions: serpPaaQuestions.length > 0 ? serpPaaQuestions : undefined,
            });
          } catch { /* non-critical */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`SERP analysis failed (continuing with default type): ${msg}`);
    }
  }

  // Override article type if SERP analysis found a better format
  // Only override if the topic doesn't already have a manually-set type
  const effectiveArticleType = serpRecommendedType && (!topic?.articleType || topic.articleType === "standard")
    ? serpRecommendedType
    : (topic?.articleType ?? "standard");

  // ── Step 1: Web Research (graceful degradation) ──
  await reportProgress(2, "Researching the web...");
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
        site.competitors ?? undefined,
      );
      researchContext = research.researchSummary;
      researchSources = research.sources;

      // Post-process: filter out competitor sources and scrub competitor mentions
      if (site.competitors?.length) {
        const compDomains = site.competitors.map((c) => c.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase());
        const compNames = compDomains.map((d) => d.replace(/\.com$|\.io$|\.co$/, ""));

        // Filter out sources from competitor domains
        const beforeCount = researchSources.length;
        researchSources = researchSources.filter((s) => {
          const urlLower = s.url.toLowerCase();
          return !compDomains.some((d) => urlLower.includes(d));
        });
        if (researchSources.length < beforeCount) {
          console.log(`Filtered ${beforeCount - researchSources.length} competitor sources from research.`);
        }

        // Scrub competitor company names from research summary
        for (const name of compNames) {
          const regex = new RegExp(`\\b${name}\\b`, "gi");
          researchContext = researchContext.replace(regex, "[competitor]");
        }
      }

      console.log(`Research gathered: ${researchContext.length} chars, ${researchSources.length} sources`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`Web research failed (continuing without): ${msg}`);
    }
  }

  // ── Step 1b: YouTube Video Search (graceful degradation) ──
  await reportProgress(3, "Searching YouTube videos...");
  let youtubeVideos: { videoId: string; title: string }[] = [];
  const enableYouTube = site.youtubeEmbeds !== false;

  if (enableYouTube && topic) {
    try {
      youtubeVideos = await searchYouTubeVideos(
        topic.label,
        topic.primaryKeyword ?? "",
        site.niche ?? "",
        site.language ?? "en",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`YouTube search failed (continuing without): ${msg}`);
    }
  }

  // ── Step 1c: Screenshot Capture (graceful degradation) ──
  await reportProgress(4, "Capturing site screenshot...");
  let screenshotUrl: string | undefined;

  try {
    screenshotUrl = await captureScreenshot(ctx, site.domain);
    console.log(`Site screenshot captured: ${screenshotUrl}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`Screenshot capture failed (continuing without): ${msg}`);
  }

  // ── Step 1d: Web Image Search (graceful degradation) ──
  await reportProgress(5, "Searching for images...");
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
  await reportProgress(6, "Crawling site data...");
  let siteData = { pricing: "", features: "", homepage: "" };

  try {
    siteData = await crawlSiteData(site.domain);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`Site data crawl failed (continuing without): ${msg}`);
  }

  // ── Step 2: Generate Article (with full site context + real media) ──
  await reportProgress(7, "Writing article content...");
  console.log(`Generating article for topic: ${topic?.label ?? "General"}`);

  // Old block-building code removed — all context is now in the structured XML system prompt above

  const productName = site.siteName ?? site.domain;

  // ── Build existing article keywords for anti-cannibalization ──
  const existingArticles = await ctx.runQuery(api.articles.listBySite, { siteId });
  const existingArticleKeywords = existingArticles
    .filter((a: any) => a.metaKeywords?.length)
    .map((a: any) => ({ title: a.title, keywords: a.metaKeywords }));
  const existingKwSummary = existingArticleKeywords.length > 0
    ? existingArticleKeywords.map((a: any) => a.keywords.join(", ")).join("; ")
    : "";

    // ── Build structured system prompt with XML tags ──
  // Every section is a binding contract. The AI must follow ALL of it.

  const competitorNames = (site.competitors ?? []).map((c: string) =>
    c.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\.com$|\.io$|\.co$|\.org$|\.net$/, ""),
  );

  const systemPrompt = [
    `<role>`,
    `You are the in-house content marketer at ${productName}. You write for ${productName}'s blog.`,
    `You know this product inside out. You write like an employee, not a freelancer.`,
    `Every article you write positions ${productName} as THE solution to the reader's problem.`,
    `</role>`,
    ``,
    `<banned_content>`,
    `The following names are ABSOLUTELY BANNED from appearing anywhere in the article — not as competitors, not as CRM examples, not as integration examples, not in any context whatsoever. Use generic terms like "your CRM", "popular CRM platforms", "sales tools" instead:`,
    ...(site.competitors ?? []).map((c: string) => `- ${c}`),
    ...(competitorNames.length > 0 ? [`- Also banned by name: ${competitorNames.join(", ")}`] : []),
    `If you need to reference ANY tool/platform/service, use generic descriptions ("your CRM", "email platform", "popular tools") — NEVER use any of the banned names above in ANY context.`,
    `Do NOT write "N best tools" articles that list competitors. The article must position ${productName} as the primary solution.`,
    `</banned_content>`,
    ``,
    `<product_identity>`,
    `Name: ${productName}`,
    `Domain: ${site.domain}`,
    `Type: ${site.siteType ?? "Website"}`,
    `Summary: ${site.siteSummary ?? ""}`,
    `Blog Theme: ${site.blogTheme ?? ""}`,
    site.keyFeatures?.length ? `Key Features:\n${site.keyFeatures.map((f: string) => `- ${f}`).join("\n")}` : "",
    site.pricingInfo ? `Pricing:\n${site.pricingInfo}` : "",
    site.founders ? `Founders: ${site.founders}` : "",
    `Niche: ${site.niche ?? ""}`,
    ``,
    `When mentioning ${productName}'s features, pricing, or capabilities, use ONLY the information above.`,
    `NEVER fabricate features, integrations, or pricing tiers that are not listed here.`,
    `If live crawled data is provided in the user message, prefer that for pricing/features as it may be more current.`,
    `</product_identity>`,
    ``,
    `<target_audience>`,
    site.targetAudienceSummary ? `Who they are: ${site.targetAudienceSummary}` : "",
    site.painPoints?.length ? `Pain points this product solves:\n${site.painPoints.map((p: string) => `- ${p}`).join("\n")}` : "",
    site.productUsage ? `How they use the product: ${site.productUsage}` : "",
    site.targetCountry ? `Target market: ${site.targetCountry} — tailor examples, stats, and references to this market.` : "",
    `Write every article FOR this audience. Address their specific problems. Use their language.`,
    `</target_audience>`,
    ``,
    `<content_settings>`,
    `Tone: ${site.tone ?? "professional"} — maintain this tone throughout the entire article.`,
    site.language && site.language !== "en" ? `Language: Write the ENTIRE article in ${site.language}. All headings, body text, FAQ, key takeaways, and meta fields must be in ${site.language}.` : `Language: English`,
    (() => {
      const ctaLabel = site.ctaText || `Try ${productName}`;
      const ctaLink = site.ctaUrl || `https://${site.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
      const color = site.brandPrimaryColor ?? "#0EA5E9";
      const tagline = site.siteSummary ? site.siteSummary.split(".")[0] + "." : `Get started with ${productName} today.`;
      return [
        `CTA: Naturally weave in "${ctaLabel}" linking to ${ctaLink} once in the body (organic, not salesy).`,
        `STYLED CTA BOX: At the very end of the article (after Sources), include this exact HTML CTA box:`,
        `<div style="margin:2.5em 0 1em;padding:1.5em 2em;border-radius:12px;background:linear-gradient(135deg,${color}15,${color}08);border:1px solid ${color}30;text-align:center;">`,
        `<p style="font-size:1.2em;font-weight:700;margin:0 0 0.4em;color:${color};">${ctaLabel}</p>`,
        `<p style="margin:0 0 1em;color:#555;font-size:0.95em;">${tagline}</p>`,
        `<a href="${ctaLink}" style="display:inline-block;padding:0.7em 2em;border-radius:8px;background:${color};color:#fff;font-weight:600;text-decoration:none;font-size:0.95em;">${ctaLabel} →</a>`,
        `</div>`,
        `Copy this HTML exactly at the very end. Do not modify the styles or structure.`,
      ].join("\n");
    })(),
    site.anchorKeywords?.length ? `Anchor Keywords: Naturally incorporate these throughout: ${site.anchorKeywords.join(", ")}` : "",
    site.sourceCitations !== false
      ? `Citations: Use numbered inline citations [1], [2], [3] for statistics, quotes, and factual claims. Add a "## Sources" section at the end listing each as: [1] Title — URL`
      : `Citations: Do NOT add inline citations or a sources section.`,
    site.externalLinking !== false
      ? `External Links: Include 5-10 outbound links to authoritative sources naturally within the text.`
      : `External Links: Do NOT include external links in the article body.`,
    `</content_settings>`,
    ``,
    `<youtube_embeds>`,
    enableYouTube && youtubeVideos.length > 0
      ? [
          `YouTube embedding is ENABLED. You have ${youtubeVideos.length} real YouTube video(s) available.`,
          `Include at least 1-2 of these videos in the article. Place each video AFTER the section it relates to most. Choose the most relevant videos for the article's topic.`,
          `Use this exact HTML for each embed:`,
          ...youtubeVideos.map((v) =>
            `Video "${v.title}":\n<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:1.5em 0;border-radius:8px;"><iframe src="https://www.youtube.com/embed/${v.videoId}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen></iframe></div>`
          ),
          `Copy the HTML exactly. Do not modify the iframe code. Do NOT skip all videos — include the best 1-2.`,
        ].join("\n")
      : enableYouTube
        ? `YouTube embedding is ENABLED but no videos were found for this topic. Skip YouTube embeds.`
        : `YouTube embedding is DISABLED. Do NOT include any YouTube embeds.`,
    `</youtube_embeds>`,
    ``,
    `<images>`,
    `Note: A product screenshot will be automatically added to the product section by the system. Do NOT add any screenshot yourself.`,
    webImages.length > 0
      ? `Web Infographics/Charts (REAL — found on the web):\n${webImages.map((img) => `- ![${img.alt}](${img.url})\n  Caption: *Source: ${img.source}*`).join("\n")}\nInclude at least 2-3 of these images throughout the article to break up text and add visual context. Place each after the section it relates to. Add italic captions below each image.`
      : `No web images available.`,
    `</images>`,
    ``,
    `<article_structure>`,
    // Use type-specific structure if the topic has an articleType set
    (() => {
      const articleType = (effectiveArticleType ?? "standard") as ArticleType;
      const typeStructure = getArticleTypeStructure(articleType, productName);
      if (typeStructure) return typeStructure;
      // Default standard structure
      return [
        `REQUIRED CONTENT ORDER (follow this sequence exactly):`,
        `1. HOOK: Open with a compelling statistic or data point from the research. NEVER start with a generic statement. Briefly introduce ${productName} as a solution worth exploring.`,
        `2. TL;DR: After the hook, include a "> **TL;DR:** ..." blockquote (2-3 sentences).`,
        `3. TABLE OF CONTENTS: "## Table of Contents" with bullet list linking to each H2 using markdown anchors.`,
        `4. SECTIONS 1-2: First two H2 sections covering background/context of the topic.`,
        `   [An infographic will be automatically injected here by the system — do NOT add it yourself]`,
        `5. SECTIONS 3-5: Middle H2 sections covering the main how-to or strategy content.`,
        `   YouTube embed goes HERE — place it after the section it relates to most.`,
        `6. PRODUCT SECTION (MANDATORY — DO NOT SKIP): Create a dedicated H2 section with the EXACT title "How ${productName} Helps With [Topic]".
        CRITICAL RULES FOR THIS SECTION:
        - The H2 heading MUST contain the exact word "${productName}" — not a generic term, not "your tool", not paraphrased
        - Be 300-500 words explaining how ${productName} specifically solves the problems discussed
        - A product screenshot will be automatically injected by the system — do NOT add one yourself
        - Mention specific ${productName} features from the product identity
        - Link to ${productName}'s website
        BRAND NAME RULE: Use the EXACT name "${productName}" at least 15-20 times throughout the ENTIRE article. NEVER replace "${productName}" with generic terms like "the tool", "the platform", "your solution", "this software", "your CRM", "the product", or similar. The word "${productName}" must appear in:
        - The article title or first paragraph
        - At least 3 H2/H3 headings
        - The product section heading (MANDATORY: "How ${productName} Helps With...")
        - The TL;DR
        - The Key Takeaways
        - The FAQ section (at least 2 questions should mention ${productName} by name)
        If you catch yourself writing a generic term instead of "${productName}", STOP and replace it with "${productName}".`,
        `7. COMPARISON TABLE: At least one markdown table with real data. Compare approaches/categories (NOT named competitors).`,
        `8. PRO TIPS or BEST PRACTICES: Numbered actionable items.`,
        `9. EXPERT QUOTES: 2-3 blockquotes from real experts. Format: > *"Quote."* — **Name**, Title, Company [citation]. NEVER fabricate quotes.`,
        `10. FAQ: "## Frequently Asked Questions" with 8-10 questions. Format: ### Question?\n Answer paragraph.`,
        `11. KEY TAKEAWAYS: "## Key Takeaways" with 5-7 bullet points.`,
        `12. SOURCES: "## Sources" section with numbered citation links.`,
        `13. STYLED CTA BOX: Place the HTML CTA box last, after Sources.`,
      ].join("\n");
    })(),
    ``,
    existingKwSummary ? `<anti_cannibalization>\nThese keywords are already targeted by existing articles on this blog. Your article MUST target DIFFERENT keywords and angles:\n${existingKwSummary}\nDo NOT repeat these keywords in your metaKeywords output. Focus on unique long-tail variations.\n</anti_cannibalization>` : "",
    ``,
    `<serp_intelligence>`,
    `FEATURED SNIPPET OPTIMIZATION:`,
    `- After each H2 heading, include a concise 40-50 word "snippet-ready" paragraph that directly answers the heading's question.`,
    `- Use an objective, dictionary-style tone for these answer paragraphs (Google extracts these for featured snippets).`,
    `- For list-based sections, use clean numbered or bulleted lists that Google can extract directly.`,
    `- For data comparisons, use clean markdown tables with keyword-rich column headers.`,
    ``,
    `AI OVERVIEW OPTIMIZATION:`,
    `- Google's AI Overviews cite content with clear, authoritative, direct answers. Structure content to be "citation-worthy."`,
    `- Lead each major section with a definitive 1-2 sentence answer BEFORE expanding with detail. AI Overviews extract these lead-in answers.`,
    `- Use "What is X", "How does X work", "Why is X important" patterns in H2s — these match AI Overview trigger queries.`,
    `- Include specific numbers, percentages, and year-dated statistics (e.g. "As of 2026, 65% of..."). AI Overviews prefer quantified claims.`,
    `- Add comparison tables and structured data — AI Overviews frequently pull from tables and lists.`,
    `- Cite authoritative sources inline (not just in a Sources section). AI Overviews prefer content that references credible data.`,
    `- Target long-tail question variants in subheadings — AI Overviews appear less on long-tail queries, so organic clicks are higher there.`,
    ``,
    `ENTITY OPTIMIZATION:`,
    `- Mention the primary keyword and key entities within the first 100 words of the article.`,
    `- Each H2 heading should contain a relevant entity or keyword variation.`,
    `- Maintain natural keyword frequency throughout — aim for the primary keyword every 200-300 words.`,
    `- Include semantically related terms and synonyms, not just exact-match keywords.`,
    `- Reference real people, companies, tools, and concepts by name (entities Google's Knowledge Graph recognizes).`,
    ``,
    serpPaaQuestions.length > 0
      ? [
          `PEOPLE ALSO ASK (from real Google SERP):`,
          `These are REAL questions people are asking on Google for this topic. Include ALL of them in your FAQ section (add more of your own too):`,
          ...serpPaaQuestions.map((q, i) => `${i + 1}. ${q}`),
          `Format each as: ### ${serpPaaQuestions[0] ?? "Question?"}\nDirect answer paragraph (40-60 words) followed by more detail.`,
        ].join("\n")
      : `Include 8-10 FAQ questions. Start each with an H3 heading and a direct 40-60 word answer.`,
    ``,
    serpDifficulty
      ? `SERP DIFFICULTY: ${serpDifficulty}. ${serpDifficulty === "hard" || serpDifficulty === "very_hard" ? "This is a competitive keyword. Make the content exceptionally comprehensive, data-rich, and authoritative to compete." : "This keyword has reasonable competition. Focus on depth and unique value."}`
      : "",
    `</serp_intelligence>`,
    ``,
    `GLOBAL RULES:`,
    `- WORD COUNT: ${((topic as any)?.articleType === "ultimate-guide") ? "5000-7000" : "3500-4500"} words.`,
    `- NO FLUFF: Every paragraph must contain specific data, examples, or actionable advice.`,
    `- NO META-TALK: Output article content only. No explanations outside the JSON.`,
    `- Site screenshot (if provided in <images>) goes ONLY in the ${productName} product section — nowhere else.`,
    `</article_structure>`,
    ``,
    `<output_format>`,
    `Output a single JSON object (no markdown code blocks around it):`,
    `{`,
    `  "title": "string",`,
    `  "slug": "string",`,
    `  "markdown": "string (the full 3500-4500 word article)",`,
    `  "metaTitle": "string (max 60 chars, include primary keyword)",`,
    `  "metaDescription": "string (max 155 chars, compelling + keyword)",`,
    `  "metaKeywords": ["keyword1", ...] (8-12 SEO keywords),`,
    `  "sources": [{"url": "string", "title": "string"}]`,
    `}`,
    `</output_format>`,
  ].filter(Boolean).join("\n");

  // ── Build structured user message ──
  const userMessage = [
    `<topic>`,
    `Title: ${topic?.label ?? "General"}`,
    `Primary Keyword: ${topic?.primaryKeyword ?? ""}`,
    `Secondary Keywords: ${topic?.secondaryKeywords?.join(", ") ?? "none"}`,
    `Search Intent: ${topic?.intent ?? "informational"}`,
    `</topic>`,
    ``,
    researchContext ? [
      `<research>`,
      researchContext,
      `</research>`,
    ].join("\n") : "",
    ``,
    siteData.pricing || siteData.features ? [
      `<live_crawled_data>`,
      `This data was crawled directly from ${site.domain} moments ago. Use it for accurate pricing and feature information.`,
      siteData.pricing ? `\n--- PRICING PAGE ---\n${siteData.pricing.slice(0, 3000)}` : "",
      siteData.features ? `\n--- FEATURES PAGE ---\n${siteData.features.slice(0, 3000)}` : "",
      `</live_crawled_data>`,
    ].join("\n") : "",
    ``,
    `Write the article now. Follow every instruction in the system prompt exactly.`,
  ].filter(Boolean).join("\n");

  const articleText = await callClaude(
    systemPrompt,
    userMessage,
    16384,
  );

  const article = parseJson<z.infer<typeof ArticleSchema>>(
    ArticleSchema,
    articleText,
  );

  // ── Programmatic competitor scrub (safety net) ──
  // Even with prompt instructions, LLMs sometimes mention competitors.
  // This is a hard programmatic filter — no competitor name survives this.
  if (site.competitors?.length) {
    const compDomains = site.competitors.map((c: string) =>
      c.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase(),
    );
    const compNames = compDomains.map((d: string) =>
      d.replace(/\.com$|\.io$|\.co$|\.org$|\.net$/, ""),
    );

    // Scrub competitor names from article markdown
    let scrubbed = article.markdown;
    for (const name of compNames) {
      if (name.length < 3) continue; // skip very short names to avoid false positives
      const regex = new RegExp(`\\b${name}\\b`, "gi");
      scrubbed = scrubbed.replace(regex, productName);
    }
    if (scrubbed !== article.markdown) {
      console.log(`Competitor scrub: replaced competitor mentions with ${productName} in article markdown.`);
      article.markdown = scrubbed;
    }

    // Scrub from title too
    let scrubbedTitle = article.title;
    for (const name of compNames) {
      if (name.length < 3) continue;
      const regex = new RegExp(`\\b${name}\\b`, "gi");
      scrubbedTitle = scrubbedTitle.replace(regex, productName);
    }
    article.title = scrubbedTitle;
  }

  // Merge research sources with article-generated sources (deduplicate by URL)
  const allSources = [...(article.sources ?? []), ...researchSources];
  const seenUrls = new Set<string>();
  const compDomainsForFilter = (site.competitors ?? []).map((c: string) =>
    c.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase(),
  );
  const dedupedSources = allSources.filter((s) => {
    if (seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    // Filter out any sources from competitor domains
    if (compDomainsForFilter.length > 0) {
      const urlLower = s.url.toLowerCase();
      if (compDomainsForFilter.some((d: string) => urlLower.includes(d))) return false;
    }
    return true;
  });

  // ── Step 3: Fact Check (graceful degradation) ──
  await reportProgress(8, "Fact-checking claims...");
  let finalMarkdown = article.markdown;
  let finalSources = dedupedSources;
  let factCheckScore: number | undefined;
  let factCheckNotes: string | undefined;

  try {
    console.log("Running fact check...");
    const allBannedNames = [
      ...(site.competitors ?? []),
      ...(site.competitors ?? []).map((c: string) => c.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\.com$|\.io$|\.co$|\.org$|\.net$/, "")),
    ];
    const reviewed = await factCheckArticle(finalMarkdown, dedupedSources, allBannedNames);
    finalMarkdown = reviewed.markdown;
    if (reviewed.citations?.length) {
      const additionalSources = reviewed.citations.filter(
        (c) => !seenUrls.has(c.url),
      );
      finalSources = [...dedupedSources, ...additionalSources];
    }
    // Programmatic competitor name scrub (belt-and-suspenders)
    const scrubNames = [...new Set(allBannedNames.filter(n => n.length > 2))];
    for (const name of scrubNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, "gi");
      const before = reviewed.markdown;
      reviewed.markdown = reviewed.markdown.replace(re, "popular tools");
      if (reviewed.markdown !== before) {
        console.log("Scrubbed banned name from article: " + name);
      }
    }
    finalMarkdown = reviewed.markdown;
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

  // ── Step 4: Featured Image (hero) + Mid-article Infographic ──
  // Hero: wide 16:9 abstract data visualization shown at top of article
  // Infographic: tall 2:3 process/stats diagram injected after the 3rd H2 section
  await reportProgress(9, "Generating images...");
  let featuredImage: string | undefined;
  let infographicUrl: string | undefined;

  // Try hero image up to 2 times — OpenAI image gen can be flaky
  for (let heroAttempt = 0; heroAttempt < 2; heroAttempt++) {
    try {
      featuredImage = await generateHeroImage(
        ctx,
        article.title,
        site.niche ?? "",
        site.imageBrandingPrompt ?? undefined,
        site.brandPrimaryColor ?? undefined,
      );
      console.log(`Hero image generated: ${featuredImage}`);
      break; // Success
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error(`Hero image attempt ${heroAttempt + 1} failed: ${msg}`);
      if (heroAttempt === 1) {
        // Final attempt failed — fall back to screenshot if available
        if (screenshotUrl) {
          featuredImage = screenshotUrl;
          console.log("Using site screenshot as hero image fallback.");
        } else {
          featuredImage = undefined;
        }
      }
    }
  }

  try {
    infographicUrl = await generateInfographic(
      ctx,
      article.title,
      topic?.primaryKeyword ?? article.title,
      site.niche ?? "",
      site.brandPrimaryColor ?? undefined,
    );
    console.log(`Mid-article infographic generated: ${infographicUrl}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`Infographic generation failed (skipping): ${msg}`);
    infographicUrl = undefined;
  }

  // Inject infographic after the 3rd H2 section in the article body
  if (infographicUrl) {
    const h2Regex = /^## /gm;
    let matchCount = 0;
    let insertIndex = -1;
    let match: RegExpExecArray | null;
    while ((match = h2Regex.exec(finalMarkdown)) !== null) {
      matchCount++;
      if (matchCount === 3) {
        insertIndex = match.index;
        break;
      }
    }
    if (insertIndex !== -1) {
      const infographicMd = `\n![${article.title} infographic](${infographicUrl})\n*Process overview for ${topic?.primaryKeyword ?? article.title}*\n\n`;
      finalMarkdown = finalMarkdown.slice(0, insertIndex) + infographicMd + finalMarkdown.slice(insertIndex);
      console.log("Infographic injected after 3rd H2 section.");
    }
  }

  // ── Step 4b: Programmatic YouTube Video Injection ──
  // Claude often ignores YouTube embed instructions, so we inject them ourselves
  if (youtubeVideos.length > 0) {
    const hasYouTube = finalMarkdown.includes("youtube.com/embed/");
    if (!hasYouTube) {
      console.log(`Claude skipped YouTube embeds. Injecting ${Math.min(youtubeVideos.length, 2)} video(s) programmatically...`);
      // Find a good insertion point: after the 4th or 5th H2 (middle of article)
      const h2Regex = /^## /gm;
      let h2Count = 0;
      let youtubeInsertIndex = -1;
      let h2Match: RegExpExecArray | null;
      while ((h2Match = h2Regex.exec(finalMarkdown)) !== null) {
        h2Count++;
        if (h2Count === 5) {
          youtubeInsertIndex = h2Match.index;
          break;
        }
      }
      // Fallback: if fewer than 5 H2s, insert before the last H2
      if (youtubeInsertIndex === -1 && h2Count >= 2) {
        const allH2 = [...finalMarkdown.matchAll(/^## /gm)];
        youtubeInsertIndex = allH2[allH2.length - 2].index!;
      }
      if (youtubeInsertIndex !== -1) {
        const videosToInject = youtubeVideos.slice(0, 2);
        const youtubeMd = videosToInject.map((v) =>
          `\n<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:1.5em 0;border-radius:8px;"><iframe src="https://www.youtube.com/embed/${v.videoId}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen loading="lazy"></iframe></div>\n*${v.title}*\n`
        ).join("\n");
        finalMarkdown = finalMarkdown.slice(0, youtubeInsertIndex) + youtubeMd + "\n" + finalMarkdown.slice(youtubeInsertIndex);
        console.log(`YouTube videos injected: ${videosToInject.map(v => v.videoId).join(", ")}`);
      } else {
        console.log("Could not find suitable H2 for YouTube injection.");
      }
    } else {
      console.log("Claude included YouTube embeds — no injection needed.");
    }
  }

  // ── Step 4b1: Fix broken markdown tables ──
  // AI sometimes generates broken separator rows with double pipes
  finalMarkdown = finalMarkdown.replace(/\|\|+/g, '|');
  // Fix separator rows that are missing dashes
  finalMarkdown = finalMarkdown.replace(/\|\s*\|/g, '| --- |');

  // ── Step 4b2: Programmatic product name enforcement ──
  // If the AI genericized the product name in the product section H2, fix it
  {
    const pName = site.siteName || "the product";
    const lines = finalMarkdown.split("\n");
    let fixed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("## ") && /how\s/i.test(line) && /helps?/i.test(line) && !line.toLowerCase().includes(pName.toLowerCase())) {
        // Replace generic "How Your/The X Helps" with "How {productName} Helps"
        lines[i] = line.replace(/How\s+(?:Your|The|This|Our|A)\s+\S+\s+Helps/i, `How ${pName} Helps`);
        console.log(`Fixed product section heading: "${line}" → "${lines[i]}"`);
        fixed = true;
        break;
      }
    }
    // Also do a global replace of generic product references
    if (pName !== "the product") {
      const genericTerms = ["your CRM", "the CRM", "this CRM", "your platform", "the platform", "this platform", "your tool", "the tool", "this tool", "your software", "the software"];
      for (const term of genericTerms) {
        if (finalMarkdown.toLowerCase().includes(term.toLowerCase())) {
          const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\  // ── Step 4c: Programmatic Screenshot Injection (inside product section) ──'), 'gi');
          finalMarkdown = finalMarkdown.replace(regex, pName);
          console.log(`Replaced generic term "${term}" → "${pName}"`);
        }
      }
    }
    if (fixed) finalMarkdown = lines.join("\n");
  }

  // ── Step 4c: Programmatic Screenshot Injection (inside product section) ──
  if (screenshotUrl) {
    const pName = site.siteName || "the product";
    const mdLines = finalMarkdown.split("\n");
    let productH2Line = -1;
    for (let li = 0; li < mdLines.length; li++) {
      if (mdLines[li].startsWith("## ") && (mdLines[li].toLowerCase().includes(pName.toLowerCase()) || (/how\s/i.test(mdLines[li]) && /helps?/i.test(mdLines[li])))) {
        productH2Line = li;
        break;
      }
    }
    if (productH2Line !== -1) {
      let insertLine = productH2Line + 1;
      while (insertLine < mdLines.length && mdLines[insertLine].trim() === "") insertLine++;
      while (insertLine < mdLines.length && mdLines[insertLine].trim() !== "") insertLine++;
      mdLines.splice(insertLine, 0, "", `![${pName} website](${screenshotUrl})`, `*${pName} — ${site.siteSummary ? site.siteSummary.split(".")[0] : "see it in action"}*`, "");
      finalMarkdown = mdLines.join("\n");
      console.log("Screenshot injected inside product section (after intro paragraph).");
    } else {
      const faqLine = mdLines.findIndex(l => l.startsWith("## FAQ") || l.startsWith("## Frequently") || /##.*(?:faq|frequently)/i.test(l));
      if (faqLine !== -1) {
        mdLines.splice(faqLine, 0, "", `![${pName} website](${screenshotUrl})`, `*${pName} — see it in action*`, "");
        finalMarkdown = mdLines.join("\n");
        console.log("Screenshot injected (fallback: before FAQ).");
      }
    }
  }

  // ── Step 5: Content Score (graceful degradation) ──
  await reportProgress(10, "Scoring content quality...");
  let contentScoreResult: { overallScore?: number; entityCoverage?: number; topicCompleteness?: number; missingEntities?: string[]; missingTopics?: string[] } = {};

  if (topic) {
    try {
      const { scoreContent, analyzeSERP } = await import("./seoData");
      // Get SERP results for scoring comparison
      const locationCode = mapCountryToLocation(site.targetCountry);
      const serpData = await analyzeSERP(topic.primaryKeyword, locationCode, site.language ?? "en");
      const score = await scoreContent(finalMarkdown, topic.primaryKeyword, serpData.results);
      contentScoreResult = score;
      console.log(`Content score: overall=${score.overallScore}, entities=${score.entityCoverage}, completeness=${score.topicCompleteness}`);

      // ── AUTO-ENHANCEMENT: If score is below 70, inject missing entities/topics ──
      if (score.overallScore < 70 && (score.missingEntities.length > 0 || score.missingTopics.length > 0)) {
        console.log(`Content score ${score.overallScore}/100 — auto-enhancing with ${score.missingEntities.length} missing entities, ${score.missingTopics.length} missing topics...`);
        try {
          const enhancePrompt = [
            `You are an SEO content optimizer. The article below scored ${score.overallScore}/100 against competing SERP content.`,
            ``,
            `Missing entities (concepts/terms that top-ranking pages mention but this article doesn't):`,
            score.missingEntities.map(e => `- ${e}`).join("\n"),
            ``,
            score.missingTopics.length > 0 ? `Missing subtopics that need coverage:\n${score.missingTopics.map(t => `- ${t}`).join("\n")}\n` : "",
            `TASK: Return the FULL article with these entities and subtopics naturally woven in.`,
            `Rules:`,
            `- Keep all existing content, structure, headings, and citations intact`,
            `- Add the missing entities/topics naturally — don't force them awkwardly`,
            `- Add new H2/H3 sections if a missing subtopic needs its own section`,
            `- Keep the same tone and style`,
            `- Return ONLY the enhanced markdown, nothing else`,
          ].filter(Boolean).join("\n");

          const enhanced = await callClaude(enhancePrompt, finalMarkdown, 16384);
          if (enhanced && enhanced.length > finalMarkdown.length * 0.8) {
            finalMarkdown = enhanced;
            // Re-score after enhancement
            const rescore = await scoreContent(finalMarkdown, topic.primaryKeyword, serpData.results);
            contentScoreResult = rescore;
            console.log(`Post-enhancement score: ${rescore.overallScore}/100 (was ${score.overallScore})`);
          }
        } catch (enhErr) {
          console.error(`Auto-enhancement failed (keeping original): ${enhErr instanceof Error ? enhErr.message : "unknown"}`);
        }
      }
    } catch (err) {
      console.error(`Content scoring failed (non-critical): ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  // ── Step 6: Calculate Article Stats ──
  const { readingTime, wordCount } = calculateArticleStats(finalMarkdown);
  console.log(`Article stats: ${wordCount} words, ${readingTime} min read`);

  // ── Step 7: Create Draft ──
  const slug = article.slug || buildSlug(article.title);

  const articleId = await ctx.runMutation(api.articles.createDraft, {
    siteId,
    topicId: topicId ?? undefined,
    articleType: effectiveArticleType,
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

  // Save content score if available
  if (contentScoreResult.overallScore !== undefined) {
    try {
      await ctx.runMutation(api.articles.updateContentScore, {
        articleId,
        contentScore: contentScoreResult.overallScore,
        entityCoverage: contentScoreResult.entityCoverage,
        topicCompleteness: contentScoreResult.topicCompleteness,
        missingEntities: contentScoreResult.missingEntities,
        missingTopics: contentScoreResult.missingTopics,
        serpDifficulty: serpDifficulty,
      });
    } catch { /* non-critical */ }
  }

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

    // Find the TOC section boundaries so we never inject links inside it
    const tocStart = updatedMarkdown.indexOf("## Table of Contents");
    const tocEnd = tocStart >= 0 ? updatedMarkdown.indexOf("\n## ", tocStart + 1) : -1;

    for (const link of links) {
      // Skip if this link target is the article's own slug
      if (link.href === article.slug) continue;
      // Only replace the first occurrence, and only if not already a markdown link
      const anchor = link.anchor;
      const escapedAnchor = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match anchor text that is NOT already inside a markdown link [...](...)
      const regex = new RegExp(`(?<!\\[)${escapedAnchor}(?!\\]\\()`, "i");
      const replacement = `[${anchor}](${link.href})`;
      const match = regex.exec(updatedMarkdown);
      if (match) {
        // Skip if the match falls inside the Table of Contents section
        if (tocStart >= 0 && tocEnd > tocStart && match.index >= tocStart && match.index < tocEnd) {
          continue;
        }
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
        model: "gpt-4o-mini",
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

    // Step 3: Deep AI analysis (non-fatal — site can still function without full profile)
    let analysis = null;
    try {
      analysis = await handleAnalyzeSite(ctx, siteId, html, crawlResult.pages);
    } catch (err) {
      console.error(`Site analysis failed (non-fatal): ${err instanceof Error ? err.message : "unknown"}`);
      // Save a basic siteSummary so the overview page works
      await ctx.runMutation(api.sites.upsert, {
        id: siteId,
        domain: site.domain,
        siteSummary: `Website at ${site.domain}`,
      });
    }

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
  args: { siteId: v.id("sites"), jobId: v.optional(v.id("jobs")) },
  handler: async (ctx, { siteId, jobId }) => {
    if (jobId) {
      // Job-based: mark running, track progress, mark done/failed
      await ctx.runMutation(api.jobs.markRunning, { jobId });
      try {
        const result = await handlePlan(ctx, siteId, jobId);
        await ctx.runMutation(api.jobs.markDone, { jobId, result });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await ctx.runMutation(api.jobs.markFailed, { jobId, error: msg });
        throw err;
      }
    }
    return handlePlan(ctx, siteId);
  },
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

    // Enforce article limit
    if (site?.userId) {
      const { getLimitsFromFeatures } = await import("../planLimits");
      const features = (site as any).planFeatures ?? [];
      const limits = getLimitsFromFeatures(features);
      const claim = await ctx.runMutation(api.articles.claimGenerationSlot, {
        userId: site.userId,
        siteId,
        maxArticles: limits.maxArticles,
      });
      if (!claim.ok) throw new Error(`Article limit reached (${limits.maxArticles}/month). Upgrade your plan.`);
    }

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
        current: 11,
        total: 11,
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

    // Enforce article limit
    if (site.userId) {
      const { getLimitsFromFeatures } = await import("../planLimits");
      const features = (site as any).planFeatures ?? [];
      const limits = getLimitsFromFeatures(features);
      const claim = await ctx.runMutation(api.articles.claimGenerationSlot, {
        userId: site.userId,
        siteId,
        maxArticles: limits.maxArticles,
      });
      if (!claim.ok) throw new Error(`Article limit reached (${limits.maxArticles}/month). Upgrade your plan for more articles.`);
    }

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
        current: 11,
        total: 11,
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

// Cron driver to run autopilot across all sites with autopilot enabled
export const autopilotCron = action({
  args: {},
  handler: async (ctx) => {
    const sites = await ctx.runQuery(api.sites.listAllForAutopilot, {});
    if (!sites?.length) return { processed: 0 };
    let processed = 0;
    for (const site of sites) {
      // Only run autopilot for sites that have it enabled
      if (!site.autopilotEnabled) {
        continue;
      }
      const res = await ctx.runAction(api.actions.pipeline.autopilotTick as any, {
        siteId: site._id,
      });
      processed += res?.processed ? 1 : 0;
    }
    return { processed };
  },
});

// Monthly re-linking: update internal links on all published articles
// so older articles link to newer content and vice versa.
export const relinkAllArticles = action({
  args: {},
  handler: async (ctx) => {
    const sites = await ctx.runQuery(api.sites.listAllForAutopilot, {});
    if (!sites?.length) return { relinked: 0 };

    let relinked = 0;
    for (const site of sites) {
      const articles = await ctx.runQuery(api.articles.listBySite, {
        siteId: site._id,
      });
      const published = articles.filter(
        (a: { status: string }) => a.status === "published",
      );

      // Only re-link if there are at least 3 published articles
      if (published.length < 3) continue;

      // Re-link up to 10 oldest articles per site (those most likely to miss new content)
      const oldest = [...published].sort(
        (a, b) => a.createdAt - b.createdAt,
      ).slice(0, 10);

      for (const article of oldest) {
        try {
          await handleLinks(ctx, site._id, article._id);
          relinked++;
          console.log(`Re-linked article: "${article.title}" (${article.slug})`);
        } catch (err) {
          console.error(
            `Re-link failed for ${article._id}: ${err instanceof Error ? err.message : "unknown"}`,
          );
        }
      }
    }

    console.log(`Monthly re-linking complete: ${relinked} articles updated.`);
    return { relinked };
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
    if (availableTopics.length === 0) {
      console.log(`All topics used up, generating fresh batch...`);
      await handlePlan(ctx, siteId);
    } else if (availableTopics.length < 3) {
      console.log(`Topics low (${availableTopics.length}), replenishing...`);
      await handlePlan(ctx, siteId);
    }

    // 4. Schedule articles for the week
    await ctx.runAction(api.actions.scheduler.scheduleCadence, { siteId });

    // 5. Process ONLY ONE job per tick, respecting cadence for article jobs.
    const allPending = await ctx.runQuery(api.jobs.listPending, {});
    // Filter to jobs for THIS site only — each site manages its own queue
    const pending = allPending.filter(j => j.siteId === siteId);
    // Sort: manual jobs first (user clicked Generate), then by creation time (oldest first)
    pending.sort((a, b) => {
      const aManual = !!(a.payload as any)?.manual ? 1 : 0;
      const bManual = !!(b.payload as any)?.manual ? 1 : 0;
      if (aManual !== bManual) return bManual - aManual; // manual first
      return a.createdAt - b.createdAt; // then oldest first
    });
    if (pending.length > 0) {
      const nextJob = pending[0];
      // Cadence gate: only process CRON-scheduled article jobs when enough time has passed
      // Manual jobs (from Generate button) bypass the cadence gate
      const isManualJob = !!(nextJob.payload as any)?.manual;
      if (nextJob.type === "article" && !isManualJob) {
        const cadence = site.cadencePerWeek ?? 4;
        const hoursPerArticle = Math.floor((7 * 24) / cadence);
        const allArticles = await ctx.runQuery(api.articles.listBySite, { siteId });
        const lastArticle = allArticles.length > 0 ? allArticles[0] : null;
        const hoursSinceLast = lastArticle
          ? (Date.now() - lastArticle.createdAt) / (1000 * 60 * 60)
          : 999;
        if (hoursSinceLast < hoursPerArticle) {
          console.log(`Cadence gate: last article ${Math.floor(hoursSinceLast)}h ago, need ${hoursPerArticle}h. Holding.`);
          return { processed: 0 };
        }
      }
      console.log(`Processing next job: ${nextJob.type} (${nextJob._id})`);
      await ctx.runAction(api.actions.pipeline.processNextJob as any, { siteId });
      return { processed: 1 };
    }

    // 6. No pending jobs — use this tick to auto-refresh declining articles
    try {
      const refreshResult = await ctx.runAction(api.actions.contentDecay.autoRefreshTop, { siteId });
      if (refreshResult.refreshed) {
        console.log(`Auto-refreshed declining article: "${refreshResult.title}"`);
        return { processed: 1 };
      }
    } catch (err) {
      console.error(`Auto-refresh check failed:`, err);
    }

    return { processed: 0 };
  },
});

// Process a SPECIFIC job by ID — used by "Run Now" button
// Bypasses autopilotTick entirely (no scheduling, no topic replenishment)
export const processSpecificJob = action({
  args: { jobId: v.id("jobs") },
  handler: async (
    ctx: ActionCtx,
    { jobId },
  ): Promise<{ processed: boolean; error?: string }> => {
    // Get the specific job
    const allPending = await ctx.runQuery(api.jobs.listPending, {});
    const job = allPending.find(j => j._id === jobId);
    if (!job) {
      // Maybe it's already running
      return { processed: false, error: "Job not found or already running" };
    }

    // Mark it running
    await ctx.runMutation(api.jobs.markRunning, { jobId: job._id });

    try {
      if (job.type !== "article" || !job.siteId) {
        throw new Error("processSpecificJob only handles article jobs");
      }

      const site = await ctx.runQuery(api.sites.get, { siteId: job.siteId });
      const payload = job.payload as { topicId?: string } | undefined;

      // Enforce article limit atomically
      if (site?.userId) {
        const { getLimitsFromFeatures } = await import("../planLimits");
        const features = (site as any).planFeatures ?? [];
        const limits = getLimitsFromFeatures(features);
        const claim = await ctx.runMutation(api.articles.claimGenerationSlot, {
          userId: site.userId,
          siteId: job.siteId,
          maxArticles: limits.maxArticles,
        });
        if (!claim.ok) {
          await ctx.runMutation(api.jobs.markFailed, {
            jobId: job._id,
            error: `Article limit reached (${limits.maxArticles}/month). Upgrade plan.`,
          });
          return { processed: true, error: claim.reason };
        }
      }

      // Pre-check topic exists
      if (payload?.topicId) {
        const topicCheck = await ctx.runQuery(api.topics.get, { topicId: payload.topicId as any });
        if (!topicCheck) {
          await ctx.runMutation(api.jobs.markFailed, {
            jobId: job._id,
            error: "Topic not found (deleted).",
          });
          return { processed: true, error: "Topic deleted" };
        }
      }

      const articleResult = await handleArticle(ctx, job.siteId, payload?.topicId as any, undefined, job._id);

      // Internal links
      try {
        await handleLinks(ctx, job.siteId, articleResult.articleId);
      } catch (err) {
        console.error("Internal linking failed:", err instanceof Error ? err.message : "unknown");
      }

      // Publish
      try {
        await ctx.runAction(api.publisher.publishArticle, {
          siteId: job.siteId,
          articleId: articleResult.articleId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        console.error(`Publish failed: ${msg}`);
        await ctx.runMutation(api.jobs.markFailed, {
          jobId: job._id,
          error: `Article generated but publish failed: ${msg}`,
        });
        return { processed: true };
      }

      await ctx.runMutation(api.jobs.markDone, {
        jobId: job._id,
        result: { articleId: articleResult.articleId },
      });
      return { processed: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      await ctx.runMutation(api.jobs.markFailed, {
        jobId: job._id,
        error: msg,
      });
      return { processed: true, error: msg };
    }
  },
});

export const processNextJob = action({
  args: { siteId: v.optional(v.id("sites")) },
  handler: async (
    ctx: ActionCtx,
    args: { siteId?: Id<"sites"> },
  ): Promise<{ processed: boolean; jobId?: Id<"jobs">; error?: string }> => {
    const allPending = await ctx.runQuery(api.jobs.listPending, {});
    // Filter to this site's jobs only (prevent cross-site phantom processing)
    const pending = args.siteId ? allPending.filter(j => j.siteId === args.siteId) : allPending;
    // Sort: manual jobs first, then oldest first
    pending.sort((a, b) => {
      const aManual = !!(a.payload as any)?.manual ? 1 : 0;
      const bManual = !!(b.payload as any)?.manual ? 1 : 0;
      if (aManual !== bManual) return bManual - aManual;
      return a.createdAt - b.createdAt;
    });
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
        await handlePlan(ctx, job.siteId, job._id);
      } else if (job.type === "article") {
        if (!job.siteId) throw new Error("Missing siteId on article job");
        const site = await ctx.runQuery(api.sites.get, { siteId: job.siteId });

        // Enforce article limit ATOMICALLY — claim a slot before generating
        // This prevents race conditions where two concurrent jobs both pass the check
        if (site?.userId) {
          const { getLimitsFromFeatures } = await import("../planLimits");
          const features = (site as any).planFeatures ?? [];
          const limits = getLimitsFromFeatures(features);
          const claim = await ctx.runMutation(api.articles.claimGenerationSlot, {
            userId: site.userId,
            siteId: job.siteId,
            maxArticles: limits.maxArticles,
          });
          if (!claim.ok) {
            console.log(`Article limit: ${claim.reason}. Skipping job ${job._id}.`);
            await ctx.runMutation(api.jobs.markFailed, {
              jobId: job._id,
              error: `Article limit reached (${limits.maxArticles}/month). Upgrade plan.`,
            });
            return { processed: true, jobId: job._id };
          }
          console.log("Generation slot claimed successfully.");
        }

        // Pre-check: if job references a topic, verify it still exists
        if (payload?.topicId) {
          const topicCheck = await ctx.runQuery(api.topics.get, { topicId: payload.topicId });
          if (!topicCheck) {
            console.log(`Topic ${payload.topicId} no longer exists. Failing job permanently.`);
            await ctx.runMutation(api.jobs.markFailed, {
              jobId: job._id,
              error: "Topic not found (deleted). Job cannot proceed.",
            });
            return { processed: true, jobId: job._id };
          }
        }

        const articleResult = await handleArticle(ctx, job.siteId, payload?.topicId, undefined, job._id);

        // Generation already logged atomically via claimGenerationSlot above

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

        // Suggest backlink opportunities (data-driven with DataForSEO fallback to AI)
        try {
          console.log("Generating backlink suggestions...");
          const backlinkResult = await ctx.runAction(api.actions.backlinks.quickBacklinkScan, {
            siteId: job.siteId,
            articleId: articleResult.articleId,
          });
          console.log(`Added ${backlinkResult.suggestions.length} backlink suggestions.`);
        } catch (err) {
          console.error("Backlink suggestions failed (non-critical):", err instanceof Error ? err.message : err);
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

// ── Competitor Keyword Gap Analysis ──
export const analyzeKeywordGaps = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{
    gaps: { keyword: string; searchVolume: number; difficulty: number; competitorUrl: string; opportunity: string }[];
  }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");
    if (!site.competitors?.length) {
      return { gaps: [] };
    }

    const { findKeywordGaps } = await import("./seoData");
    const locationCode = mapCountryToLocation(site.targetCountry);
    const gaps = await findKeywordGaps(
      site.domain,
      site.competitors,
      locationCode,
      site.language ?? "en",
    );

    console.log(`Found ${gaps.length} keyword gaps for ${site.domain}`);
    return { gaps };
  },
});

// ── Content Decay Detection ──
// Identifies articles that may be declining in performance and need refreshing.
// Currently uses heuristics (age + content score). Will integrate GSC data when available.
export const detectContentDecay = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{
    decayingArticles: {
      articleId: string;
      title: string;
      slug: string;
      age: number; // days since publication
      contentScore: number | null;
      reason: string;
      recommendation: string;
    }[];
  }> => {
    const articles = await ctx.runQuery(api.articles.listBySite, { siteId });
    const published = articles.filter((a: any) => a.status === "published" || a.status === "ready");

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const decaying: {
      articleId: string;
      title: string;
      slug: string;
      age: number;
      contentScore: number | null;
      reason: string;
      recommendation: string;
    }[] = [];

    for (const article of published) {
      const ageDays = Math.floor((now - article.createdAt) / DAY_MS);
      const score = (article as any).contentScore ?? null;
      const reasons: string[] = [];
      const recommendations: string[] = [];

      // Flag articles older than 90 days
      if (ageDays > 90) {
        reasons.push(`Published ${ageDays} days ago — content freshness may have declined`);
        recommendations.push("Update statistics, add recent data, refresh examples");
      }

      // Flag articles with low content scores
      if (score !== null && score < 60) {
        reasons.push(`Content score is ${score}/100 — below competitive threshold`);
        recommendations.push("Add missing entities and subtopics identified in content analysis");
      }

      // Flag articles with low word count (may be thin content)
      if (article.wordCount && article.wordCount < 1500) {
        reasons.push(`Only ${article.wordCount} words — may be too thin for competitive keywords`);
        recommendations.push("Expand with additional sections, examples, and expert insights");
      }

      // Flag articles with low fact-check scores
      if (article.factCheckScore !== undefined && article.factCheckScore < 60) {
        reasons.push(`Fact-check score is ${article.factCheckScore}/100 — claims may need re-verification`);
        recommendations.push("Re-run fact-check with updated sources");
      }

      if (reasons.length > 0) {
        decaying.push({
          articleId: article._id,
          title: article.title,
          slug: article.slug,
          age: ageDays,
          contentScore: score,
          reason: reasons.join("; "),
          recommendation: recommendations.join("; "),
        });
      }
    }

    // Sort by urgency: older + lower score = more urgent
    decaying.sort((a, b) => {
      const urgencyA = a.age + (100 - (a.contentScore ?? 50));
      const urgencyB = b.age + (100 - (b.contentScore ?? 50));
      return urgencyB - urgencyA;
    });

    console.log(`Content decay scan: ${decaying.length}/${published.length} articles flagged for refresh.`);
    return { decayingArticles: decaying.slice(0, 20) };
  },
});

// ── Backfill SEO Metrics for Existing Topics ──
// Enriches topics that were created before the SEO intelligence system was added.
// Fetches keyword metrics + SERP analysis, applies quality gate, removes bad topics.
export const backfillTopicMetrics = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{ enriched: number; removed: number }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    const allTopics = await ctx.runQuery(api.topics.listBySite, { siteId });
    // Backfill topics without metrics or with invalid markers (-1 = force refresh)
    const unenriched = allTopics.filter(
      (t: any) => (t.searchVolume === undefined || t.searchVolume < 0) && t.status !== "used",
    );
    if (unenriched.length === 0) {
      console.log("All topics already have SEO metrics — nothing to backfill.");
      return { enriched: 0, removed: 0 };
    }

    console.log(`Backfilling SEO metrics for ${unenriched.length} topics...`);

    const { getKeywordMetrics, analyzeSERP } = await import("./seoData");
    const keywords = unenriched.map((t: any) => t.primaryKeyword);
    const locationCode = mapCountryToLocation(site.targetCountry);
    const metrics = await getKeywordMetrics(keywords, locationCode, site.language ?? "en");

    let enriched = 0;
    let removed = 0;

    for (const topic of unenriched) {
      const kwMetric = metrics.find(
        (m) => m.keyword.toLowerCase() === topic.primaryKeyword.toLowerCase(),
      );
      if (!kwMetric) continue;

      // Quality gate: remove topics with zero volume AND high difficulty
      if (kwMetric.searchVolume === 0 && kwMetric.difficulty > 70) {
        console.log(`Backfill quality gate: removing "${topic.primaryKeyword}" (0 vol, ${kwMetric.difficulty} KD)`);
        try {
          await ctx.runMutation(api.topics.remove, { topicId: topic._id });
          removed++;
        } catch { /* already gone */ }
        continue;
      }

      // Compute opportunity score (logarithmic volume scaling for niche keywords)
      const volumeScore = kwMetric.searchVolume > 0
        ? Math.min(Math.log10(kwMetric.searchVolume) * 13, 40)
        : 0;
      const difficultyBonus = Math.max(0, (100 - kwMetric.difficulty) * 0.4);
      const cpcSignal = Math.min(kwMetric.cpc * 4, 20);
      const opportunityScore = Math.round(volumeScore + difficultyBonus + cpcSignal);
      const autoPriority = opportunityScore >= 70 ? 5
        : opportunityScore >= 55 ? 4
        : opportunityScore >= 40 ? 3
        : opportunityScore >= 25 ? 2
        : 1;

      // Save metrics + priority
      await ctx.runMutation(api.topics.updateSEOMetrics, {
        topicId: topic._id,
        searchVolume: kwMetric.searchVolume,
        keywordDifficulty: kwMetric.difficulty,
        cpc: kwMetric.cpc,
        serpIntent: kwMetric.intent,
        volumeTrend: kwMetric.trend.length > 0 ? kwMetric.trend : undefined,
        priority: autoPriority,
      });

      // SERP analysis: auto-set article type
      try {
        const serpAnalysis = await analyzeSERP(topic.primaryKeyword, locationCode, site.language ?? "en");
        await ctx.runMutation(api.topics.updateSEOMetrics, {
          topicId: topic._id,
          recommendedArticleType: serpAnalysis.recommendedArticleType,
          articleType: serpAnalysis.recommendedArticleType,
          paaQuestions: serpAnalysis.paaQuestions.length > 0 ? serpAnalysis.paaQuestions : undefined,
        });
      } catch (serpErr) {
        console.error(`SERP analysis failed for "${topic.primaryKeyword}":`, serpErr);
      }

      enriched++;
      console.log(`Backfilled "${topic.primaryKeyword}": vol=${kwMetric.searchVolume}, KD=${kwMetric.difficulty}, priority=${autoPriority}`);
    }

    console.log(`Backfill complete: ${enriched} enriched, ${removed} removed by quality gate.`);
    return { enriched, removed };
  },
});

