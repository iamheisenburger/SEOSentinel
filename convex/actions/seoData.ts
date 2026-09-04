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
import { orderDiscoveryByWinnability } from "../lib/winnableDiscovery.ts";
import { dataForSeoLanguageCode } from "../lib/dataForSeoLocale.ts";
import { topicDiscoverySeedBatches } from "../lib/autopilotBuffer.ts";
import { computeAuthorityKeywordDifficultyCeiling } from
  "../lib/authorityDifficulty.ts";
import { safeFetchPublicText } from "../lib/safeOutbound.ts";
import {
  CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT,
  CADENCE_MICRO_SEED_FALLBACK_DISCOVERY_ENDPOINT,
  CADENCE_MICRO_SEED_PROVIDER_SEED_LIMIT,
  CADENCE_MICRO_SEED_PROVIDER_TIMEOUT_MS,
  CADENCE_MICRO_SEED_RESULT_LIMIT,
  CADENCE_MICRO_SEED_TASK_COST_CEILING_USD,
} from "../lib/cadenceMicroSeed.ts";
import {
  DATAFORSEO_AUTHORITY_SOURCE,
  MAX_AUTHORITY_DOMAINS_PER_PLAN,
} from "../lib/expectedClickPortfolio.ts";
import {
  EXPECTED_CLICK_DEMAND_PROVIDER_ENDPOINT,
  normalizeExactDemandKeyword,
} from "../lib/expectedClickDemandBackfill.ts";

// ── Types ──

export interface KeywordMetrics {
  keyword: string;
  searchVolume: number; // monthly searches
  difficulty: number; // 0-100 keyword difficulty
  difficultyMeasured: boolean; // true only when DataForSEO returned SEO KD
  cpc: number; // cost per click USD
  competition: number; // 0-1 competition level
  intent: string; // informational | commercial | transactional | navigational
  trend: number[]; // last 12 months search volume trend
}

/**
 * Exact demand receipts intentionally keep ad-market fields optional.
 * DataForSEO can return measured search volume with null CPC or competition;
 * those nulls must not erase useful demand or be fabricated as numeric zero.
 */
export interface ExactKeywordDemandMetric {
  keyword: string;
  searchVolume: number;
  cpc?: number;
  competition?: number;
  trend: number[];
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
  difficultyMeasured: boolean;
  competitorUrl: string; // which competitor ranks for this
  competitorPosition: number;
  opportunity: string; // high | medium | low
}

export type KeywordDiscoveryRequest = (
  endpoint: string,
  body: any[],
) => Promise<any>;

export interface KeywordDiscoveryOptions {
  /**
   * Measured domain authority of the tenant. When present, discovery keeps the
   * candidates this tenant can realistically win instead of the highest-volume
   * head terms, which are owned by incumbents a weak domain cannot displace.
   */
  tenantAuthority?: number;
  targetDomain?: string;
  minimumResults?: number;
  maxGoogleAdsBatches?: number;
  maxLabsSeeds?: number;
  maxRelatedSeeds?: number;
  useKeywordIdeas?: boolean;
  /**
   * Broad Google Ads suggestions can return hundreds of high-volume but
   * semantically detached phrases. Verified autopilot planning needs the
   * product-anchored Labs and Ideas sources even when that broad result count
   * is already large. The additional requests remain bounded by the existing
   * batch/seed limits.
   */
  expandProductAnchors?: boolean;
  request?: KeywordDiscoveryRequest;
}

export interface CadenceMicroSeedKeywordMetric {
  keyword: string;
  searchVolume: number;
  difficulty: number;
  difficultyMeasured: true;
  cpc?: number;
  competition?: number;
  intent: string;
  trend: number[];
}

export interface CadenceMicroSeedDiscoveryReceipt {
  endpoint:
    | typeof CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT
    | typeof CADENCE_MICRO_SEED_FALLBACK_DISCOVERY_ENDPOINT;
  seed: string;
  seeds: string[];
  requestTag: string;
  locationCode: number;
  languageCode: string;
  resultLimit: number;
  providerTaskCostUsd: number;
  providerRowsReceived: number;
  providerRowsRejected: number;
  candidates: CadenceMicroSeedKeywordMetric[];
}

// ── DataForSEO API Client ──

function getDataForSEOCredentials(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

// SEO model calls in this module are advisory fallbacks or diagnostics. They
// must never own an article worker until the worker lease or Convex action
// deadline expires: doing so can strand an otherwise complete article at the
// content-scoring step. Keep one explicit, no-retry deadline for every such
// call and let the existing callers fall back conservatively on failure.
export const SEO_DIAGNOSTIC_OPENAI_TIMEOUT_MS = 45_000;

function createBoundedSeoDiagnosticOpenAI(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    timeout: SEO_DIAGNOSTIC_OPENAI_TIMEOUT_MS,
    maxRetries: 0,
  });
}

async function dataForSEORequest(
  endpoint: string,
  body: any[],
  timeoutMs = 20_000,
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
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`DataForSEO API error (HTTP ${response.status})`);
  }

  const data = await response.json();
  if (data.status_code !== 20000) {
    throw new Error(
      `DataForSEO response failed with status code ${data.status_code ?? "unknown"}`,
    );
  }

  const failedTask = (data.tasks ?? []).find(
    (task: { status_code?: number }) => task.status_code !== 20000,
  );
  if (failedTask) {
    throw new Error(
      `DataForSEO task failed with status code ${failedTask.status_code ?? "unknown"}`,
    );
  }

  return data;
}

