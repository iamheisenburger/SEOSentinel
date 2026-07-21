import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCadenceWindow } from "../convex/lib/autopilotCadence.ts";

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;

test("standard cadence stops after one attempt", () => {
  const result = evaluateCadenceWindow({
    articles: [{ createdAt: NOW - HOUR, status: "review" }],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 1,
  });

  assert.equal(result.canGenerate, false);
});

test("autonomous cadence allows one fallback after a blocked draft", () => {
  const result = evaluateCadenceWindow({
    articles: [{ createdAt: NOW - HOUR, status: "review" }],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.canGenerate, true);
});

test("autonomous cadence stops after two blocked attempts", () => {
  const result = evaluateCadenceWindow({
    articles: [
      { createdAt: NOW - HOUR, status: "review" },
      { createdAt: NOW - 2 * HOUR, status: "review" },
    ],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.canGenerate, false);
  assert.equal(result.recentAttempts, 2);
});

test("a publication closes the cadence window", () => {
  const result = evaluateCadenceWindow({
    articles: [{ createdAt: NOW - HOUR, status: "published" }],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.canGenerate, false);
  assert.equal(result.hasRecentPublication, true);
});

test("attempts outside the cadence window do not block generation", () => {
  const result = evaluateCadenceWindow({
    articles: [{ createdAt: NOW - 25 * HOUR, status: "review" }],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 1,
  });

  assert.equal(result.canGenerate, true);
});

test("a quarantined prose candidate is revised before a fallback is generated", () => {
  const result = evaluateCadenceWindow({
    articles: [
      {
        _id: "article-1",
        createdAt: NOW - HOUR,
        status: "review",
        publicationGateStatus: "blocked",
        publicationGateIssues: ["Editorial quality score is 78; strict minimum is 85."],
        qualityRevisionCount: 0,
      },
    ],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.canGenerate, false);
  assert.equal(result.recoveryArticleId, "article-1");
});

test("non-rewritable media failures skip paid prose retries", () => {
  const result = evaluateCadenceWindow({
    articles: [
      {
        _id: "article-1",
        createdAt: NOW - HOUR,
        status: "review",
        publicationGateStatus: "blocked",
        publicationGateIssues: ["Strict publication requires a reviewed HTTPS hero image."],
        qualityRevisionCount: 0,
      },
    ],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.recoveryArticleId, undefined);
  assert.equal(result.canGenerate, true);
});

test("publication time, not old draft creation time, closes the cadence window", () => {
  const result = evaluateCadenceWindow({
    articles: [
      {
        createdAt: NOW - 48 * HOUR,
        publishedAt: NOW - HOUR,
        status: "published",
      },
    ],
    now: NOW,
    hoursPerArticle: 24,
    maxAttempts: 2,
  });

  assert.equal(result.hasRecentPublication, true);
  assert.equal(result.canGenerate, false);
});
