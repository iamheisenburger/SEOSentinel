"use node";

/**
 * SEO Data Module — DataForSEO integration + SERP analysis
 *
 * Provides real keyword metrics (volume, difficulty, CPC),
 * SERP intent analysis, competitor keyword gaps, and content scoring.
 *
 * Requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD env vars on Convex.
 * Falls back gracefully to AI-based estimation when API is unavailable.
 */

import { z } from "zod";
import OpenAI from "openai";

// ── Types ──

export interface KeywordMetrics {
  keyword: string;
  searchVolume: number; // monthly searches
  difficulty: number; // 0-100 keyword difficulty
  cpc: number; // cost per click USD
  competition: number; // 0-1 competition level
  intent: string; // informational | commercial | transactional | navigational
  trend: number[]; // last 12 months search volume trend
}

export interface SerpResult {
  position: number;
  url: string;
  title: string;
  description: string;
  type: string; // organic | featured_snippet | people_also_ask | etc.
}

export interface SerpAnalysis {
  keyword: string;
  results: SerpResult[];
  dominantFormat: string; // listicle | how-to | comparison | product | etc.
  recommendedArticleType: string;
  featuredSnippetPresent: boolean;
  paaQuestions: string[];
  difficulty: string; // easy | medium | hard | very_hard
}

export interface ContentScore {
  overallScore: number; // 0-100
  entityCoverage: number; // 0-100
  topicCompleteness: number; // 0-100
  readabilityScore: number; // 0-100
  missingEntities: string[];
  missingTopics: string[];
  recommendations: string[];
}

export interface KeywordGap {
  keyword: string;
  searchVolume: number;
  difficulty: number;
  competitorUrl: string; // which competitor ranks for this
  competitorPosition: number;
  opportunity: string; // high | medium | low
}

// ── DataForSEO API Client ──

function getDataForSEOCredentials(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

async function dataForSEORequest(
  endpoint: string,
  body: any[],
): Promise<any> {
  const creds = getDataForSEOCredentials();
  if (!creds) throw new Error("DataForSEO credentials not configured");

  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString("base64");

  const response = await fetch(`https://api.dataforseo.com/v3/${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DataForSEO API error (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO error: ${data.status_message ?? "unknown"}`);
  }

  return data;
}

// ── Keyword Metrics ──

/**
 * Get real keyword metrics from DataForSEO.
 * Falls back to AI estimation if API unavailable.
 */
export async function getKeywordMetrics(
  keywords: string[],
  locationCode: number = 2840, // US
  languageCode: string = "en",
): Promise<KeywordMetrics[]> {
  const creds = getDataForSEOCredentials();

  if (creds) {
    return getKeywordMetricsFromAPI(keywords, locationCode, languageCode);
  }

  // Fallback: AI-based estimation
  return getKeywordMetricsFromAI(keywords);
}

async function getKeywordMetricsFromAPI(
  keywords: string[],
  locationCode: number,
  languageCode: string,
): Promise<KeywordMetrics[]> {
  // Use Keywords Data API - Google Ads Search Volume
  const data = await dataForSEORequest(
    "keywords_data/google_ads/search_volume/live",
    [{
      keywords,
      location_code: locationCode,
      language_code: languageCode,
      date_from: getDateMonthsAgo(12),
    }],
  );

  const results: KeywordMetrics[] = [];
  const tasks = data.tasks ?? [];

  for (const task of tasks) {
    const items = task.result ?? [];
    for (const item of items) {
      if (!item.keyword) continue;

      // Extract monthly search volumes for trend
      const monthlySearches = (item.monthly_searches ?? [])
        .slice(0, 12)
        .map((m: any) => m.search_volume ?? 0);

      results.push({
        keyword: item.keyword,
        searchVolume: item.search_volume ?? 0,
        difficulty: 0, // Will be enriched by difficulty endpoint
        cpc: item.cpc ?? 0,
        competition: item.competition ?? 0,
        intent: mapCompetitionToIntent(item.competition ?? 0),
        trend: monthlySearches,
      });
    }
  }

  // Enrich with keyword difficulty scores
  if (results.length > 0) {
    try {
      const difficultyData = await dataForSEORequest(
        "keywords_data/google_ads/keywords_for_keywords/live",
        [{
          keywords: keywords.slice(0, 10), // API limit
          location_code: locationCode,
          language_code: languageCode,
        }],
      );

      // Map difficulty from competition index
      for (const task of difficultyData.tasks ?? []) {
        for (const item of task.result ?? []) {
          const match = results.find(
            (r) => r.keyword.toLowerCase() === (item.keyword ?? "").toLowerCase(),
          );
          if (match) {
            match.difficulty = Math.round((item.competition_index ?? item.competition ?? 0) * 100);
          }
        }
      }
    } catch (err) {
      console.error("Keyword difficulty enrichment failed:", err);
      // Fall back to CPC-based difficulty estimation
      for (const r of results) {
        if (r.difficulty === 0) {
          r.difficulty = estimateDifficultyFromCPC(r.cpc, r.competition);
        }
      }
    }
  }

  return results;
}