/**
 * Deliberately small recovery discovery for an empty verified-topic buffer.
 *
 * DataForSEO Labs Live permits one task per request. We therefore issue at
 * most six concurrent single-seed calls and divide one aggregate row limit
 * between them. Primary recovery uses literal Suggestions; the sole fallback
 * uses the distinct Related Keywords graph. Both retain provider-measured
 * demand, difficulty, and intent, and neither can bypass live SERP, article
 * quality, publication, or live-verification gates.
 */
export async function discoverCadenceMicroSeedFromDataForSEO(
  seedOrSeeds: string | string[],
  locationCode: number = 2840,
  languageCode: string = "en",
  options: {
    request?: KeywordDiscoveryRequest;
    limit?: number;
    requestTag?: string;
    endpoint?:
      | typeof CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT
      | typeof CADENCE_MICRO_SEED_FALLBACK_DISCOVERY_ENDPOINT;
  } = {},
): Promise<CadenceMicroSeedDiscoveryReceipt> {
  if (!getDataForSEOCredentials() && !options.request) {
    throw new Error("DataForSEO credentials not configured");
  }
  const normalizedSeeds = [...new Set(
    (Array.isArray(seedOrSeeds) ? seedOrSeeds : [seedOrSeeds])
      .map((seed) => seed.trim().toLowerCase().replace(/\s+/g, " "))
      .filter(Boolean),
  )];
  if (
    normalizedSeeds.length < 1 ||
    normalizedSeeds.length > CADENCE_MICRO_SEED_PROVIDER_SEED_LIMIT ||
    normalizedSeeds.some((seed) => {
      const wordCount = seed.split(" ").filter(Boolean).length;
      return seed.length < 4 || seed.length > 200 ||
        wordCount < 2 || wordCount > 6;
    })
  ) {
    throw new Error("Cadence micro-seed is outside its bounded contract");
  }
  const normalizedSeed = normalizedSeeds[0]!;
  const requestedLimit = options.limit ?? CADENCE_MICRO_SEED_RESULT_LIMIT;
  if (
    !Number.isInteger(requestedLimit) || requestedLimit < 1 ||
    requestedLimit > CADENCE_MICRO_SEED_RESULT_LIMIT
  ) {
    throw new Error("Cadence micro-seed result limit is outside its contract");
  }
  const limit = requestedLimit;
  const requestTag = options.requestTag?.trim() ?? "";
  if (!requestTag || requestTag.length > 255) {
    throw new Error("Cadence micro-seed request tag is outside its contract");
  }
  const endpoint = options.endpoint ?? CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT;
  if (
    endpoint !== CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT &&
    endpoint !== CADENCE_MICRO_SEED_FALLBACK_DISCOVERY_ENDPOINT
  ) throw new Error("Cadence micro-seed provider endpoint is outside its contract");
  const request = options.request ?? ((providerEndpoint, body) =>
    dataForSEORequest(
      providerEndpoint,
      body,
      CADENCE_MICRO_SEED_PROVIDER_TIMEOUT_MS,
    ));
  languageCode = dataForSeoLanguageCode(languageCode);
  const functionName = endpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT
    ? "keyword_suggestions"
    : "related_keywords";
  const filter = endpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT
    ? ["keyword_info.search_volume", ">=", 10]
    : ["keyword_data.keyword_info.search_volume", ">=", 10];
  const orderBy = endpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT
    ? [
      "keyword_info.search_volume,desc",
      "keyword_properties.keyword_difficulty,asc",
    ]
    : [
      "keyword_data.keyword_info.search_volume,desc",
      "keyword_data.keyword_properties.keyword_difficulty,asc",
    ];
  const baseLimit = Math.floor(limit / normalizedSeeds.length);
  const remainder = limit % normalizedSeeds.length;
  const responses = await Promise.all(normalizedSeeds.map((seed, index) => {
    const taskLimit = baseLimit + (index < remainder ? 1 : 0);
    const taskTag = normalizedSeeds.length === 1
      ? requestTag
      : `${requestTag}-${index + 1}`;
    if (taskTag.length > 255 || taskLimit < 1) {
      throw new Error("Cadence micro-seed task partition is outside its contract");
    }
    const common = {
      keyword: seed,
      location_code: locationCode,
      language_code: languageCode,
      include_seed_keyword: false,
      include_serp_info: false,
      include_clickstream_data: false,
      tag: taskTag,
      filters: filter,
      order_by: orderBy,
      limit: taskLimit,
    };
    const body = endpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT
      ? { ...common, exact_match: false }
      : { ...common, depth: 2 };
    return request(endpoint, [body]).then((data) => ({
      data,
      seed,
      taskLimit,
      taskTag,
    }));
  }));

  const candidates: CadenceMicroSeedKeywordMetric[] = [];
  const seen = new Set<string>();
  let providerRowsRejected = 0;
  let providerRowsReceived = 0;
  let providerTaskCostUsd = 0;
  for (const response of responses) {
    const { data, seed, taskLimit, taskTag } = response;
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    if (
      data?.status_code !== 20_000 || data?.tasks_count !== 1 ||
      data?.tasks_error !== 0 || tasks.length !== 1
    ) throw new Error("Cadence micro-seed provider receipt is incompatible");
    const task = tasks[0];
    const taskData = task?.data;
    const expectedPath = [
      "v3", "dataforseo_labs", "google", functionName, "live",
    ];
    if (
      task?.status_code !== 20_000 || !taskData ||
      taskData.api !== "dataforseo_labs" ||
      taskData.function !== functionName || taskData.se_type !== "google" ||
      taskData.keyword !== seed || taskData.location_code !== locationCode ||
      taskData.language_code !== languageCode ||
      taskData.include_seed_keyword !== false ||
      taskData.include_serp_info !== false ||
      taskData.include_clickstream_data !== false ||
      taskData.tag !== taskTag || taskData.limit !== taskLimit ||
      JSON.stringify(taskData.filters) !== JSON.stringify(filter) ||
      JSON.stringify(taskData.order_by) !== JSON.stringify(orderBy) ||
      (endpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT
        ? taskData.exact_match !== false
        : taskData.depth !== 2) ||
      JSON.stringify(task?.path) !== JSON.stringify(expectedPath)
    ) throw new Error("Cadence micro-seed provider request echo is incompatible");
    const resultGroups = Array.isArray(task?.result) ? task.result : [];
    if (resultGroups.length !== 1) {
      throw new Error("Cadence micro-seed provider path is incompatible");
    }
    const resultGroup = resultGroups[0];
    if (
      resultGroup?.seed_keyword !== seed ||
      resultGroup?.location_code !== locationCode ||
      resultGroup?.language_code !== languageCode ||
      resultGroup?.se_type !== "google"
    ) throw new Error("Cadence micro-seed provider path is incompatible");
    const taskCost = task?.cost;
    const responseCost = data?.cost;
    if (
      typeof taskCost !== "number" || !Number.isFinite(taskCost) ||
      taskCost < 0 ||
      typeof responseCost !== "number" || !Number.isFinite(responseCost) ||
      responseCost < 0 || Math.abs(responseCost - taskCost) > 0.000001
    ) throw new Error("Cadence micro-seed provider cost exceeded its contract");
    providerTaskCostUsd += taskCost;
    if (
      providerTaskCostUsd >
        CADENCE_MICRO_SEED_TASK_COST_CEILING_USD + 0.000001
    ) throw new Error("Cadence micro-seed provider cost exceeded its contract");
    const items = Array.isArray(resultGroup?.items) ? resultGroup.items : [];
    if (
      items.length > taskLimit ||
      (resultGroup?.items_count !== undefined &&
        resultGroup.items_count !== items.length)
    ) throw new Error("Cadence micro-seed provider row limit exceeded");
    providerRowsReceived += items.length;
    if (providerRowsReceived > limit) {
      throw new Error("Cadence micro-seed provider row limit exceeded");
    }
    for (const item of items) {
      const metric = endpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT
        ? item
        : item?.keyword_data;
      const keyword = typeof metric?.keyword === "string"
        ? metric.keyword.trim().toLowerCase().replace(/\s+/g, " ")
        : "";
      const searchVolume = metric?.keyword_info?.search_volume;
      const difficulty = metric?.keyword_properties?.keyword_difficulty;
      const cpcValue = metric?.keyword_info?.cpc;
      const competitionValue = metric?.keyword_info?.competition;
      const intentValue = metric?.search_intent_info?.main_intent;
      const monthlySearches = metric?.keyword_info?.monthly_searches;
      if (
        !keyword || keyword.length > 700 || seen.has(keyword) ||
        typeof searchVolume !== "number" || !Number.isFinite(searchVolume) ||
        searchVolume <= 0 || typeof difficulty !== "number" ||
        !Number.isFinite(difficulty) || difficulty < 0 || difficulty > 100 ||
        (item?.se_type !== undefined && item.se_type !== "google") ||
        (metric?.se_type !== undefined && metric.se_type !== "google") ||
        metric?.location_code !== locationCode ||
        metric?.language_code !== languageCode ||
        (cpcValue !== null && cpcValue !== undefined &&
          (typeof cpcValue !== "number" || !Number.isFinite(cpcValue) ||
            cpcValue < 0)) ||
        (competitionValue !== null && competitionValue !== undefined &&
          (typeof competitionValue !== "number" ||
            !Number.isFinite(competitionValue) || competitionValue < 0 ||
            competitionValue > 1)) ||
        typeof intentValue !== "string" ||
        !["informational", "commercial", "transactional", "navigational"]
          .includes(intentValue.trim().toLowerCase()) ||
        (monthlySearches !== null && monthlySearches !== undefined &&
          !Array.isArray(monthlySearches))
      ) {
        providerRowsRejected += 1;
        continue;
      }
      const trend: number[] = [];
      let trendCompatible = true;
      for (const month of Array.isArray(monthlySearches)
        ? monthlySearches.slice(0, 12)
        : []) {
        const value = month && typeof month === "object"
          ? (month as { search_volume?: unknown }).search_volume
          : undefined;
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          trendCompatible = false;
          break;
        }
        trend.push(value);
      }
      if (!trendCompatible) {
        providerRowsRejected += 1;
        continue;
      }
      seen.add(keyword);
      candidates.push({
        keyword,
        searchVolume,
        difficulty,
        difficultyMeasured: true,
        ...(typeof cpcValue === "number" ? { cpc: cpcValue } : {}),
        ...(typeof competitionValue === "number"
          ? { competition: competitionValue }
          : {}),
        intent: intentValue.trim().toLowerCase(),
        trend,
      });
    }
  }
  return {
    endpoint,
    seed: normalizedSeed,
    seeds: normalizedSeeds,
    requestTag,
    locationCode,
    languageCode,
    resultLimit: limit,
    providerTaskCostUsd,
    providerRowsReceived,
    providerRowsRejected,
    candidates,
  };
}

