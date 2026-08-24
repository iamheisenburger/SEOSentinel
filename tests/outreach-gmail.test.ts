import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  hasGmailReadScope,
  hasGmailSendScope,
  hasOnlyGmailOutboundScopes,
  hasOnlyGmailOutreachScopes,
  normalizeMailDomain,
  secondaryGmailSenderIssues,
} from "../src/lib/outreach-gmail.ts";
import { resolveGmailReconnectProfile } from "../convex/lib/outreachSecurity.ts";

test("Gmail outreach requires the exact least-privilege send scope", () => {
  assert.equal(hasGmailSendScope(`${GMAIL_SEND_SCOPE} openid email`), true);
  assert.equal(hasGmailSendScope("openid email"), false);
  assert.equal(hasGmailSendScope("https://mail.google.com/evil"), false);
});

test("legacy reply monitoring recognizes the isolated Gmail readonly scope", () => {
  assert.equal(hasGmailReadScope(`${GMAIL_READONLY_SCOPE} openid email`), true);
  assert.equal(hasGmailReadScope(`${GMAIL_SEND_SCOPE} openid email`), false);
});

test("Gmail outreach rejects coalesced Search Console or broader Gmail scopes", () => {
  assert.equal(
    hasOnlyGmailOutreachScopes(
      `${GMAIL_SEND_SCOPE} ${GMAIL_READONLY_SCOPE} openid https://www.googleapis.com/auth/userinfo.email`,
    ),
    true,
  );
  assert.equal(
    hasOnlyGmailOutreachScopes(
      `${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/webmasters`,
    ),
    false,
  );
  assert.equal(
    hasOnlyGmailOutreachScopes("https://mail.google.com/"),
    false,
  );
  assert.equal(
    hasOnlyGmailOutboundScopes(`${GMAIL_SEND_SCOPE} openid email`),
    true,
  );
  assert.equal(
    hasOnlyGmailOutboundScopes(
      `${GMAIL_SEND_SCOPE} ${GMAIL_READONLY_SCOPE} openid email`,
    ),
    false,
  );
});

test("sender domain normalization handles URLs and common website prefixes", () => {
  assert.equal(normalizeMailDomain("https://www.leadpilot.chat/path"), "leadpilot.chat");
  assert.equal(normalizeMailDomain("getleadpilot.com"), "getleadpilot.com");
});

test("primary, subdomain and consumer inboxes fail closed", () => {
  assert.ok(secondaryGmailSenderIssues({
    siteDomain: "https://leadpilot.chat",
    fromEmail: "hello@leadpilot.chat",
  }).length > 0);
  assert.ok(secondaryGmailSenderIssues({
    siteDomain: "leadpilot.chat",
    fromEmail: "hello@mail.leadpilot.chat",
  }).length > 0);
  assert.ok(secondaryGmailSenderIssues({
    siteDomain: "https://app.example.co.uk",
    fromEmail: "hello@outreach.example.co.uk",
  }).length > 0);
  assert.ok(secondaryGmailSenderIssues({
    siteDomain: "leadpilot.chat",
    fromEmail: "hello@gmail.com",
  }).length > 0);
  assert.deepEqual(secondaryGmailSenderIssues({
    siteDomain: "https://app.example.co.uk",
    fromEmail: "hello@outreach.another.co.uk",
  }), []);
});

test("Gmail connection is server-side, DNS-gated and never accepts Resend", () => {
  const backend = readFileSync("convex/outreach.ts", "utf8");
  const auth = readFileSync(
    "src/app/api/outreach/gmail/auth/route.ts",
    "utf8",
  );
  const callback = readFileSync(
    "src/app/api/outreach/gmail/callback/route.ts",
    "utf8",
  );
  assert.match(backend, /connectGmailInboxInternal = internalMutation/);
  assert.doesNotMatch(backend, /export const connectInbox = mutation/);
  assert.match(backend, /spfVerified && args\.dkimVerified && args\.dmarcVerified/);
  assert.match(backend, /setInboxComplianceProfile = mutation/);
  assert.match(callback, /verifyGoogleWorkspaceDns/);
  assert.match(callback, /hasGmailSendScope/);
  assert.doesNotMatch(callback, /hasGmailReadScope/);
  assert.match(callback, /hasOnlyGmailOutboundScopes/);
  assert.match(callback, /OUTREACH_GOOGLE_CLIENT_ID/);
  assert.doesNotMatch(callback, /GSC_CLIENT_ID/);
  assert.doesNotMatch(callback, /console\.(log|error).*token/i);
  assert.match(auth, /GMAIL_SEND_SCOPE/);
  assert.doesNotMatch(auth, /GMAIL_READONLY_SCOPE|gmail\.readonly/);
  const connect = backend.slice(
    backend.indexOf("export const connectGmailInboxInternal"),
    backend.indexOf("export const setInboxComplianceProfile"),
  );
  assert.doesNotMatch(connect, /did not grant Gmail reply-monitoring permission/);
  assert.match(connect, /existingRefreshHasLegacyRead/);
  assert.match(connect, /reconnectsCurrentMailbox/);
  assert.match(
    connect,
    /!args\.oauthRefreshToken[\s\S]*!reconnectsCurrentMailbox[\s\S]*!existingRefreshIsStrictOutbound/,
  );
  assert.match(
    connect,
    /reconnectsCurrentMailbox[\s\S]*inboundRelayDsnRoutingTargetGeneration/,
  );

  const delivery = readFileSync("convex/actions/outreach.ts", "utf8");
  const refresh = delivery.slice(
    delivery.indexOf("async function refreshGoogleAccessToken"),
    delivery.indexOf("type DeliveryOutcome"),
  );
  assert.match(refresh, /OUTREACH_GOOGLE_CLIENT_ID/);
  assert.match(refresh, /OUTREACH_GOOGLE_CLIENT_SECRET/);
  assert.doesNotMatch(refresh, /GSC_CLIENT_ID|GSC_CLIENT_SECRET/);
});

test("Gmail reconnect preserves the approved sender name and reports readiness honestly", () => {
  assert.deepEqual(
    resolveGmailReconnectProfile({
      existingFromName: "Tenant Team",
      physicalMailingAddress: "123 Market Street, San Francisco, CA 94105",
      complianceConfirmedAt: Date.UTC(2026, 7, 20),
    }),
    { fromName: "Tenant Team", complianceReady: true },
  );
  assert.deepEqual(
    resolveGmailReconnectProfile({
      existingFromName: "Tenant Team",
      requestedFromName: "Updated Sender",
      physicalMailingAddress: "123 Market Street, San Francisco, CA 94105",
      complianceConfirmedAt: Date.UTC(2026, 7, 20),
    }),
    { fromName: "Updated Sender", complianceReady: true },
  );
  assert.deepEqual(
    resolveGmailReconnectProfile({
      physicalMailingAddress: "123 Market Street, San Francisco, CA 94105",
      complianceConfirmedAt: Date.UTC(2026, 7, 20),
    }),
    { fromName: undefined, complianceReady: false },
  );
});
