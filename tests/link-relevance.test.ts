import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_RELEVANCE_SCORE,
  bestReplacementArticle,
  relevanceScore,
  relevanceTokens,
} from "../convex/lib/linkRelevance.ts";

const ARTICLES = [
  {
    articleId: "a1",
    title: "Conversion Rate Optimization Services for B2B",
    slug: "conversion-rate-optimization-services-b2b",
    metaKeywords: ["conversion rate optimization", "b2b cro"],
  },
  {
    articleId: "a2",
    title: "How to Write Cold Email Sequences That Get Replies",
    slug: "cold-email-sequences",
    metaKeywords: ["cold email", "email outreach"],
  },
  {
    articleId: "a3",
    title: "Chatbot Lead Qualification: A Practical Guide",
    slug: "chatbot-lead-qualification",
    metaKeywords: ["chatbot", "lead qualification"],
  },
];

test("stopwords and short words carry no topical signal", () => {
  const tokens = relevanceTokens("How to use the best guide for your blog post");
  assert.deepEqual([...tokens].sort(), []);
  assert.ok(relevanceTokens("https://blog.drift.com/all-the-emails-at-drift").has("drift"));
  assert.ok(relevanceTokens("chatbot lead qualification").has("chatbot"));
});

test("declared keywords weigh more than incidental title words", () => {
  const viaKeyword = relevanceScore({
    anchorText: "chatbot qualification",
    article: ARTICLES[2],
  });
  const viaTitleOnly = relevanceScore({
    anchorText: "practical",
    article: ARTICLES[2],
  });
  assert.ok(viaKeyword.score > viaTitleOnly.score);
});

test("an off-topic dead link matches nothing rather than the first article", () => {
  // The exact production failure: a German post about Drift's email copy was
  // answered with a B2B conversion-rate-optimisation article.
  const match = bestReplacementArticle({
    anchorText: "Alle E-Mail-Texte von Drift",
    brokenUrl: "http://blog.drift.com/all-the-emails-at-drift",
    articles: ARTICLES,
  });
  assert.equal(match, null);

  const adobe = bestReplacementArticle({
    anchorText: "the power of relationship marketing",
    brokenUrl: "http://blog.drift.com/the-power-of-relationship-marketing",
    articles: ARTICLES,
  });
  assert.equal(adobe, null);
});

test("a genuinely related dead link finds the right article", () => {
  const match = bestReplacementArticle({
    anchorText: "chatbot lead qualification",
    brokenUrl: "https://competitor.com/resources/chatbot-qualification",
    articles: ARTICLES,
  });
  assert.equal(match?.article.articleId, "a3");
  assert.ok(match!.score >= MIN_RELEVANCE_SCORE);
  assert.ok(match!.matchedTerms.includes("chatbot"));
});

test("a single shared term is never enough on its own", () => {
  const match = bestReplacementArticle({
    anchorText: "conversion",
    brokenUrl: "https://competitor.com/x",
    articles: ARTICLES,
  });
  assert.equal(match, null, "one common word is coincidence, not relevance");
});

test("matching is deterministic when two articles tie", () => {
  const tied = [
    { articleId: "z", title: "Cold email outreach", slug: "z", metaKeywords: ["cold email"] },
    { articleId: "a", title: "Cold email outreach", slug: "a", metaKeywords: ["cold email"] },
  ];
  const first = bestReplacementArticle({ anchorText: "cold email", articles: tied });
  const second = bestReplacementArticle({
    anchorText: "cold email",
    articles: tied.slice().reverse(),
  });
  assert.equal(first?.article.articleId, "a");
  assert.equal(second?.article.articleId, "a");
});

test("an empty anchor and URL produce no match", () => {
  assert.equal(bestReplacementArticle({ articles: ARTICLES }), null);
});