// ── Domain Authority ──

export interface DomainMetrics {
  domainRank: number; // 0-100 (DataForSEO rank, comparable to Ahrefs DR)
  organicTraffic: number; // estimated monthly organic traffic
  backlinks: number; // total backlinks count
  referringDomains: number; // unique referring domains
}

export interface DomainAuthorityEvidence extends DomainMetrics {
  domain: string;
  source: typeof DATAFORSEO_AUTHORITY_SOURCE;
  measuredAt: number;
}

function authorityDomain(value: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname
      .toLowerCase()
      .replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * Measure a bounded, deduplicated domain set on DataForSEO's explicit
 * one-hundred rank scale. The Bulk Pages Summary Live endpoint accepts up to
 * 1,000 targets in one task (and at most 100 root domains). Pentra intentionally
 * caps this much lower at 50 targets and sends exactly one billable task.
 */
export async function getDomainAuthorities(
  domains: string[],
  options: {
    request?: KeywordDiscoveryRequest;
    measuredAt?: number;
    maxDomains?: number;
  } = {},
): Promise<DomainAuthorityEvidence[]> {
  const creds = getDataForSEOCredentials();
  if (!creds && !options.request) return [];
  const maximum = Math.max(
    1,
    Math.min(
      options.maxDomains ?? MAX_AUTHORITY_DOMAINS_PER_PLAN,
      MAX_AUTHORITY_DOMAINS_PER_PLAN,
    ),
  );
  const targets = [...new Set(
    domains.map(authorityDomain).filter((domain): domain is string => Boolean(domain)),
  )].slice(0, maximum);
  if (targets.length === 0) return [];
  const request = options.request ?? dataForSEORequest;
  const measuredAt = options.measuredAt ?? Date.now();
  const data = await request(
    "backlinks/bulk_pages_summary/live",
    [{
      targets,
      include_subdomains: true,
      rank_scale: "one_hundred",
    }],
  );

  const evidence: DomainAuthorityEvidence[] = [];
  const items = data.tasks?.[0]?.result?.[0]?.items ?? [];
  for (const item of items) {
    const domain = authorityDomain(item.url ?? item.target ?? "");
    if (!domain || !targets.includes(domain) || typeof item.main_domain_rank !== "number") {
      continue;
    }
    evidence.push({
      domain,
      domainRank: item.main_domain_rank,
      organicTraffic: 0,
      backlinks: item.backlinks ?? 0,
      referringDomains: item.referring_domains ?? 0,
      source: DATAFORSEO_AUTHORITY_SOURCE,
      measuredAt,
    });
  }
  return evidence.filter(
    (item, index, all) => all.findIndex((other) => other.domain === item.domain) === index,
  );
}

/**
 * Get domain authority metrics from DataForSEO.
 * Returns null if API unavailable or domain has no data.
 */
export async function getDomainAuthority(
  domain: string,
): Promise<DomainAuthorityEvidence | null> {
  try {
    const [evidence] = await getDomainAuthorities([domain], { maxDomains: 1 });
    return evidence ?? null;
  } catch (err) {
    console.log(`Domain authority lookup failed for ${authorityDomain(domain) ?? domain}:`, err);
    return null;
  }
}

/**
 * Compute a recommended max KD ceiling based on domain metrics.
 * Low-authority domains should target low-difficulty keywords.
 * Returns a number 0-100.
 */
export function computeMaxKD(metrics: DomainMetrics | null): number {
  return computeAuthorityKeywordDifficultyCeiling(metrics);
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

/**
 * One-call provider-only demand measurement for an exact, already-selected
 * keyword batch. This deliberately omits the second difficulty request and
 * has no AI fallback, making a durable attempt receipt sufficient to prevent
 * accidental replay after an ambiguous response.
 */
export async function getExactKeywordDemandFromDataForSEO(
  keywords: string[],
  locationCode: number = 2840,
  languageCode: string = "en",
  options: { request?: KeywordDiscoveryRequest } = {},
): Promise<ExactKeywordDemandMetric[]> {
  if (!getDataForSEOCredentials() && !options.request) {
    throw new Error("DataForSEO credentials not configured");
  }
  const exactKeywords = keywords.map((keyword) => keyword.trim());
  const normalizedKeywords = exactKeywords.map(normalizeExactDemandKeyword);
  if (
    exactKeywords.length === 0 ||
    exactKeywords.length > 10 ||
    exactKeywords.some((keyword) => !keyword || keyword.length > 700) ||
    new Set(normalizedKeywords).size !== normalizedKeywords.length
  ) {
    throw new Error("Exact keyword demand batch is outside its bounded contract");
  }
  const request = options.request ?? dataForSEORequest;
  languageCode = dataForSeoLanguageCode(languageCode);
  const data = await request(
    EXPECTED_CLICK_DEMAND_PROVIDER_ENDPOINT,
    [{
      keywords: exactKeywords,
      location_code: locationCode,
      language_code: languageCode,
      date_from: getDateMonthsAgo(12),
    }],
  );

  const requestedKeywords = new Set(normalizedKeywords);
  const results: ExactKeywordDemandMetric[] = [];
  const tasks: unknown = data?.tasks;
  if (!Array.isArray(tasks)) return results;

  for (const task of tasks) {
    if (!isUnknownRecord(task) || !Array.isArray(task.result)) continue;
    for (const item of task.result) {
      if (!isUnknownRecord(item) || typeof item.keyword !== "string") continue;
      const keyword = item.keyword.trim();
      if (!keyword || !requestedKeywords.has(normalizeExactDemandKeyword(keyword))) {
        continue;
      }
      const searchVolume = finiteNonnegativeNumber(item.search_volume);
      if (searchVolume === undefined) continue;

      const cpc = finiteNonnegativeNumber(item.cpc);
      const competitionIndex = finiteBoundedNumber(
        item.competition_index,
        0,
        100,
      );
      const metric: ExactKeywordDemandMetric = {
        keyword,
        searchVolume,
        trend: exactMonthlySearchTrend(item.monthly_searches),
      };
      if (cpc !== undefined) metric.cpc = cpc;
      if (competitionIndex !== undefined) {
        metric.competition = competitionIndex / 100;
      }
      results.push(metric);
    }
  }

  return results;
}

async function getKeywordSearchVolumeFromAPI(
  keywords: string[],
  locationCode: number,
  languageCode: string,
  request: KeywordDiscoveryRequest = dataForSEORequest,
): Promise<KeywordMetrics[]> {
  languageCode = dataForSeoLanguageCode(languageCode);
  // Use Keywords Data API - Google Ads Search Volume
  const data = await request(
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
        difficultyMeasured: false,
        cpc: item.cpc ?? 0,
        competition: item.competition ?? 0,
        intent: mapCompetitionToIntent(item.competition ?? 0),
        trend: monthlySearches,
      });
    }
  }

  return results;
}