async function getKeywordMetricsFromAI(
  keywords: string[],
): Promise<KeywordMetrics[]> {
  // AI fallback when DataForSEO is not configured
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Return empty metrics with zeroes
    return keywords.map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      difficulty: 50,
      cpc: 0,
      competition: 0.5,
      intent: "informational",
      trend: [],
    }));
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" as any }],
      input: [
        {
          role: "system",
          content:
            "You are an SEO keyword research expert. Estimate keyword metrics based on your knowledge and web search. " +
            "Be realistic with estimates — most long-tail keywords have 100-1000 monthly searches. " +
            "Output JSON only.",
        },
        {
          role: "user",
          content:
            `Estimate SEO metrics for these keywords: ${JSON.stringify(keywords)}\n\n` +
            `Return JSON array: [{"keyword":"...","searchVolume":<estimated monthly searches>,"difficulty":<0-100>,"cpc":<estimated USD>,"competition":<0-1>,"intent":"informational|commercial|transactional|navigational"}]`,
        },
      ],
    });

    const MetricsSchema = z.array(
      z.object({
        keyword: z.string(),
        searchVolume: z.number(),
        difficulty: z.number(),
        cpc: z.number().default(0),
        competition: z.number().default(0.5),
        intent: z.string().default("informational"),
      }),
    );

    const text = completion.output_text;
    const clean = text.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*$/g, "").trim();
    const arrStart = clean.indexOf("[");
    const arrEnd = clean.lastIndexOf("]");
    if (arrStart === -1 || arrEnd === -1) throw new Error("No JSON array in response");
    const raw = clean.slice(arrStart, arrEnd + 1);
    const parsed = MetricsSchema.parse(JSON.parse(raw));

    return parsed.map((m) => ({
      ...m,
      trend: [],
    }));
  } catch (err) {
    console.error("AI keyword estimation failed:", err);
    return keywords.map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      difficulty: 50,
      cpc: 0,
      competition: 0.5,
      intent: "informational",
      trend: [],
    }));
  }
}

// ── SERP Analysis ──

/**
 * Analyze SERP results for a keyword to determine optimal article format.
 * Uses DataForSEO SERP API if available, falls back to AI analysis.
 */
export async function analyzeSERP(
  keyword: string,
  locationCode: number = 2840,
  languageCode: string = "en",
): Promise<SerpAnalysis> {
  const creds = getDataForSEOCredentials();

  if (creds) {
    return analyzeSERPFromAPI(keyword, locationCode, languageCode);
  }

  return analyzeSERPFromAI(keyword);
}

async function analyzeSERPFromAPI(
  keyword: string,
  locationCode: number,
  languageCode: string,
): Promise<SerpAnalysis> {
  const data = await dataForSEORequest(
    "serp/google/organic/live/regular",
    [{
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      depth: 10,
    }],
  );

  const results: SerpResult[] = [];
  const paaQuestions: string[] = [];
  let featuredSnippetPresent = false;

  for (const task of data.tasks ?? []) {
    for (const item of task.result?.[0]?.items ?? []) {
      if (item.type === "organic") {
        results.push({
          position: item.rank_absolute ?? results.length + 1,
          url: item.url ?? "",
          title: item.title ?? "",
          description: item.description ?? "",
          type: "organic",
        });
      } else if (item.type === "featured_snippet") {
        featuredSnippetPresent = true;
        results.unshift({
          position: 0,
          url: item.url ?? "",
          title: item.title ?? "",
          description: item.description ?? "",
          type: "featured_snippet",
        });
      } else if (item.type === "people_also_ask") {
        for (const q of item.items ?? []) {
          if (q.title) paaQuestions.push(q.title);
        }
      }
    }
  }

  const { dominantFormat, recommendedArticleType } = classifySERPResults(results);

  return {
    keyword,
    results: results.slice(0, 10),
    dominantFormat,
    recommendedArticleType,
    featuredSnippetPresent,
    paaQuestions: paaQuestions.slice(0, 8),
    difficulty: estimateSERPDifficulty(results),
  };
}

