import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPrivateOrReservedAddress } from "../convex/lib/safeOutbound.ts";

test("privileged job lifecycle and cron fleet entrypoints are internal", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const crons = readFileSync("convex/crons.ts", "utf8");
  assert.match(jobs, /export const create = internalMutation/);
  assert.match(jobs, /export const markRunning = internalMutation/);
  assert.match(jobs, /export const claimPending = internalMutation/);
  assert.match(jobs, /job\.status !== "pending"/);
  assert.match(jobs, /export const markDone = internalMutation/);
  assert.match(jobs, /export const markFailed = internalMutation/);
  assert.doesNotMatch(
    crons,
    /internal\.actions\.(?:pipeline\.relinkAllArticles|contentDecay\.(?:scanAllSites|autoRefreshAllSites)|gscSync\.syncAllSites)/,
  );
  assert.doesNotMatch(crons, /["'](?:gsc-sync|decay-scan|auto-refresh|relink-articles)["']/);
});

test("tenant article and topic reads require owner checks while blog reads remain public", () => {
  const articles = readFileSync("convex/articles.ts", "utf8");
  const topics = readFileSync("convex/topics.ts", "utf8");
  const blog = readFileSync("convex/blog.ts", "utf8");
  assert.match(articles, /export const get = query[\s\S]*requireArticleOwner/);
  assert.match(articles, /export const listBySite = query[\s\S]*requireSiteOwner/);
  assert.match(topics, /export const get = query[\s\S]*requireSiteOwner/);
  assert.match(blog, /export const getPublishedBySlug = query/);
  assert.match(blog, /article\.status !== "published"/);
});

test("legacy migration backfills timestamps without resurrecting old delivery retries", () => {
  const articles = readFileSync("convex/articles.ts", "utf8");
  assert.match(articles, /publishedAt:\s*article\.createdAt/);
  assert.doesNotMatch(articles, /migratedFromLegacyPublishRetry:\s*true/);
  assert.match(articles, /jobs remain untouched/);
  assert.match(articles, /state\?\.status === "running"/);
  assert.match(articles, /state\.runToken !== runToken/);
  assert.match(articles, /articlesProcessed/);
  assert.match(articles, /jobsProcessed/);
  assert.match(articles, /state\?\.status === "completed"/);
});

test("untrusted SERP fetches use DNS-pinned bounded HTTPS transport", () => {
  assert.equal(isPrivateOrReservedAddress("127.0.0.1"), true);
  assert.equal(isPrivateOrReservedAddress("169.254.169.254"), true);
  assert.equal(isPrivateOrReservedAddress("10.2.3.4"), true);
  assert.equal(isPrivateOrReservedAddress("::1"), true);
  assert.equal(isPrivateOrReservedAddress("fec0::1"), true);
  assert.equal(isPrivateOrReservedAddress("ff02::1"), true);
  assert.equal(isPrivateOrReservedAddress("::7f00:1"), true);
  assert.equal(isPrivateOrReservedAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateOrReservedAddress("64:ff9b::7f00:1"), true);
  assert.equal(isPrivateOrReservedAddress("2002:7f00:1::"), true);
  assert.equal(isPrivateOrReservedAddress("2001:0000:4136:e378::"), true);
  assert.equal(isPrivateOrReservedAddress("2606:4700:4700::1111"), false);
  assert.equal(isPrivateOrReservedAddress("2001:4860:4860::8888"), false);

  const safeOutbound = readFileSync("convex/lib/safeOutbound.ts", "utf8");
  const seoData = readFileSync("convex/actions/seoData.ts", "utf8");
  assert.match(safeOutbound, /lookup:\s*\([^)]*\)\s*=>[\s\S]*target\.address\.address/);
  assert.match(safeOutbound, /sameHostRedirects/);
  assert.match(safeOutbound, /Outbound response exceeded the size limit/);
  assert.match(safeOutbound, /Unsupported outbound content type/);
  assert.match(seoData, /safeFetchPublicText\(result\.url/);
  assert.doesNotMatch(seoData, /fetch\(result\.url/);
});
