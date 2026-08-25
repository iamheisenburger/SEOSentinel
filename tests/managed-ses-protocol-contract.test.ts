import assert from "node:assert/strict";
import test from "node:test";

import {
  MANAGED_SES_ACCOUNT_DAILY_ATTEMPT_CAP,
  MANAGED_SES_ACCOUNT_MIN_ATTEMPT_INTERVAL_MS,
  MANAGED_SES_EVENT_CANARY_VALID_MS,
  MANAGED_SES_GLOBAL_DAILY_ATTEMPT_CAP,
  MANAGED_SES_GLOBAL_MIN_ATTEMPT_INTERVAL_MS,
  MANAGED_SES_INBOUND_CANARY_VALID_MS,
  managedSesGlobalPacingDecision,
  managedSesInboundCanaryRelayReceipt,
  managedSesInboxReceiptCurrent,
  managedSesScopedPacingDecision,
  parseManagedSesEventPayload,
  parseManagedSesResourceReceipt,
  parseManagedSesSendReceipt,
} from "../convex/lib/managedSes.ts";
import { inboundRelayConfigurationHash } from
  "../convex/lib/outreachInboundRelay.ts";

const OPERATION = "o".repeat(48);
const RESOURCE = "r".repeat(48);
const ADAPTER = "managed_ses_v1";
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const THREAD = "t".repeat(48);

test("inbound activation HMAC matches the frozen adapter golden vector", async () => {
  const receipt = await managedSesInboundCanaryRelayReceipt({
    secret: "inbound-canary-secret-00000000000000000000000000000000",
    adapterVersion: "managed-ses-v1",
    resourceOperationKey: "r".repeat(40),
    generation: 7,
    operationKey: "c".repeat(40),
    inboxBinding: "a".repeat(64),
    relayConfigurationHash: "b".repeat(64),
    retentionPolicyHash: "d".repeat(64),
    verifiedAtSeconds: 1_787_702_400,
  });
  assert.equal(
    receipt,
    "c08174d55c74ec0b83d1b0dd322942402e19e3a714917a46a946653d40751781",
  );
});

