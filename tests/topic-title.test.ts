import assert from "node:assert/strict";
import test from "node:test";
import { topicTitle } from "../src/lib/topic-title.ts";

test("keyword labels get acronyms; titles keep their own casing", () => {
  assert.equal(topicTitle("ai sales automation for saas"), "AI sales automation for SaaS");
  assert.equal(topicTitle("managed it services"), "Managed IT services");
  assert.equal(topicTitle("Search Engine Optimization Keyword Research: What It Is and How to Approach It"),
    "Search Engine Optimization Keyword Research: What It Is and How to Approach It");
  assert.equal(topicTitle("A Practical Guide to AI Chat Engagement"), "A Practical Guide to AI Chat Engagement");
});