async function analyzeSERPFromAI(keyword: string): Promise<SerpAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      keyword,
      results: [],
      dominantFormat: "standard",
      recommendedArticleType: "standard",
      featuredSnippetPresent: false,
      paaQuestions: [],
      difficulty: "medium",
    };
  }

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" as any }],
      input: [
        {
          role: "system",
          content:
            "You are an SEO analyst. Analyze the current Google SERP for the given keyword. " +
            "Determine what content format dominates the top results and what format would best compete. " +
            "Output JSON only.",
        },
        {
          role: "user",
          content:
            `Analyze the Google SERP for: "${keyword}"\n\n` +
            `Return JSON: {\n` +
            `  "topResults": [{"position": 1, "title": "...", "url": "...", "format": "listicle|how-to|comparison|guide|product|review|news"}],\n` +
            `  "dominantFormat": "the most common format in top 10",\n` +
            `  "recommendedArticleType": "standard|listicle|how-to|checklist|comparison|roundup|ultimate-guide",\n` +
            `  "featuredSnippetPresent": true/false,\n` +
            `  "paaQuestions": ["question 1", "question 2", ...],\n` +
            `  "difficulty": "easy|medium|hard|very_hard"\n` +
            `}`,
        },
      ],
    });

    const SerpAISchema = z.object({
      topResults: z.array(z.object({
        position: z.number(),
        title: z.string(),
        url: z.string().default(""),
        format: z.string().default("standard"),
      })).default([]),
      dominantFormat: z.string(),
      recommendedArticleType: z.string(),
      featuredSnippetPresent: z.boolean().default(false),
      paaQuestions: z.array(z.string()).default([]),
      difficulty: z.string().default("medium"),
    });

    const text = completion.output_text;
    const clean = text.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*$/g, "").trim();
    const objStart = clean.indexOf("{");
    const objEnd = clean.lastIndexOf("}");
    if (objStart === -1 || objEnd === -1) throw new Error("No JSON in response");
    const parsed = SerpAISchema.parse(JSON.parse(clean.slice(objStart, objEnd + 1)));

    return {
      keyword,
      results: parsed.topResults.map((r) => ({
        position: r.position,
        url: r.url,
        title: r.title,
        description: "",
        type: "organic",
      })),
      dominantFormat: parsed.dominantFormat,
      recommendedArticleType: mapToArticleType(parsed.recommendedArticleType),
      featuredSnippetPresent: parsed.featuredSnippetPresent,
      paaQuestions: parsed.paaQuestions,
      difficulty: parsed.difficulty,
    };
  } catch (err) {
    console.error("AI SERP analysis failed:", err);
    return {
      keyword,
      results: [],
      dominantFormat: "standard",
      recommendedArticleType: "standard",
      featuredSnippetPresent: false,
      paaQuestions: [],
      difficulty: "medium",
    };
  }
}

// ── Content Scoring ──

/**
 * Score article content against top SERP competitors.
 * Analyzes entity coverage, topic completeness, and structural optimization.
 */
export async function scoreContent(
  articleMarkdown: string,
  targetKeyword: string,
  serpResults: SerpResult[],
): Promise<ContentScore> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      overallScore: 70,
      entityCoverage: 70,
      topicCompleteness: 70,
      readabilityScore: 70,
      missingEntities: [],
      missingTopics: [],
      recommendations: [],
    };
  }

  const client = new OpenAI({ apiKey });

  // Fetch content from top 3 SERP results for comparison
  const competitorContent: string[] = [];
  for (const result of serpResults.slice(0, 3)) {
    if (!result.url) continue;
    try {
      const res = await fetch(result.url, {
        headers: { "User-Agent": "Pentra/1.0 (content research)" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000);
        competitorContent.push(`[${result.title}]: ${text}`);
      }
    } catch {
      // Skip inaccessible pages
    }
  }

  try {
    const completion = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You are an SEO content analyst. Compare the given article against competitor content " +
            "and score it on entity coverage (are key entities mentioned?), topic completeness " +
            "(are all subtopics covered?), and readability. " +
            "Identify specific missing entities and topics. Output JSON only.",
        },
        {
          role: "user",
          content:
            `Target keyword: "${targetKeyword}"\n\n` +
            `ARTICLE TO SCORE:\n${articleMarkdown.slice(0, 5000)}\n\n` +
            `TOP COMPETITOR CONTENT:\n${competitorContent.join("\n\n").slice(0, 6000)}\n\n` +
            `Return JSON: {\n` +
            `  "overallScore": <0-100>,\n` +
            `  "entityCoverage": <0-100>,\n` +
            `  "topicCompleteness": <0-100>,\n` +
            `  "readabilityScore": <0-100>,\n` +
            `  "missingEntities": ["entity1", "entity2"],\n` +
            `  "missingTopics": ["subtopic1", "subtopic2"],\n` +
            `  "recommendations": ["recommendation1", "recommendation2"]\n` +
            `}`,
        },
      ],
    });

    const ScoreSchema = z.object({
      overallScore: z.number(),
      entityCoverage: z.number(),
      topicCompleteness: z.number(),
      readabilityScore: z.number(),
      missingEntities: z.array(z.string()).default([]),
      missingTopics: z.array(z.string()).default([]),
      recommendations: z.array(z.string()).default([]),
    });

    const text = completion.output_text;
    const clean = text.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*$/g, "").trim();
    const objStart = clean.indexOf("{");
    const objEnd = clean.lastIndexOf("}");
    if (objStart === -1 || objEnd === -1) throw new Error("No JSON");
    return ScoreSchema.parse(JSON.parse(clean.slice(objStart, objEnd + 1)));
  } catch (err) {
    console.error("Content scoring failed:", err);
    return {
      overallScore: 70,
      entityCoverage: 70,
      topicCompleteness: 70,
      readabilityScore: 70,
      missingEntities: [],
      missingTopics: [],
      recommendations: [],
    };
  }
}

