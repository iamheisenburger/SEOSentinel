import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeSiteForClient } from "../convex/lib/siteSecurity.ts";

test("site records never expose stored publishing or OAuth credentials", () => {
  const sanitized = sanitizeSiteForClient({
    _id: "site-1",
    domain: "example.com",
    githubToken: "github-secret",
    repoDefaultBranch: "production",
    wpUrl: "https://example.com",
    wpUsername: "publisher",
    wpAppPassword: "wordpress-secret",
    webhookUrl: "https://example.com/hooks/articles",
    webhookSecret: "webhook-secret",
    gscAccessToken: "gsc-access",
    gscRefreshToken: "gsc-refresh",
    gscProperty: "sc-domain:example.com",
    mediumToken: "medium-secret",
    linkedinAccessToken: "linkedin-secret",
  }) as Record<string, unknown>;

  for (const key of [
    "githubToken",
    "wpAppPassword",
    "webhookSecret",
    "gscAccessToken",
    "gscRefreshToken",
    "mediumToken",
    "linkedinAccessToken",
  ]) {
    assert.equal(key in sanitized, false, `${key} leaked to the client`);
  }

  assert.equal(sanitized.githubConnected, true);
  assert.equal(sanitized.wordpressConfigured, true);
  assert.equal(sanitized.webhookConfigured, true);
  assert.equal(sanitized.webhookSecretConfigured, true);
  assert.equal(sanitized.gscConnected, true);
  assert.equal(sanitized.mediumConnected, true);
  assert.equal(sanitized.linkedinConnected, true);
});

test("connection flags remain false when credentials are incomplete", () => {
  const sanitized = sanitizeSiteForClient({
    domain: "example.com",
    wpUrl: "https://example.com",
    wpUsername: "publisher",
    gscProperty: "sc-domain:example.com",
  });

  assert.equal(sanitized.githubConnected, false);
  assert.equal(sanitized.wordpressConfigured, false);
  assert.equal(sanitized.gscConnected, false);
});

test("a GitHub token without a discovered default branch is not connected", () => {
  const sanitized = sanitizeSiteForClient({
    domain: "example.com",
    githubToken: "github-secret",
  });

  assert.equal(sanitized.githubConnected, false);
});
