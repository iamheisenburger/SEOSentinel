import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverKeywords,
  type KeywordDiscoveryRequest,
} from "../convex/actions/seoData.ts";

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
});

test("an empty seed expansion falls back to verified tenant-site keywords", async () => {
  const endpoints: string[] = [];
  const request: KeywordDiscoveryRequest = async (endpoint, body) => {
    endpoints.push(endpoint);
    if (
      endpoint === "keywords_data/google_ads/keywords_for_keywords/live" ||
      endpoint === "dataforseo_labs/google/keyword_suggestions/live"
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