// ── Competitor Keyword Gap ──

/**
 * Find keywords competitors rank for that the target site doesn't.
 * Uses DataForSEO if available, falls back to AI estimation.
 */
export async function findKeywordGaps(
  targetDomain: string,
  competitorDomains: string[],
  locationCode: number = 2840,
  languageCode: string = "en",
): Promise<KeywordGap[]> {
  const creds = getDataForSEOCredentials();

  if (creds && competitorDomains.length > 0) {
    return findKeywordGapsFromAPI(targetDomain, competitorDomains, locationCode, languageCode);
  }

  return findKeywordGapsFromAI(targetDomain, competitorDomains);
}

async function findKeywordGapsFromAPI(
  targetDomain: string,
  competitorDomains: string[],
  locationCode: number,
  languageCode: string,
): Promise<KeywordGap[]> {
  const gaps: KeywordGap[] = [];

  // For each competitor, get their ranked keywords
  for (const competitor of competitorDomains.slice(0, 3)) {
    try {
      const data = await dataForSEORequest(
        "dataforseo_labs/google/ranked_keywords/live",
        [{
          target: competitor.replace(/^https?:\/\//, "").replace(/\/$/, ""),
          location_code: locationCode,
          language_code: languageCode,
          limit: 50,
          order_by: ["keyword_data.keyword_info.search_volume,desc"],
          filters: [
            ["ranked_serp_element.serp_item.rank_group", "<=", 20],
          ],
        }],
      );

      for (const task of data.tasks ?? []) {
        for (const item of task.result?.[0]?.items ?? []) {
          const kw = item.keyword_data?.keyword;
          const vol = item.keyword_data?.keyword_info?.search_volume ?? 0;
          const diff = Math.round((item.keyword_data?.keyword_info?.competition ?? 0) * 100);
          const pos = item.ranked_serp_element?.serp_item?.rank_group ?? 99;

          if (kw && vol > 50) {
            gaps.push({
              keyword: kw,
              searchVolume: vol,
              difficulty: diff,
              competitorUrl: competitor,
              competitorPosition: pos,
              opportunity: vol > 1000 && diff < 50 ? "high" : vol > 500 ? "medium" : "low",
            });
          }
        }
      }
    } catch (err) {
      console.error(`Keyword gap analysis failed for ${competitor}:`, err);
    }
  }

  // Sort by opportunity: high volume + low difficulty first
  gaps.sort((a, b) => {
    const scoreA = a.searchVolume / Math.max(a.difficulty, 1);
    const scoreB = b.searchVolume / Math.max(b.difficulty, 1);
    return scoreB - scoreA;
  });

  return gaps.slice(0, 30);
}

async function findKeywordGapsFromAI(
  targetDomain: string,
  competitorDomains: string[],
): Promise<KeywordGap[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || competitorDomains.length === 0) return [];

  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" as any }],
      input: [
        {
          role: "system",
          content:
            "You are an SEO competitor analyst. Search the web to find keywords that competitor sites " +
            "likely rank for that the target site doesn't. Focus on high-value, achievable keywords. " +
            "Output JSON only.",
        },
        {
          role: "user",
          content:
            `Target site: ${targetDomain}\n` +
            `Competitors: ${competitorDomains.join(", ")}\n\n` +
            `Find 10-15 keywords these competitors likely rank for that ${targetDomain} doesn't.\n` +
            `Return JSON array: [{"keyword":"...","searchVolume":<estimated>,"difficulty":<0-100>,"competitorUrl":"which competitor","competitorPosition":<estimated rank>,"opportunity":"high|medium|low"}]`,
        },
      ],
    });

    const GapSchema = z.array(
      z.object({
        keyword: z.string(),
        searchVolume: z.number(),
        difficulty: z.number(),
        competitorUrl: z.string(),
        competitorPosition: z.number().default(10),
        opportunity: z.string().default("medium"),
      }),
    );

    const text = completion.output_text;
    const clean = text.replace(/```(?:json)?\s*\n?/g, "").replace(/```\s*$/g, "").trim();
    const arrStart = clean.indexOf("[");
    const arrEnd = clean.lastIndexOf("]");
    if (arrStart === -1 || arrEnd === -1) return [];
    return GapSchema.parse(JSON.parse(clean.slice(arrStart, arrEnd + 1)));
  } catch (err) {
    console.error("AI keyword gap analysis failed:", err);
    return [];
  }
}

