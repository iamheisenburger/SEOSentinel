import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  computeMaxKD,
  discoverKeywords,
  type KeywordDiscoveryRequest,
} from "../convex/actions/seoData.ts";

test("keyword difficulty ceiling is bounded by both authority and referring domains", () => {
  assert.equal(computeMaxKD(null), 15);
  assert.equal(computeMaxKD({
    domainRank: 27,
    organicTraffic: 0,
    backlinks: 8,
    referringDomains: 8,
  }), 15);
  assert.equal(computeMaxKD({
    domainRank: 45,
    organicTraffic: 0,
    backlinks: 500,
    referringDomains: 80,
  }), 40);
  assert.equal(computeMaxKD({
    domainRank: 75,
    organicTraffic: 10_000,
    backlinks: 20_000,
    referringDomains: 800,
  }), 70);
});

test("sparse Google Ads discovery falls back to verified Labs suggestions", async () => {
  const endpoints: string[] = [];
  const request: KeywordDiscoveryRequest = async (endpoint, body) => {
    endpoints.push(endpoint);
    if (endpoint === "keywords_data/google_ads/keywords_for_keywords/live") {
      return {
        tasks: [{
          result: [{
            keyword: "website chatbot",
            search_volume: 90,
            cpc: 2.5,
            competition_index: 30,
            monthly_searches: [],
          }],
        }],
      };
    }
    if (endpoint === "dataforseo_labs/google/keyword_suggestions/live") {
      return {
        tasks: [{
          result: [{
            items: Array.from({ length: 8 }, (_, index) => ({
              keyword: `lead qualification workflow ${index}`,
              keyword_info: {
                search_volume: 100 + index,
                cpc: 3,
                competition: 0.25,
                monthly_searches: [],
              },
              keyword_properties: { keyword_difficulty: 18 + index },
              search_intent_info: { main_intent: "commercial" },
            })),
          }],
        }],
      };
    }
    if (endpoint === "dataforseo_labs/google/bulk_keyword_difficulty/live") {
      return {
        tasks: [{
          result: [{
            items: body[0].keywords.map((keyword: string) => ({
              keyword,
              keyword_difficulty: 20,
            })),
          }],
        }],
      };
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };

  const results = await discoverKeywords(
    [
      "website chatbot",
      "lead qualification",
      "visitor engagement",
      "website conversion",
      "sales automation",
      "customer questions",
    ],
    2840,
    "en",
    20,
    {
      minimumResults: 5,
      maxGoogleAdsBatches: 2,
      maxLabsSeeds: 1,
      targetDomain: "leadpilot.chat",
      request,
    },
  );

  assert.equal(
    endpoints.filter(
      (endpoint) =>
        endpoint === "keywords_data/google_ads/keywords_for_keywords/live",
    ).length,
    2,
  );
  assert.ok(
    endpoints.includes("dataforseo_labs/google/keyword_suggestions/live"),
  );
  assert.ok(
    endpoints.includes("dataforseo_labs/google/bulk_keyword_difficulty/live"),
  );
  assert.ok(results.length >= 9);
  assert.ok(results.every((result) => result.searchVolume > 0));
  assert.ok(results.every((result) => result.difficulty === 20));
  assert.ok(results.every((result) => result.difficultyMeasured));
});

test("verified discovery expands product anchors even when broad suggestions are plentiful", async () => {
  const endpoints: string[] = [];
  const request: KeywordDiscoveryRequest = async (endpoint, body) => {
    endpoints.push(endpoint);
    if (endpoint === "keywords_data/google_ads/keywords_for_keywords/live") {
      return {
        tasks: [{
          result: Array.from({ length: 50 }, (_, index) => ({
            keyword: `broad business phrase ${index}`,
            search_volume: 100 + index,
            cpc: 1,
            competition_index: 20,
            monthly_searches: [],
          })),
        }],
      };
    }
    if (endpoint === "dataforseo_labs/google/keyword_suggestions/live") {
      return {
        tasks: [{
          result: [{
            items: [{
              keyword: "website visitor qualification",
              keyword_info: {
                search_volume: 90,
                cpc: 4,
                competition: 0.3,
                monthly_searches: [],
              },
              keyword_properties: { keyword_difficulty: 8 },
              search_intent_info: { main_intent: "commercial" },
            }],
          }],
        }],
      };
    }
    if (endpoint === "dataforseo_labs/google/keyword_ideas/live") {
      return { tasks: [{ result: [{ items: [] }] }] };
    }
    if (endpoint === "dataforseo_labs/google/bulk_keyword_difficulty/live") {
      return {
        tasks: [{
          result: [{
            items: body[0].keywords.map((keyword: string) => ({
              keyword,
              keyword_difficulty: keyword === "website visitor qualification" ? 8 : 20,
            })),
          }],
        }],
      };
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };

  const results = await discoverKeywords(
    ["website chatbot", "lead qualification"],
    2840,
    "en",
    20,
    {
      minimumResults: 20,
      maxGoogleAdsBatches: 1,
      maxLabsSeeds: 2,
      expandProductAnchors: true,
      request,
    },
  );

  assert.ok(
    endpoints.includes("dataforseo_labs/google/keyword_suggestions/live"),
  );
  assert.equal(
    endpoints.filter((endpoint) =>
      endpoint === "dataforseo_labs/google/keyword_suggestions/live"
    ).length,
    2,
  );
  assert.ok(endpoints.includes("dataforseo_labs/google/keyword_ideas/live"));
  assert.ok(results.some((result) =>
    result.keyword === "website visitor qualification" &&
    result.difficultyMeasured === true
  ));
});

test("planner source keeps a bounded multi-anchor Labs recovery budget", () => {
  const source = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(source, /maxLabsSeeds:\s*4/);
  assert.match(source, /maxRelatedSeeds:\s*2/);
  assert.match(source, /expandProductAnchors:\s*true/);
  assert.match(source, /Verified keyword funnel:/);
  assert.match(source, /Deterministically selected/);
  assert.match(source, /instead of paying a model to invent one/);
  assert.match(source, /durableProductAnchors/);
  assert.match(source, /tenantDiscoveryAnchors/);
  assert.match(source, /rotateDurableSeeds/);
  assert.match(source, /jobRotation/);
  assert.match(source, /intentReservedTopics/);
  assert.match(source, /Exact product anchors: measured/);
  assert.match(source, /getKeywordMetrics\(\s*exactProductAnchors/);
  assert.match(source, /profileDiscoveryAnchors\.slice\(0, 20\)/);
  assert.match(source, /keywordDifficultyCeiling\(maxKD, k\.searchVolume\)/);
  assert.match(source, /keywordDifficultyCeiling\(maxKD, m\.searchVolume\)/);
});

test("bounded related-keyword recovery parses keyword_data evidence", async () => {
  const endpoints: string[] = [];
  const request: KeywordDiscoveryRequest = async (endpoint, body) => {
    endpoints.push(endpoint);
    if (
      endpoint === "keywords_data/google_ads/keywords_for_keywords/live" ||
      endpoint === "dataforseo_labs/google/keyword_suggestions/live" ||
      endpoint === "dataforseo_labs/google/keyword_ideas/live"
    ) {
      return { tasks: [{ result: [] }] };
    }
    if (endpoint === "dataforseo_labs/google/related_keywords/live") {
      assert.equal(body[0].depth, 2);
      assert.equal(body[0].limit, 20);
      assert.deepEqual(body[0].filters, [
        "keyword_data.keyword_info.search_volume",
        ">=",
        10,
      ]);
      return {
        tasks: [{
          result: [{
            items: [{
              keyword_data: {
                keyword: "qualify website visitors",
                keyword_info: {
                  search_volume: 170,
                  cpc: 7,
                  competition: 0.35,
                  monthly_searches: [],
                },
                keyword_properties: { keyword_difficulty: 9 },
                search_intent_info: { main_intent: "commercial" },
              },
            }],
          }],
        }],
      };
    }
    if (endpoint === "dataforseo_labs/google/bulk_keyword_difficulty/live") {
      return {
        tasks: [{
          result: [{
            items: body[0].keywords.map((keyword: string) => ({
              keyword,
              keyword_difficulty: 9,
            })),
          }],
        }],
      };
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };

  const results = await discoverKeywords(
    ["website lead qualification", "visitor engagement"],
    2840,
    "en",
    20,
    {
      minimumResults: 5,
      maxGoogleAdsBatches: 1,
      maxLabsSeeds: 1,
      maxRelatedSeeds: 1,
      expandProductAnchors: true,
      request,
    },
  );

  assert.equal(
    endpoints.filter((endpoint) =>
      endpoint === "dataforseo_labs/google/related_keywords/live"
    ).length,
    1,
  );
  assert.ok(results.some((result) =>
    result.keyword === "qualify website visitors" &&
    result.searchVolume === 170 &&
    result.difficulty === 9 &&
    result.difficultyMeasured
  ));
});

test("missing keyword difficulty is never represented as a measured easy query", async () => {
  const request: KeywordDiscoveryRequest = async (endpoint) => {
    if (endpoint === "keywords_data/google_ads/keywords_for_keywords/live") {
      return {
        tasks: [{
          result: [{
            keyword: "website lead capture",
            search_volume: 900,
            cpc: 6,
            competition_index: 70,
            monthly_searches: [],
          }],
        }],
      };
    }
    if (endpoint === "dataforseo_labs/google/bulk_keyword_difficulty/live") {
      return {
        tasks: [{ result: [{ items: [{ keyword: "website lead capture" }] }] }],
      };
    }
    return { tasks: [{ result: [] }] };
  };

  const results = await discoverKeywords(
    ["website lead capture"],
    2840,
    "en",
    20,
    {
      minimumResults: 1,
      maxGoogleAdsBatches: 1,
      request,
    },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].difficulty, 0);
  assert.equal(results[0].difficultyMeasured, false);
});

test("a real zero keyword difficulty remains measured", async () => {
  const request: KeywordDiscoveryRequest = async (endpoint) => {
    if (endpoint === "keywords_data/google_ads/keywords_for_keywords/live") {
      return {
        tasks: [{
          result: [{
            keyword: "website visitor qualification",
            search_volume: 90,
            cpc: 3,
            competition_index: 20,
            monthly_searches: [],
          }],
        }],
      };
    }
    if (endpoint === "dataforseo_labs/google/bulk_keyword_difficulty/live") {
      return {
        tasks: [{
          result: [{
            items: [{
              keyword: "website visitor qualification",
              keyword_difficulty: 0,
            }],
          }],
        }],
      };
    }
    return { tasks: [{ result: [] }] };
  };

  const results = await discoverKeywords(
    ["website visitor qualification"],
    2840,
    "en",
    20,
    {
      minimumResults: 1,
      maxGoogleAdsBatches: 1,
      request,
    },
  );

  assert.equal(results[0].difficulty, 0);
  assert.equal(results[0].difficultyMeasured, true);
});

test("an empty seed expansion falls back to verified tenant-site keywords", async () => {
  const endpoints: string[] = [];
  const request: KeywordDiscoveryRequest = async (endpoint, body) => {
    endpoints.push(endpoint);
    if (
      endpoint === "keywords_data/google_ads/keywords_for_keywords/live" ||
      endpoint === "dataforseo_labs/google/keyword_suggestions/live" ||
      endpoint === "dataforseo_labs/google/keyword_ideas/live"
    ) {
      return { tasks: [{ result: [] }] };
    }
    if (endpoint === "keywords_data/google_ads/keywords_for_site/live") {
      assert.equal(body[0].target, "leadpilot.chat");
      return {
        tasks: [{
          result: [{
            keyword: "ai website assistant",
            search_volume: 140,
            cpc: 4,
            competition_index: 35,
            monthly_searches: [],
          }],
        }],
      };
    }
    if (endpoint === "dataforseo_labs/google/bulk_keyword_difficulty/live") {
      return {
        tasks: [{
          result: [{
            items: [{
              keyword: "ai website assistant",
              keyword_difficulty: 19,
            }],
          }],
        }],
      };
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };

  const results = await discoverKeywords(
    ["website chatbot", "lead qualification"],
    2840,
    "en",
    20,
    {
      minimumResults: 5,
      maxGoogleAdsBatches: 1,
      maxLabsSeeds: 1,
      targetDomain: "https://www.leadpilot.chat/blog",
      request,
    },
  );

  assert.ok(
    endpoints.includes("dataforseo_labs/google/keyword_ideas/live"),
  );
  assert.ok(
    endpoints.includes("keywords_data/google_ads/keywords_for_site/live"),
  );
  assert.deepEqual(
    results.map(({ keyword, searchVolume, difficulty }) => ({
      keyword,
      searchVolume,
      difficulty,
    })),
    [{
      keyword: "ai website assistant",
      searchVolume: 140,
      difficulty: 19,
    }],
  );
});

test("category-based keyword ideas are preferred over broad site suggestions", async () => {
  const endpoints: string[] = [];
  const request: KeywordDiscoveryRequest = async (endpoint, body) => {
    endpoints.push(endpoint);
    if (
      endpoint === "keywords_data/google_ads/keywords_for_keywords/live" ||
      endpoint === "dataforseo_labs/google/keyword_suggestions/live"
    ) {
      return { tasks: [{ result: [] }] };
    }
    if (endpoint === "dataforseo_labs/google/keyword_ideas/live") {
      assert.deepEqual(body[0].order_by, [
        "relevance,desc",
        "keyword_info.search_volume,desc",
      ]);
      return {
        tasks: [{
          result: [{
            items: Array.from({ length: 6 }, (_, index) => ({
              keyword: `lead qualification process ${index}`,
              keyword_info: {
                search_volume: 260 - index,
                cpc: 5,
                competition: 0.4,
                monthly_searches: [],
              },
              keyword_properties: { keyword_difficulty: 24 },
              search_intent_info: { main_intent: "commercial" },
            })),
          }],
        }],
      };
    }
    if (endpoint === "dataforseo_labs/google/bulk_keyword_difficulty/live") {
      return {
        tasks: [{
          result: [{
            items: body[0].keywords.map((keyword: string) => ({
              keyword,
              keyword_difficulty: 24,
            })),
          }],
        }],
      };
    }
    throw new Error(`Unexpected endpoint: ${endpoint}`);
  };

  const results = await discoverKeywords(
    ["lead qualification chatbot", "website visitor engagement"],
    2840,
    "en",
    20,
    {
      minimumResults: 5,
      maxGoogleAdsBatches: 1,
      maxLabsSeeds: 1,
      targetDomain: "leadpilot.chat",
      request,
    },
  );

  assert.ok(
    endpoints.includes("dataforseo_labs/google/keyword_ideas/live"),
  );
  assert.ok(
    !endpoints.includes("keywords_data/google_ads/keywords_for_site/live"),
  );
  assert.equal(results[0].keyword, "lead qualification process 0");
});
