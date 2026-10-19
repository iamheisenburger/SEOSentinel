import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ConvexError } from "convex/values";
import { userErrorMessage } from "../src/lib/user-error.ts";
import { userFacingError } from "../convex/lib/userError.ts";

test("NEW-USER the owner sees why a setup step failed, never a raw 'Server Error'", () => {
  const fallback = "Pentra couldn't save this website.";
  assert.equal(userErrorMessage(new ConvexError("Ghost connection check failed (401): the Admin API key was rejected"), fallback),
    "Ghost connection check failed (401): the Admin API key was rejected");
  // Production hides a plain server Error as "[Request ID: ...] Server Error": show the owner's sentence instead.
  assert.equal(userErrorMessage(new Error("[Request ID: 123] Server Error"), fallback), fallback);
  assert.equal(userErrorMessage({ data: { code: 1 } }, fallback), fallback);
  // Server side: a plain reason becomes a ConvexError, bounded, and an existing one passes through.
  const converted = userFacingError(new Error("Site limit reached\n for this plan " + "x".repeat(600)), fallback);
  assert.ok(converted instanceof ConvexError);
  assert.ok(converted.data.startsWith("Site limit reached for this plan") && converted.data.length === 400);
  const original = new ConvexError("Connect and verify your website first.");
  assert.equal(userFacingError(original, fallback), original);
  assert.equal(userFacingError("not an error", fallback).data, fallback);
});

test("NEW-USER the dashboard explains a used-up month and held-back drafts; copy matches what happens", () => {
  const overview = readFileSync("src/components/content-work-overview.tsx", "utf8");
  assert.match(overview, /You&apos;ve used all \{planPerMonth\} articles in your plan this month/);
  assert.match(overview, /href="\/upgrade">Upgrade for more articles/);
  assert.match(overview, /Held back, not published/);
  const contentWork = readFileSync("convex/contentWork.ts", "utf8");
  assert.doesNotMatch(contentWork, /fact check wasn't confident enough/, "most holds are editorial; the fact check often passed");
  const setupChoice = readFileSync("src/components/pentra-setup-choice.tsx", "utf8");
  assert.doesNotMatch(setupChoice, /"Pentra drafts; you read/, "Review first drafts nothing until the owner asks");
  const start = readFileSync("src/components/onboarding/content-start.tsx", "utf8");
  assert.match(start, /userErrorMessage\(err,/);
});