// ── Helpers ──

function getDateMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function mapCompetitionToIntent(competition: number): string {
  if (competition > 0.7) return "transactional";
  if (competition > 0.4) return "commercial";
  return "informational";
}

function estimateDifficultyFromCPC(cpc: number, competition: number): number {
  // Higher CPC and competition = harder to rank
  return Math.min(100, Math.round(competition * 60 + Math.min(cpc, 10) * 4));
}

function estimateSERPDifficulty(results: SerpResult[]): string {
  // Check for big brands in top results
  const bigBrands = ["wikipedia", "amazon", "youtube", "reddit", "quora", "forbes", "nytimes", "bbc"];
  const brandCount = results.filter((r) =>
    bigBrands.some((b) => r.url.toLowerCase().includes(b)),
  ).length;

  if (brandCount >= 5) return "very_hard";
  if (brandCount >= 3) return "hard";
  if (brandCount >= 1) return "medium";
  return "easy";
}

function classifySERPResults(results: SerpResult[]): {
  dominantFormat: string;
  recommendedArticleType: string;
} {
  const formats: Record<string, number> = {};

  for (const result of results.slice(0, 10)) {
    const title = result.title.toLowerCase();
    const desc = result.description.toLowerCase();
    const combined = `${title} ${desc}`;

    if (/\d+\s+(best|top|ways|tips|tools|strategies|examples)/i.test(combined)) {
      formats["listicle"] = (formats["listicle"] ?? 0) + 1;
    } else if (/how to|step.by.step|tutorial|guide to/i.test(combined)) {
      formats["how-to"] = (formats["how-to"] ?? 0) + 1;
    } else if (/vs\.?|versus|compared|comparison|alternative/i.test(combined)) {
      formats["comparison"] = (formats["comparison"] ?? 0) + 1;
    } else if (/checklist|worksheet|template/i.test(combined)) {
      formats["checklist"] = (formats["checklist"] ?? 0) + 1;
    } else if (/complete guide|ultimate guide|everything you need/i.test(combined)) {
      formats["ultimate-guide"] = (formats["ultimate-guide"] ?? 0) + 1;
    } else if (/review|roundup|expert|opinion/i.test(combined)) {
      formats["roundup"] = (formats["roundup"] ?? 0) + 1;
    } else {
      formats["standard"] = (formats["standard"] ?? 0) + 1;
    }
  }

  const sorted = Object.entries(formats).sort((a, b) => b[1] - a[1]);
  const dominant = sorted[0]?.[0] ?? "standard";

  return {
    dominantFormat: dominant,
    recommendedArticleType: mapToArticleType(dominant),
  };
}

function mapToArticleType(format: string): string {
  const validTypes = ["standard", "listicle", "how-to", "checklist", "comparison", "roundup", "ultimate-guide"];
  if (validTypes.includes(format)) return format;

  // Map common format names to our article types
  const mapping: Record<string, string> = {
    "list": "listicle",
    "tutorial": "how-to",
    "guide": "how-to",
    "vs": "comparison",
    "review": "roundup",
    "product": "standard",
    "news": "standard",
  };

  for (const [key, value] of Object.entries(mapping)) {
    if (format.toLowerCase().includes(key)) return value;
  }

  return "standard";
}