function without<T extends Record<string, unknown>>(
  value: T,
  field: keyof T,
): Record<string, unknown> {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

test("resource receipts require the exact signed operation binding", () => {
  const receipt = {
    state: "ready",
    operationKey: RESOURCE,
    generation: 3,
    adapterVersion: ADAPTER,
    updatedAt: 1_900_000_000,
    fromEmail: "tenant-a@mail.pentra.dev",
    verifiedAt: 1_900_000_000,
    resourceReceipt: HEX_A,
    eventCanaryRequired: true,
    inboundCanaryRequired: true,
  };
  assert.ok(parseManagedSesResourceReceipt(receipt));
  for (const field of [
    "operationKey",
    "generation",
    "adapterVersion",
    "updatedAt",
    "inboundCanaryRequired",
  ] as const) {
    assert.equal(
      parseManagedSesResourceReceipt(without(receipt, field)),
      null,
      field,
    );
  }
  assert.deepEqual(parseManagedSesResourceReceipt({ state: "missing" }), {
    state: "missing",
  });
  assert.equal(parseManagedSesResourceReceipt({
    state: "missing",
    operationKey: RESOURCE,
  }), null);
  assert.ok(parseManagedSesResourceReceipt({
    ...receipt,
    inboundCanaryRequired: true,
    inboundCanary: {
      operationKey: OPERATION,
      inboxBinding: HEX_B,
      relayConfigurationHash: HEX_A,
      retentionPolicyHash: HEX_C,
      classifications: ["reply", "stop"],
      verifiedAt: 1_900_000_000,
      inboundCanaryReceipt: HEX_C,
    },
  }));
});

test("send receipts require operation, resource, purpose, and sequence bindings", () => {
  const receipt = {
    state: "submitted",
    operationKey: OPERATION,
    resourceOperationKey: RESOURCE,
    generation: 3,
    adapterVersion: ADAPTER,
    sequenceStep: 1,
    purpose: "outreach",
    updatedAt: 1_900_000_000,
    providerMessageIdDigest: HEX_A,
    rfcMessageIdDigest: HEX_B,
    threadReceipt: THREAD,
  };
  assert.ok(parseManagedSesSendReceipt(receipt));
  for (const field of [
    "operationKey",
    "resourceOperationKey",
    "generation",
    "adapterVersion",
    "sequenceStep",
    "purpose",
    "updatedAt",
  ] as const) {
    assert.equal(parseManagedSesSendReceipt(without(receipt, field)), null, field);
  }
  assert.equal(
    parseManagedSesSendReceipt({ ...receipt, sequenceStep: 3 }),
    null,
  );
  assert.equal(
    parseManagedSesSendReceipt({ ...receipt, purpose: "prospect" }),
    null,
  );
  assert.deepEqual(parseManagedSesSendReceipt({ state: "missing" }), {
    state: "missing",
  });
  assert.equal(parseManagedSesSendReceipt({
    state: "missing",
    operationKey: OPERATION,
  }), null);

  const terminalEvent = {
    eventType: "complaint",
    occurredAt: "2030-03-17T17:46:40Z",
    eventReceipt: HEX_C,
  };
  assert.ok(parseManagedSesSendReceipt({
    ...receipt,
    state: "event_confirmed",
    terminalDeliveryEvent: terminalEvent,
  }));
  assert.equal(
    parseManagedSesSendReceipt({
      ...receipt,
      state: "submitted",
      terminalDeliveryEvent: terminalEvent,
    }),
    null,
    "terminal semantics are valid only on an event-confirmed receipt",
  );
  for (const field of ["eventType", "occurredAt", "eventReceipt"] as const) {
    assert.equal(
      parseManagedSesSendReceipt({
        ...receipt,
        state: "event_confirmed",
        terminalDeliveryEvent: without(terminalEvent, field),
      }),
      null,
      `partial terminal event omitted ${field}`,
    );
  }
});

test("signed events carry the complete immutable send binding", () => {
  const event = {
    version: 1,
    adapterVersion: ADAPTER,
    operationKey: OPERATION,
    resourceOperationKey: RESOURCE,
    generation: 3,
    sequenceStep: 1,
    purpose: "outreach",
    eventType: "delivered",
    occurredAt: "2030-03-17T17:46:40Z",
    providerMessageIdDigest: HEX_A,
    rfcMessageIdDigest: HEX_B,
    threadReceipt: THREAD,
    eventReceipt: HEX_C,
  };
  assert.ok(parseManagedSesEventPayload(JSON.stringify(event)));
  for (const field of [
    "operationKey",
    "resourceOperationKey",
    "generation",
    "sequenceStep",
    "purpose",
  ] as const) {
    assert.equal(
      parseManagedSesEventPayload(JSON.stringify(without(event, field))),
      null,
      field,
    );
  }
  assert.equal(
    parseManagedSesEventPayload(JSON.stringify({ ...event, sequenceStep: 3 })),
    null,
    "events outside the finite sequence contract are rejected",
  );
  assert.equal(
    parseManagedSesEventPayload(JSON.stringify({ ...event, purpose: "bulk" })),
    null,
    "events outside the finite purpose contract are rejected",
  );
});

test("managed readiness requires both independent current canary receipts", () => {
  const now = 1_900_000_000_000;
  const relaySecret = "s".repeat(32);
  const dsnTargetSecret = "d".repeat(32);
  const retentionPolicyHash = "e".repeat(64);
  const relayConfigurationHash = inboundRelayConfigurationHash({
    domain: "reply.pentra.dev",
    secrets: [relaySecret, undefined],
    dsnTargetSecret,
    adapterVersion: "relay_v1",
    retentionPolicyHash,
    retentionAudited: "true",
  });
  assert.ok(relayConfigurationHash);
  const priorEnv = {
    domain: process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    secret: process.env.OUTREACH_INBOUND_RELAY_SECRET,
    next: process.env.OUTREACH_INBOUND_RELAY_SECRET_NEXT,
    dsn: process.env.OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET,
    adapter: process.env.OUTREACH_INBOUND_RELAY_ADAPTER_VERSION,
    retention: process.env.OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH,
    audited: process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
  };
  process.env.OUTREACH_INBOUND_RELAY_DOMAIN = "reply.pentra.dev";
  process.env.OUTREACH_INBOUND_RELAY_SECRET = relaySecret;
  delete process.env.OUTREACH_INBOUND_RELAY_SECRET_NEXT;
  process.env.OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET = dsnTargetSecret;
  process.env.OUTREACH_INBOUND_RELAY_ADAPTER_VERSION = "relay_v1";
  process.env.OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH = retentionPolicyHash;
  process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED = "true";
  const inbox = {
    provider: "managed_ses",
    managedTransportKind: "managed_ses",
    credentialSource: "managed_adapter",
    managedTransportOperationKey: RESOURCE,
    managedTransportGeneration: 3,
    managedTransportAdapterVersion: ADAPTER,
    managedTransportResourceReceipt: HEX_A,
    managedTransportResourceVerifiedAt: now - 60_000,
    managedTransportEventCanaryVerifiedAt: now - 60_000,
    managedTransportEventCanaryReceipt: HEX_B,
    managedTransportEventCanaryOperationKey: OPERATION,
    managedTransportEventProviderMessageIdDigest: HEX_C,
    managedTransportInboundCanaryVerifiedAt: now - 60_000,
    managedTransportInboundCanaryReceipt: HEX_A,
    managedTransportInboundCanaryOperationKey: "i".repeat(48),
    managedTransportInboundCanaryInboxBinding: HEX_B,
    managedTransportInboundCanaryAdapterVersion: ADAPTER,
    managedTransportInboundCanaryRelayConfigurationHash:
      relayConfigurationHash,
    managedTransportInboundCanaryRetentionPolicyHash: retentionPolicyHash,
  };
  try {
    assert.equal(managedSesInboxReceiptCurrent({
      inbox,
      now,
      expectedAdapterVersion: ADAPTER,
    }), true);
    assert.equal(managedSesInboxReceiptCurrent({
      inbox: { ...inbox, managedTransportEventCanaryReceipt: undefined },
      now,
      expectedAdapterVersion: ADAPTER,
    }), false);
    assert.equal(managedSesInboxReceiptCurrent({
      inbox: { ...inbox, managedTransportInboundCanaryReceipt: undefined },
      now,
      expectedAdapterVersion: ADAPTER,
    }), false);
    assert.equal(managedSesInboxReceiptCurrent({
      inbox: {
        ...inbox,
        managedTransportEventCanaryVerifiedAt:
          now - MANAGED_SES_EVENT_CANARY_VALID_MS - 1,
      },
      now,
      expectedAdapterVersion: ADAPTER,
    }), false);
    assert.equal(managedSesInboxReceiptCurrent({
      inbox: {
        ...inbox,
        managedTransportInboundCanaryVerifiedAt:
          now - MANAGED_SES_INBOUND_CANARY_VALID_MS - 1,
      },
      now,
      expectedAdapterVersion: ADAPTER,
    }), false);
  } finally {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("OUTREACH_INBOUND_RELAY_DOMAIN", priorEnv.domain);
    restore("OUTREACH_INBOUND_RELAY_SECRET", priorEnv.secret);
    restore("OUTREACH_INBOUND_RELAY_SECRET_NEXT", priorEnv.next);
    restore("OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET", priorEnv.dsn);
    restore("OUTREACH_INBOUND_RELAY_ADAPTER_VERSION", priorEnv.adapter);
    restore(
      "OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH",
      priorEnv.retention,
    );
    restore("OUTREACH_INBOUND_RELAY_RETENTION_AUDITED", priorEnv.audited);
  }
});

test("global and tenant pacing both fail closed at cap and interval", () => {
  const now = Date.UTC(2030, 2, 17, 12, 0, 0);
  const day = "2030-03-17";
  assert.equal(managedSesGlobalPacingDecision({ now }).allowed, true);
  assert.equal(managedSesGlobalPacingDecision({
    now,
    attemptedTodayDay: day,
    attemptedToday: MANAGED_SES_GLOBAL_DAILY_ATTEMPT_CAP,
  }).allowed, false);
  assert.equal(managedSesGlobalPacingDecision({
    now,
    lastAttemptAt: now - MANAGED_SES_GLOBAL_MIN_ATTEMPT_INTERVAL_MS + 1,
  }).allowed, false);
  assert.equal(managedSesScopedPacingDecision({
    now,
    attemptedTodayDay: day,
    attemptedToday: MANAGED_SES_ACCOUNT_DAILY_ATTEMPT_CAP,
    dailyCap: MANAGED_SES_ACCOUNT_DAILY_ATTEMPT_CAP,
    minimumIntervalMs: MANAGED_SES_ACCOUNT_MIN_ATTEMPT_INTERVAL_MS,
    scope: "account",
  }).allowed, false);
  assert.equal(managedSesScopedPacingDecision({
    now,
    attemptedTodayDay: "2030-03-16",
    attemptedToday: MANAGED_SES_ACCOUNT_DAILY_ATTEMPT_CAP,
    lastAttemptAt: now - MANAGED_SES_ACCOUNT_MIN_ATTEMPT_INTERVAL_MS,
    dailyCap: MANAGED_SES_ACCOUNT_DAILY_ATTEMPT_CAP,
    minimumIntervalMs: MANAGED_SES_ACCOUNT_MIN_ATTEMPT_INTERVAL_MS,
    scope: "account",
  }).allowed, true);
});
