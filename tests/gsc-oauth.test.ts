import assert from "node:assert/strict";
import test from "node:test";

import {
  GSC_READONLY_SCOPE,
  findMatchingGscProperty,
  hasGscReadonlyScope,
  normalizeGscDomain,
} from "../src/lib/gsc-oauth.ts";

test("requires the exact Search Console readonly scope", () => {
  assert.equal(hasGscReadonlyScope(`openid email ${GSC_READONLY_SCOPE}`), true);
  assert.equal(hasGscReadonlyScope("openid email"), false);
  assert.equal(hasGscReadonlyScope(undefined), false);
});

test("normalizes domain and URL-prefix properties", () => {
  assert.equal(normalizeGscDomain("sc-domain:LeadPilot.chat"), "leadpilot.chat");
  assert.equal(normalizeGscDomain("https://www.leadpilot.chat/"), "leadpilot.chat");
  assert.equal(normalizeGscDomain("leadpilot.chat/blog/article"), "leadpilot.chat");
});

test("selects only the exact site's Search Console property", () => {
  const entries = [
    { siteUrl: "sc-domain:unrelated.example" },
    { siteUrl: "https://leadpilot.chat/" },
    { siteUrl: "sc-domain:another.example" },
  ];

  assert.equal(
    findMatchingGscProperty(entries, "leadpilot.chat"),
    "https://leadpilot.chat/",
  );
  assert.equal(findMatchingGscProperty(entries, "missing.example"), undefined);
});
