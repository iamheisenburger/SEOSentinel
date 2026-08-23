import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import {
  createOAuthState,
  verifyOAuthState,
} from "../src/lib/oauth-state.ts";

const previousStateSecret = process.env.OAUTH_STATE_SECRET;
process.env.OAUTH_STATE_SECRET = "test-only-oauth-state-secret-with-32-bytes";
after(() => {
  if (previousStateSecret === undefined) delete process.env.OAUTH_STATE_SECRET;
  else process.env.OAUTH_STATE_SECRET = previousStateSecret;
});

const now = 1_800_000_000_000;
const nonce = "00000000-0000-4000-8000-000000000000";

test("OAuth state is signed and bound to provider, user, site, and expiry", () => {
  const state = createOAuthState({
    provider: "github",
    siteId: "site-victim",
    userId: "user-owner",
    now,
    nonce,
  });

  assert.deepEqual(
    verifyOAuthState(state, {
      provider: "github",
      userId: "user-owner",
      now: now + 1_000,
    }),
    { siteId: "site-victim" },
  );
  assert.equal(
    verifyOAuthState(state, {
      provider: "github",
      userId: "user-attacker",
      now: now + 1_000,
    }),
    null,
  );
  assert.equal(
    verifyOAuthState(state, {
      provider: "gsc",
      userId: "user-owner",
      now: now + 1_000,
    }),
    null,
  );
  assert.equal(
    verifyOAuthState(state, {
      provider: "github",
      userId: "user-owner",
      now: now + 10 * 60 * 1_000,
    }),
    null,
  );
});

test("a forged matching cookie/state value cannot authenticate its payload", () => {
  const valid = createOAuthState({
    provider: "github",
    siteId: "site-owner",
    userId: "user-owner",
    now,
    nonce,
  });
  const [encoded, mac] = valid.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  payload.siteId = "site-victim";
  const forgedEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const forgedStateAndCookie = `${forgedEncoded}.${mac}`;

  assert.equal(
    verifyOAuthState(forgedStateAndCookie, {
      provider: "github",
      userId: "user-owner",
      now: now + 1_000,
    }),
    null,
  );
});

test("OAuth callbacks revalidate current tenant ownership before external exchange or privileged save", () => {
  for (const provider of ["github", "gsc", "gmail_outreach"] as const) {
    const routeDirectory = provider === "gmail_outreach" ? "outreach/gmail" : provider;
    const authRoute = readFileSync(
      `src/app/api/${routeDirectory}/auth/route.ts`,
      "utf8",
    );
    const callback = readFileSync(
      `src/app/api/${routeDirectory}/callback/route.ts`,
      "utf8",
    );
    assert.match(authRoute, /createOAuthState/);
    assert.match(callback, /verifyOAuthState/);

    const ownershipCheck = callback.indexOf("await getOwnedSite(siteId)");
    const tokenExchange = callback.indexOf(
      provider === "github"
        ? "https://github.com/login/oauth/access_token"
        : "https://oauth2.googleapis.com/token",
    );
    const privilegedSave = callback.indexOf(
      provider === "github"
        ? 'callPentraInternal("/internal/oauth/github"'
        : provider === "gsc"
          ? 'callPentraInternal("/internal/oauth/gsc"'
          : 'callPentraInternal<{ ready: boolean }>(\n      "/internal/oauth/outreach-gmail"',
    );
    assert.ok(ownershipCheck >= 0);
    assert.ok(tokenExchange > ownershipCheck);
    assert.ok(privilegedSave > ownershipCheck);
  }
});

test("Google OAuth callbacks keep access tokens out of URLs and provider error logs", () => {
  const gsc = readFileSync("src/app/api/gsc/callback/route.ts", "utf8");
  const outreach = readFileSync(
    "src/app/api/outreach/gmail/callback/route.ts",
    "utf8",
  );
  const internal = readFileSync("src/lib/pentra-internal-api.ts", "utf8");

  for (const callback of [gsc, outreach]) {
    assert.doesNotMatch(callback, /tokeninfo\?access_token=/);
    assert.doesNotMatch(callback, /await\s+\w+\.text\(\)/);
  }
  assert.match(gsc, /signal: AbortSignal\.timeout\(OAUTH_HTTP_TIMEOUT_MS\)/);
  assert.doesNotMatch(gsc, /console\.error\([^\n]*,\s*(error|e|errText|errorText)\)/);
  assert.match(gsc, /if \(!saved\)[\s\S]*status: 502/);
  assert.doesNotMatch(gsc, /"Connected! You can close this window\."/);
  assert.match(internal, /signal: AbortSignal\.timeout\(15_000\)/);
  assert.doesNotMatch(internal, /payload\.error/);
});

test("GSC and Gmail outreach use isolated clients and reject incremental scope merging", () => {
  const gscAuth = readFileSync("src/app/api/gsc/auth/route.ts", "utf8");
  const gscCallback = readFileSync("src/app/api/gsc/callback/route.ts", "utf8");
  const outreachAuth = readFileSync(
    "src/app/api/outreach/gmail/auth/route.ts",
    "utf8",
  );
  const outreachCallback = readFileSync(
    "src/app/api/outreach/gmail/callback/route.ts",
    "utf8",
  );

  assert.match(gscAuth, /GSC_CLIENT_ID/);
  assert.match(outreachAuth, /OUTREACH_GOOGLE_CLIENT_ID/);
  assert.match(outreachCallback, /OUTREACH_GOOGLE_CLIENT_SECRET/);
  assert.match(gscAuth, /include_granted_scopes: "false"/);
  assert.match(outreachAuth, /include_granted_scopes: "false"/);
  assert.match(gscCallback, /hasOnlyGscGrowthScopes/);
  assert.match(outreachCallback, /hasOnlyGmailOutreachScopes/);
  assert.doesNotMatch(gscCallback, /handleOutreachGmailCallback/);
});