async function getKeywordMetricsFromAPI(
  keywords: string[],
  locationCode: number,
  languageCode: string,
): Promise<KeywordMetrics[]> {
  const results = await getKeywordSearchVolumeFromAPI(
    keywords,
    locationCode,
    languageCode,
  );
  languageCode = dataForSeoLanguageCode(languageCode);

  // Enrich with real keyword difficulty scores (DataForSEO Labs)
  if (results.length > 0) {
    try {
      const difficultyData = await dataForSEORequest(
        "dataforseo_labs/google/bulk_keyword_difficulty/live",
        [{
          keywords: keywords.slice(0, 1000),
          location_code: locationCode,
          language_code: languageCode,
        }],
      );

      for (const task of difficultyData.tasks ?? []) {
        for (const resultGroup of task.result ?? []) {
          for (const item of resultGroup.items ?? []) {
            const match = results.find(
              (r) => r.keyword.toLowerCase() === (item.keyword ?? "").toLowerCase(),
            );
            if (match && typeof item.keyword_difficulty === "number") {
              match.difficulty = item.keyword_difficulty;
              match.difficultyMeasured = true;
            }
          }
        }
      }
    } catch (err) {
      console.error("Bulk keyword difficulty failed, falling back to competition index:", err);
      for (const r of results) {
        if (r.difficulty === 0) {
          r.difficulty = estimateDifficultyFromCPC(r.cpc, r.competition);
        }
      }
    }
  }

  return results;
}

