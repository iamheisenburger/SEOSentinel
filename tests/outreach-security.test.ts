import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeInboxForClient } from "../convex/lib/outreachSecurity.ts";
import { utcDayKey } from "../convex/lib/outreachPacing.ts";

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

test("inbox records never expose mailbox credentials", () => {
  const sanitized = sanitizeInboxForClient(
    {
      _id: "inbox-1",
      siteId: "site-1",
      provider: "gmail",
      fromEmail: "sam@tenant.com",
      status: "active",
      mode: "live",
      oauthAccessToken: "google-access",
      oauthRefreshToken: "google-refresh",
      smtpPassword: "smtp-secret",
      apiKey: "resend-secret",
    },
    NOW,
  ) as Record<string, unknown>;

  for (const key of [
    "oauthAccessToken",
    "oauthRefreshToken",
    "oauthExpiresAt",
    "smtpHost",
    "smtpPort",
    "smtpUsername",
    "smtpPassword",
    "apiKey",
  ]) {
    assert.equal(key in sanitized, false, `${key} leaked to the client`);
  }

  assert.equal(sanitized.credentialsPresent, true);
  assert.equal(sanitized.fromEmail, "sam@tenant.com");
});

test("client receives only DNS readiness receipts, never OAuth scopes or tokens", () => {
  const sanitized = sanitizeInboxForClient(
    {
      provider: "gmail",
      fromEmail: "hello@gettenant.com",
      senderDomain: "gettenant.com",
      dkimSelector: "google",
      dnsCheckedAt: NOW,
      spfVerifiedAt: NOW,
      dkimVerifiedAt: NOW,
      dmarcVerifiedAt: NOW,
      physicalMailingAddress: "123 Market Street, San Francisco, CA 94105",
      complianceConfirmedAt: NOW,
      oauthScopes: "https://www.googleapis.com/auth/gmail.send",
      oauthAccessToken: "access",
    },
    NOW,
  ) as Record<string, unknown>;
  assert.equal(sanitized.senderDomain, "gettenant.com");
  assert.equal(sanitized.spfVerifiedAt, NOW);
  assert.equal(sanitized.complianceConfirmedAt, NOW);
  assert.equal("oauthScopes" in sanitized, false);
  assert.equal("oauthAccessToken" in sanitized, false);
});

test("no stored credential means no false connected signal", () => {
  const sanitized = sanitizeInboxForClient(
    { provider: "resend", fromEmail: "sam@tenant.com", status: "disconnected", mode: "approval" },
    NOW,
  );
  assert.equal(sanitized?.credentialsPresent, false);
});

test("reply monitoring readiness requires scope, credential, and an active Gmail connection", () => {
  const ready = sanitizeInboxForClient(
    {
      provider: "gmail",
      status: "active",
      oauthScopes:
        "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
      oauthRefreshToken: "refresh-token",
    },
    NOW,
  );
  assert.equal(ready?.inboundMonitoringReady, true);

  assert.equal(
    sanitizeInboxForClient(
      {
        provider: "gmail",
        status: "active",
        oauthScopes: "https://www.googleapis.com/auth/gmail.readonly",
      },
      NOW,
    )?.inboundMonitoringReady,
    false,
  );
  assert.equal(
    sanitizeInboxForClient(
      {
        provider: "gmail",
        status: "active",
        oauthScopes: "https://www.googleapis.com/auth/gmail.send",
        oauthRefreshToken: "refresh-token",
      },
      NOW,
    )?.inboundMonitoringReady,
    false,
  );
  assert.equal(
    sanitizeInboxForClient(
      {
        provider: "gmail",
        status: "suspended",
        oauthScopes: "https://www.googleapis.com/auth/gmail.readonly",
        oauthRefreshToken: "refresh-token",
      },
      NOW,
    )?.inboundMonitoringReady,
    false,
  );
});

test("the reported daily headroom reflects warm-up and today only", () => {
  const brandNew = sanitizeInboxForClient(
    { warmupStartedAt: NOW, dailySendCap: 30, sentToday: 4, sentTodayDay: utcDayKey(NOW) },
    NOW,
  );
  assert.equal(brandNew?.effectiveDailyCap, 5);
  assert.equal(brandNew?.sentToday, 4);

  const stale = sanitizeInboxForClient(
    {
      warmupStartedAt: NOW - 60 * DAY,
      dailySendCap: 30,
      sentToday: 30,
      sentTodayDay: utcDayKey(NOW - DAY),
    },
    NOW,
  );
  assert.equal(stale?.effectiveDailyCap, 30);
  assert.equal(stale?.sentToday, 0, "yesterday's count must not be shown as today's");
});

test("a missing inbox sanitizes to null rather than an empty shell", () => {
  assert.equal(sanitizeInboxForClient(null, NOW), null);
  assert.equal(sanitizeInboxForClient(undefined, NOW), null);
});
