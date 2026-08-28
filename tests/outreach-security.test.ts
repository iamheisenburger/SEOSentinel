import assert from "node:assert/strict";
import test from "node:test";

import {
  inboundMonitoringCapability,
  outboundIdentityReservationActive,
  reconnectPacingState,
  sanitizeInboxForClient,
} from "../convex/lib/outreachSecurity.ts";
import { utcDayKey } from "../convex/lib/outreachPacing.ts";
import {
  OUTREACH_AUTONOMY_CONSENT_VERSION,
  OUTREACH_AUTONOMY_POLICY_HASH,
} from "../convex/lib/outreachAutonomy.ts";

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

test("one fail-closed inbound capability drives SMTP/IMAP owner and fleet readiness", () => {
  const ready = {
    provider: "smtp",
    status: "warming",
    credentialCiphertext: "ciphertext",
    credentialKeyId: "key-v1",
    credentialEncryptionVersion: 1,
    credentialBindingHash: "binding",
    imapVerifiedAt: NOW,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapUsername: "sender@example.com",
  };
  assert.deepEqual(inboundMonitoringCapability(ready), {
    ready: true,
    mode: "imap",
    imapReady: true,
    legacyGmailReadReady: false,
  });
  for (const invalid of [
    { ...ready, credentialCiphertext: undefined },
    { ...ready, credentialKeyId: undefined },
    { ...ready, credentialEncryptionVersion: undefined },
    { ...ready, credentialBindingHash: undefined },
    { ...ready, smtpPassword: "legacy-plaintext" },
    { ...ready, imapVerifiedAt: undefined },
    { ...ready, imapHost: undefined },
    { ...ready, imapPort: 143 },
    { ...ready, imapUsername: "" },
    { ...ready, status: "suspended" },
  ]) {
    assert.equal(inboundMonitoringCapability(invalid).ready, false);
    assert.equal(inboundMonitoringCapability(invalid).mode, "unavailable");
  }
  assert.equal(
    sanitizeInboxForClient(ready, NOW)?.inboundMonitoringMode,
    "imap",
  );
});

test("mailbox and sender-domain pacing have separate reconnect semantics", () => {
  const sameDomainNewMailbox = reconnectPacingState({
    reconnectsSameMailbox: false,
    preservesSenderReputation: true,
    now: NOW,
    existingWarmupStartedAt: NOW - 30 * DAY,
    existingSentToday: 4,
    existingSentTodayDay: utcDayKey(NOW),
    existingLastSentAt: NOW - 1_000,
  });
  assert.equal(sameDomainNewMailbox.warmupStartedAt, NOW);
  assert.equal(sameDomainNewMailbox.sentToday, 4);
  assert.equal(sameDomainNewMailbox.lastSentAt, NOW - 1_000);

  const newDomain = reconnectPacingState({
    reconnectsSameMailbox: false,
    preservesSenderReputation: false,
    now: NOW,
    existingSentToday: 4,
    existingSentTodayDay: utcDayKey(NOW),
    existingLastSentAt: NOW - 1_000,
  });
  assert.equal(newDomain.warmupStartedAt, NOW);
  assert.equal(newDomain.sentToday, 0);
  assert.equal(newDomain.lastSentAt, undefined);
});

test("deletion and unresolved delivery keep a disconnected identity reserved", () => {
  assert.equal(outboundIdentityReservationActive({
    inboxStatus: "disconnected",
    siteExists: true,
  }), false);
  assert.equal(outboundIdentityReservationActive({
    inboxStatus: "disconnected",
    siteExists: true,
    siteDeletionPending: true,
  }), true);
  assert.equal(outboundIdentityReservationActive({
    inboxStatus: "disconnected",
    siteExists: true,
    hasUnverifiedDelivery: true,
  }), true);
});

test("stored consent remains visible while effective autonomous delivery is paused", () => {
  const inbox = {
    provider: "gmail",
    status: "active",
    mode: "live",
    autonomyConsentVersion: OUTREACH_AUTONOMY_CONSENT_VERSION,
    autonomyConsentPolicyHash: OUTREACH_AUTONOMY_POLICY_HASH,
    autonomyConsentAcceptedAt: NOW,
    autonomyConsentAcceptedBy: "user_owner",
    autonomyConsentInboxConfigurationVersion: 3,
    configurationVersion: 3,
  };
  const envOff = sanitizeInboxForClient(
    inbox,
    NOW,
    false,
    false,
    false,
    undefined,
    false,
    "user_owner",
    true,
  );
  assert.equal(envOff?.autonomousConsentActive, true);
  assert.equal(envOff?.autonomousDeliveryEnabled, false);

  const parked = sanitizeInboxForClient(
    inbox,
    NOW,
    false,
    false,
    false,
    undefined,
    true,
    "user_owner",
    false,
  );
  assert.equal(parked?.autonomousConsentActive, true);
  assert.equal(parked?.autonomousDeliveryEnabled, false);
});

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

test("legacy reply monitoring remains compatible while signed relay requires a DSN canary", () => {
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
  const relayReady = sanitizeInboxForClient(
    {
      provider: "gmail",
      status: "active",
      oauthScopes: "https://www.googleapis.com/auth/gmail.send",
      oauthRefreshToken: "refresh-token",
    },
    NOW,
    true,
    true,
  );
  assert.equal(relayReady?.inboundMonitoringReady, true);
  assert.equal(relayReady?.inboundMonitoringMode, "signed_relay");
  assert.equal(ready?.inboundMonitoringMode, "legacy_gmail");
  assert.equal(
    sanitizeInboxForClient(
      { provider: "gmail", status: "suspended" },
      NOW,
      true,
      true,
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

test("only an active owner projection can reveal its derived DSN route", () => {
  const target = `dsn-${"a".repeat(48)}@reply.pentra.example`;
  const active = sanitizeInboxForClient(
    {
      provider: "gmail",
      status: "warming",
      oauthRefreshToken: "refresh-token",
      inboundRelayDsnRoutingTargetHash: "b".repeat(64),
      inboundRelayDsnRoutingTargetGeneration: 7,
    },
    NOW,
    true,
    false,
    false,
    target,
  );
  assert.equal(active?.inboundRelayDsnRoutingTargetAddress, target);
  assert.equal(active?.inboundRelayDsnRoutingTargetReady, false);
  assert.equal("inboundRelayDsnRoutingTargetHash" in active!, false);
  assert.equal("inboundRelayDsnRoutingTargetGeneration" in active!, false);

  const disconnected = sanitizeInboxForClient(
    {
      provider: "gmail",
      status: "disconnected",
      oauthRefreshToken: "refresh-token",
    },
    NOW,
    true,
    false,
    false,
    target,
  );
  assert.equal(disconnected?.inboundRelayDsnRoutingTargetAddress, undefined);
});