/**
 * Discover real keywords with volume using DataForSEO keyword suggestions.
 * Takes seed keywords and returns related keywords that people actually search for.
 * Returns up to `limit` keywords sorted by search volume descending.
 */
export async function discoverKeywords(
  seedKeywords: string[],
  locationCode: number = 2840,
  languageCode: string = "en",
  limit: number = 50,
  options: KeywordDiscoveryOptions = {},
): Promise<KeywordMetrics[]> {
  languageCode = dataForSeoLanguageCode(languageCode);
  const creds = getDataForSEOCredentials();
  if (!creds && !options.request) return []; // No DataForSEO = no discovery

  const request = options.request ?? dataForSEORequest;
  const resultsByKeyword = new Map<string, KeywordMetrics>();
  const productExpandedKeywords = new Set<string>();
  const sourceErrors: string[] = [];
  const minimumResults = Math.max(
    1,
    Math.min(limit, options.minimumResults ?? 20),
  );
  const targetResults = Math.max(minimumResults, Math.min(limit, 40));

  const mergeResult = (candidate: KeywordMetrics) => {
    const key = candidate.keyword.trim().toLowerCase();
    if (!key || candidate.searchVolume <= 0) return;
    const existing = resultsByKeyword.get(key);
    if (!existing) {
      resultsByKeyword.set(key, candidate);
      return;
    }
    resultsByKeyword.set(key, {
      ...existing,
      searchVolume: Math.max(existing.searchVolume, candidate.searchVolume),
      difficulty: candidate.difficultyMeasured
        ? candidate.difficulty
        : existing.difficulty,
      difficultyMeasured:
        candidate.difficultyMeasured || existing.difficultyMeasured,
      cpc: Math.max(existing.cpc, candidate.cpc),
      competition: Math.max(existing.competition, candidate.competition),
      intent: candidate.intent || existing.intent,
      trend: candidate.trend.length > 0 ? candidate.trend : existing.trend,
    });
  };

  const googleAdsResults = (data: any): KeywordMetrics[] => {
    const parsed: KeywordMetrics[] = [];
    for (const task of data.tasks ?? []) {
      for (const item of task.result ?? []) {
        if (!item.keyword || !item.search_volume) continue;
        const monthlySearches = (item.monthly_searches ?? [])
          .slice(0, 12)
          .map((month: any) => month.search_volume ?? 0);
        const competition = typeof item.competition_index === "number"
          ? item.competition_index / 100
          : typeof item.competition === "number"
            ? item.competition
            : 0;
        parsed.push({
          keyword: item.keyword,
          searchVolume: item.search_volume,
          difficulty: 0,
          difficultyMeasured: false,
          cpc: item.cpc ?? 0,
          competition,
          intent: mapCompetitionToIntent(competition),
          trend: monthlySearches,
        });
      }
    }
    return parsed;
  };

  const labsResults = (data: any): KeywordMetrics[] => {
    const parsed: KeywordMetrics[] = [];
    for (const task of data.tasks ?? []) {
      for (const resultGroup of task.result ?? []) {
        for (const item of resultGroup.items ?? []) {
          const info = item.keyword_info ?? {};
          if (!item.keyword || !info.search_volume) continue;
          const competition = typeof info.competition_level === "number"
            ? info.competition_level
            : typeof info.competition === "number"
              ? info.competition
              : 0;
          const measuredDifficulty =
            typeof item.keyword_properties?.keyword_difficulty === "number";
          parsed.push({
            keyword: item.keyword,
            searchVolume: info.search_volume,
            difficulty: measuredDifficulty
              ? item.keyword_properties.keyword_difficulty
              : 0,
            difficultyMeasured: measuredDifficulty,
            cpc: info.cpc ?? 0,
            competition,
            intent:
              item.search_intent_info?.main_intent ??
              mapCompetitionToIntent(competition),
            trend: (info.monthly_searches ?? [])
              .slice(0, 12)
              .map((month: any) => month.search_volume ?? 0),
          });
        }
      }
    }
    return parsed;
  };

  const relatedKeywordResults = (data: any): KeywordMetrics[] => {
    const parsed: KeywordMetrics[] = [];
    for (const task of data.tasks ?? []) {
      for (const resultGroup of task.result ?? []) {
        for (const item of resultGroup.items ?? []) {
          const keywordData = item.keyword_data ?? {};
          const info = keywordData.keyword_info ?? {};
          if (!keywordData.keyword || !info.search_volume) continue;
          const measuredDifficulty =
            typeof keywordData.keyword_properties?.keyword_difficulty === "number";
          parsed.push({
            keyword: keywordData.keyword,
            searchVolume: info.search_volume,
            difficulty: measuredDifficulty
              ? keywordData.keyword_properties.keyword_difficulty
              : 0,
            difficultyMeasured: measuredDifficulty,
            cpc: info.cpc ?? 0,
            competition: typeof info.competition === "number"
              ? info.competition
              : 0,
            intent:
              keywordData.search_intent_info?.main_intent ??
              mapCompetitionToIntent(info.competition ?? 0),
            trend: (info.monthly_searches ?? [])
              .slice(0, 12)
              .map((month: any) => month.search_volume ?? 0),
          });
        }
      }
    }
    return parsed;
  };

  // Google Ads accepts up to twenty seeds, but a single heterogeneous request
  // can collapse to one suggestion. Use a bounded set of smaller requests so
  // one weak seed cluster does not starve the strict planner.
  const seeds = [...new Set(seedKeywords.map((seed) => seed.trim()).filter(Boolean))].slice(0, 20);
  if (seeds.length === 0) return [];

  const batches = topicDiscoverySeedBatches(
    seeds,
    5,
    options.maxGoogleAdsBatches ?? 3,
  );
  let googleAdsCount = 0;
  for (const batch of batches) {
    try {
      const data = await request(
        "keywords_data/google_ads/keywords_for_keywords/live",
        [{
          keywords: batch,
          location_code: locationCode,
          language_code: languageCode,
          sort_by: "search_volume",
        }],
      );
      const parsed = googleAdsResults(data);
      googleAdsCount += parsed.length;
      parsed.forEach(mergeResult);
    } catch (error) {
      sourceErrors.push(
        `Google Ads suggestions: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
    if (
      resultsByKeyword.size >= targetResults &&
      options.expandProductAnchors !== true
    ) break;
  }

  // When Google Ads is sparse, DataForSEO Labs expands individual business
  // anchors into long-tail suggestions and includes difficulty in the result.
  let labsCount = 0;
  if (
    resultsByKeyword.size < minimumResults ||
    options.expandProductAnchors === true
  ) {
    const genericSeedWords = new Set([
      "agent", "ai", "business", "marketing", "online", "page", "sales",
      "site", "software", "tool", "website",
    ]);
    const eligibleLabsSeeds = seeds.filter((seed) => {
      if (/^how to\b/i.test(seed)) return false;
      const words = seed.toLowerCase().split(/\s+/).filter(Boolean);
      return (
        words.length >= 2 &&
        words.length <= 6 &&
        words.some((word) => !genericSeedWords.has(word))
      );
    });
    const labsSeeds = (
      eligibleLabsSeeds.length > 0 ? eligibleLabsSeeds : seeds
    ).slice(0, options.maxLabsSeeds ?? 2);
    for (const seed of labsSeeds) {
      try {
        const data = await request(
          "dataforseo_labs/google/keyword_suggestions/live",
          [{
            keyword: seed,
            location_code: locationCode,
            language_code: languageCode,
            include_seed_keyword: true,
            include_serp_info: false,
            filters: ["keyword_info.search_volume", ">=", 10],
            order_by: ["keyword_info.search_volume,desc"],
            limit: Math.min(limit, 100),
          }],
        );
        const parsed = labsResults(data);
        labsCount += parsed.length;
        parsed.forEach((candidate) => {
          productExpandedKeywords.add(candidate.keyword.trim().toLowerCase());
          mergeResult(candidate);
        });
      } catch (error) {
        sourceErrors.push(
          `Labs suggestions for "${seed}": ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
      if (
        resultsByKeyword.size >= targetResults &&
        options.expandProductAnchors !== true
      ) break;
    }
  }

  // Literal suggestions miss adjacent language that searchers use. Google's
  // own "searches related to" graph supplies that vocabulary while staying
  // anchored to a tenant-provided phrase. Depth two is capped at 72 results
  // and the number of paid requests is explicitly bounded per plan.
  let relatedCount = 0;
  const relatedSeedLimit = Math.max(0, options.maxRelatedSeeds ?? 0);
  if (
    relatedSeedLimit > 0 &&
    (resultsByKeyword.size < minimumResults ||
      options.expandProductAnchors === true)
  ) {
    const relatedSeeds = seeds
      .filter((seed) => {
        const wordCount = seed.split(/\s+/).filter(Boolean).length;
        return wordCount >= 2 && wordCount <= 6;
      })
      .slice(0, relatedSeedLimit);
    for (const seed of relatedSeeds) {
      try {
        const data = await request(
          "dataforseo_labs/google/related_keywords/live",
          [{
            keyword: seed,
            location_code: locationCode,
            language_code: languageCode,
            depth: 2,
            include_seed_keyword: true,
            include_serp_info: false,
            filters: ["keyword_data.keyword_info.search_volume", ">=", 10],
            order_by: ["keyword_data.keyword_info.search_volume,desc"],
            limit: Math.min(limit, 72),
          }],
        );
        const parsed = relatedKeywordResults(data);
        relatedCount += parsed.length;
        parsed.forEach((candidate) => {
          productExpandedKeywords.add(candidate.keyword.trim().toLowerCase());
          mergeResult(candidate);
        });
      } catch (error) {
        sourceErrors.push(
          `Related keywords for "${seed}": ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
  }

  // Keyword Ideas is category-based rather than literal phrase matching. It
  // expands several product/problem anchors in one bounded request and is a
  // better recovery source than broad domain suggestions for young sites.
  let keywordIdeasCount = 0;
  if (
    (resultsByKeyword.size < minimumResults ||
      options.expandProductAnchors === true) &&
    options.useKeywordIdeas !== false
  ) {
    try {
      const data = await request(
        "dataforseo_labs/google/keyword_ideas/live",
        [{
          keywords: seeds,
          location_code: locationCode,
          language_code: languageCode,
          closely_variants: false,
          include_serp_info: false,
          filters: ["keyword_info.search_volume", ">=", 10],
          order_by: [
            "relevance,desc",
            "keyword_info.search_volume,desc",
          ],
          limit: Math.min(limit, 200),
        }],
      );
      const parsed = labsResults(data);
      keywordIdeasCount += parsed.length;
      parsed.forEach((candidate) => {
        productExpandedKeywords.add(candidate.keyword.trim().toLowerCase());
        mergeResult(candidate);
      });
    } catch (error) {
      sourceErrors.push(
        `Labs keyword ideas: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  // A site-based request is the final bounded fallback. It remains tied to the
  // tenant's actual business rather than inventing unverified AI keywords.
  let siteCount = 0;
  if (resultsByKeyword.size < minimumResults && options.targetDomain) {
    const target = options.targetDomain
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "");
    if (target) {
      try {
        const data = await request(
          "keywords_data/google_ads/keywords_for_site/live",
          [{
            target,
            target_type: "site",
            location_code: locationCode,
            language_code: languageCode,
            sort_by: "search_volume",
          }],
        );
        const parsed = googleAdsResults(data);
        siteCount += parsed.length;
        parsed.forEach(mergeResult);
      } catch (error) {
        sourceErrors.push(
          `Site suggestions for "${target}": ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
  }

  if (resultsByKeyword.size === 0 && sourceErrors.length > 0) {
    throw new Error(sourceErrors.join(" | "));
  }

  // Truncation is unavoidable, so this ordering decides what the tenant ever
  // gets to publish. Ranking by raw volume keeps exactly the head terms an
  // incumbent owns and discards the long tail a weak domain can win, which is
  // how a rank-4 tenant ended up with 205 topics and no reachable SERP.
  const discovered = [...resultsByKeyword.values()];
  const byWinnability = typeof options.tenantAuthority === "number"
    ? orderDiscoveryByWinnability(options.tenantAuthority, discovered)
    : discovered.slice().sort((a, b) => b.searchVolume - a.searchVolume);
  const topResults = byWinnability
    .sort((a, b) => {
      if (options.expandProductAnchors === true) {
        const productDelta =
          Number(productExpandedKeywords.has(b.keyword.trim().toLowerCase())) -
          Number(productExpandedKeywords.has(a.keyword.trim().toLowerCase()));
        if (productDelta !== 0) return productDelta;
      }
      return 0;
    })
    .slice(0, limit);
  console.log(
    `Keyword discovery sources: Google Ads=${googleAdsCount}, Labs=${labsCount}, related=${relatedCount}, ideas=${keywordIdeasCount}, site=${siteCount}, unique=${topResults.length}` +
      (sourceErrors.length > 0 ? `, recoverable errors=${sourceErrors.length}` : ""),
  );

  // Enrich with real keyword difficulty
  if (topResults.length > 0) {
    try {
      const difficultyData = await request(
        "dataforseo_labs/google/bulk_keyword_difficulty/live",
        [{
          keywords: topResults.map(r => r.keyword),
          location_code: locationCode,
          language_code: languageCode,
        }],
      );

      for (const task of difficultyData.tasks ?? []) {
        for (const resultGroup of task.result ?? []) {
          for (const item of resultGroup.items ?? []) {
            const match = topResults.find(
              r => r.keyword.toLowerCase() === (item.keyword ?? "").toLowerCase(),
            );
            if (match && typeof item.keyword_difficulty === "number") {
              match.difficulty = item.keyword_difficulty;
              match.difficultyMeasured = true;
            }
          }
        }
      }
    } catch (err) {
      console.error("Keyword difficulty enrichment failed:", err);
    }
  }

  return topResults;
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
      difficultyMeasured: false,
      cpc: 0,
      competition: 0.5,
      intent: "informational",
      trend: [],
    }));
  }

  const client = createBoundedSeoDiagnosticOpenAI(apiKey);

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
      difficultyMeasured: false,
      trend: [],
    }));
  } catch (err) {
    console.error("AI keyword estimation failed:", err);
    return keywords.map((kw) => ({
      keyword: kw,
      searchVolume: 0,
      difficulty: 50,
      difficultyMeasured: false,
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

/**
 * Provider-only SERP measurement for paid evidence migrations.
 *
 * Unlike the interactive analysis helper above, this function never falls
 * back to a model. A missing provider credential must stop the evidence job;
 * an AI reconstruction is not a live top-ten receipt and would also violate
 * the backfill's no-model call budget.
 */
export async function analyzeSERPFromDataForSEO(
  keyword: string,
  locationCode: number = 2840,
  languageCode: string = "en",
): Promise<SerpAnalysis> {
  if (!getDataForSEOCredentials()) {
    throw new Error("DataForSEO credentials not configured");
  }
  return analyzeSERPFromAPI(keyword, locationCode, languageCode);
}

async function analyzeSERPFromAPI(
  keyword: string,
  locationCode: number,
  languageCode: string,
): Promise<SerpAnalysis> {
  languageCode = dataForSeoLanguageCode(languageCode);
  const data = await dataForSEORequest(
    "serp/google/organic/live/regular",
    [{
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      depth: 10,
    }],
    // A live organic SERP can legitimately take longer than lightweight Labs
    // endpoints. This is still one attempt and one provider call: only its
    // response window is widened so a slow task is not misreported as empty
    // evidence and never retried implicitly here.
    45_000,
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

  const client = createBoundedSeoDiagnosticOpenAI(apiKey);

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

  const client = createBoundedSeoDiagnosticOpenAI(apiKey);

  // Fetch content from top 3 SERP results for comparison
  const competitorContent: string[] = [];
  for (const result of serpResults.slice(0, 3)) {
    if (!result.url) continue;
    try {
      const { text: html } = await safeFetchPublicText(result.url, {
        timeoutMs: 5_000,
        maxBytes: 500_000,
        sameHostRedirects: true,
        allowedContentTypes: [
          /^text\/(?:html|plain)(?:;|$)/i,
          /^application\/xhtml\+xml(?:;|$)/i,
        ],
      });
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);
      competitorContent.push(`[${result.title}]: ${text}`);
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
  languageCode = dataForSeoLanguageCode(languageCode);
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
              // Google Ads competition is not organic keyword difficulty.
              difficultyMeasured: false,
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

  const client = createBoundedSeoDiagnosticOpenAI(apiKey);

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
    return GapSchema.parse(JSON.parse(clean.slice(arrStart, arrEnd + 1))).map(
      (gap) => ({ ...gap, difficultyMeasured: false }),
    );
  } catch (err) {
    console.error("AI keyword gap analysis failed:", err);
    return [];
  }
}

// ── Helpers ──

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNonnegativeNumber(value: unknown): number | undefined {
  return finiteBoundedNumber(value, 0, Number.MAX_VALUE);
}

function finiteBoundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
      Number.isFinite(value) &&
      value >= minimum &&
      value <= maximum
    ? value
    : undefined;
}

/**
 * Null or malformed monthly rows are omitted rather than rewritten as zero.
 * A literal numeric zero remains valid evidence for that month.
 */
function exactMonthlySearchTrend(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const trend: number[] = [];
  for (const month of value.slice(0, 12)) {
    if (!isUnknownRecord(month)) continue;
    const searchVolume = finiteNonnegativeNumber(month.search_volume);
    if (searchVolume !== undefined) trend.push(searchVolume);
  }
  return trend;
}

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
    const url = result.url.toLowerCase();
    const combined = `${title} ${desc} ${url}`;
    // Top 3 results get double weight
    const weight = result.position <= 3 ? 2 : 1;

    // Listicle signals
    if (/\d+\s*(best|top|ways|tips|tools|strategies|examples|ideas|reasons|benefits|things|picks|favorites|resources)/i.test(combined) ||
        /\blist\b|curated|ranked|ranking/i.test(combined) ||
        /\/\d+-|\/best-|\/top-/i.test(url)) {
      formats["listicle"] = (formats["listicle"] ?? 0) + weight;
    }

    // How-to signals
    if (/how to|step[\s-]by[\s-]step|tutorial|guide to|beginner|getting started|learn to|walkthrough/i.test(combined) ||
        /\/how-to-|\/tutorial|\/guide-/i.test(url)) {
      formats["how-to"] = (formats["how-to"] ?? 0) + weight;
    }

    // Comparison signals
    if (/\bvs\.?\b|versus|compared|comparison|alternative|differ|better than/i.test(combined) ||
        /\/.*-vs-|\/compare|\/alternative/i.test(url)) {
      formats["comparison"] = (formats["comparison"] ?? 0) + weight;
    }

    // Checklist signals
    if (/checklist|worksheet|template|printable|download.*free/i.test(combined) ||
        /\/checklist|\/template/i.test(url)) {
      formats["checklist"] = (formats["checklist"] ?? 0) + weight;
    }

    // Ultimate guide signals
    if (/complete guide|ultimate guide|everything you need|definitive guide|comprehensive|in-depth|a-to-z|101\b/i.test(combined) ||
        /\/ultimate-|\/complete-guide|\/definitive/i.test(url)) {
      formats["ultimate-guide"] = (formats["ultimate-guide"] ?? 0) + weight;
    }

    // Roundup signals
    if (/review|roundup|expert|opinion|what.*think|according to|insights from/i.test(combined) ||
        /\/review|\/roundup/i.test(url)) {
      formats["roundup"] = (formats["roundup"] ?? 0) + weight;
    }
  }

  const sorted = Object.entries(formats).sort((a, b) => b[1] - a[1]);
  // Only use a non-standard format if it has meaningful signal (2+ weighted votes)
  const dominant = sorted[0] && sorted[0][1] >= 2 ? sorted[0][0] : "standard";

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
