import assert from "node:assert/strict";
import test from "node:test";

import {
  GSC_GROWTH_SCOPE,
  GSC_READONLY_SCOPE,
  findMatchingGscProperty,
  hasGscGrowthScope,
  hasGscReadonlyScope,
  normalizeGscDomain,
} from "../src/lib/gsc-oauth.ts";

test("requires the exact Search Console readonly scope", () => {
  assert.equal(hasGscReadonlyScope(`openid email ${GSC_READONLY_SCOPE}`), true);
  assert.equal(hasGscReadonlyScope("openid email"), false);
  assert.equal(hasGscReadonlyScope(undefined), false);
  assert.equal(hasGscReadonlyScope(GSC_GROWTH_SCOPE), true);
});

test("requires write-capable Search Console scope for the growth loop", () => {
  assert.equal(hasGscGrowthScope(`openid email ${GSC_GROWTH_SCOPE}`), true);
  assert.equal(hasGscGrowthScope(GSC_READONLY_SCOPE), false);
  assert.equal(hasGscGrowthScope(undefined), false);
});

test("normalizes domain and URL-prefix properties", () => {
  assert.equal(normalizeGscDomain("sc-domain:LeadPilot.chat"), "leadpilot.chat");
  assert.equal(normalizeGscDomain("https://www.leadpilot.chat/"), "leadpilot.chat");
  assert.equal(normalizeGscDomain("leadpilot.chat/blog/article"), "leadpilot.chat");
});

test("prefers the exact domain property over an exact root URL prefix", () => {
  const entries = [
    { siteUrl: "sc-domain:unrelated.example" },
    { siteUrl: "https://leadpilot.chat/" },
    { siteUrl: "sc-domain:leadpilot.chat" },
    { siteUrl: "sc-domain:another.example" },
  ];

  assert.equal(
    findMatchingGscProperty(entries, "leadpilot.chat"),
    "sc-domain:leadpilot.chat",
  );
  assert.equal(findMatchingGscProperty(entries, "missing.example"), undefined);
});

test("falls back only to an exact origin-root URL-prefix property", () => {
  const entries = [
    { siteUrl: "https://leadpilot.chat/blog/" },
    { siteUrl: "https://www.leadpilot.chat/" },
    { siteUrl: "http://leadpilot.chat/" },
    { siteUrl: "https://leadpilot.chat/" },
  ];

  assert.equal(
    findMatchingGscProperty(entries, "https://leadpilot.chat"),
    "https://leadpilot.chat/",
  );
});

test("rejects subpath, sibling-host, protocol, query, and fragment prefixes", () => {
  const invalid = [
    { siteUrl: "https://leadpilot.chat/blog/" },
    { siteUrl: "https://www.leadpilot.chat/" },
    { siteUrl: "http://leadpilot.chat/" },
    { siteUrl: "https://leadpilot.chat/?scope=blog" },
    { siteUrl: "https://leadpilot.chat/#blog" },
  ];

  assert.equal(
    findMatchingGscProperty(invalid, "https://leadpilot.chat"),
    undefined,
  );
});

test("requires an exact hostname for domain properties", () => {
  assert.equal(
    findMatchingGscProperty(
      [{ siteUrl: "sc-domain:www.leadpilot.chat" }],
      "leadpilot.chat",
    ),
    undefined,
  );
  assert.equal(
    findMatchingGscProperty(
      [{ siteUrl: "sc-domain:www.leadpilot.chat" }],
      "https://www.leadpilot.chat",
    ),
    "sc-domain:www.leadpilot.chat",
  );
  assert.equal(
    findMatchingGscProperty(
      [{ siteUrl: "sc-domain:leadpilot.chat/blog" }],
      "leadpilot.chat",
    ),
    undefined,
  );
});
