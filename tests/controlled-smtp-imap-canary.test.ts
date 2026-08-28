import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  controlledCanaryMaySuppressDomain,
  controlledSmtpImapCanaryOperationKey,
  controlledSmtpImapCanaryTarget,
} from "../convex/lib/outreachControlledCanary.ts";

test("controlled canary operations are stable and tenant/configuration scoped", () => {
  const base = {
    siteId: "site-a",
    inboxId: "inbox-a",
    configurationVersion: 4,
    kind: "imap_reply" as const,
  };
  const key = controlledSmtpImapCanaryOperationKey(base);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(controlledSmtpImapCanaryOperationKey(base), key);
  assert.notEqual(
    controlledSmtpImapCanaryOperationKey({ ...base, siteId: "site-b" }),
    key,
  );
  assert.notEqual(
    controlledSmtpImapCanaryOperationKey({ ...base, configurationVersion: 5 }),
    key,
  );
  assert.notEqual(
    controlledSmtpImapCanaryOperationKey({ ...base, kind: "imap_stop" }),
    key,
  );
});

test("the coordinator cannot target a prospect", () => {
  const operationKey = controlledSmtpImapCanaryOperationKey({
    siteId: "site-a",
    inboxId: "inbox-a",
    configurationVersion: 1,
    kind: "smtp_delivery",
  });
  for (const kind of ["smtp_delivery", "imap_reply", "imap_stop"] as const) {
    assert.equal(
      controlledSmtpImapCanaryTarget({
        kind,
        mailboxEmail: "Owner@Example.com",
        operationKey,
      }),
      "owner@example.com",
    );
  }
  assert.match(
    controlledSmtpImapCanaryTarget({
      kind: "imap_bounce",
      mailboxEmail: "owner@example.com",
      operationKey,
    }),
    /^pentra-canary-[a-f0-9]{20}@example\.invalid$/,
  );
});

test("a controlled STOP suppresses the exact address but not a shared domain", () => {
  assert.equal(controlledCanaryMaySuppressDomain("imap_stop"), false);
  assert.equal(controlledCanaryMaySuppressDomain(undefined), true);
});

test("canary rows stay out of customer queues and use no-replay boundaries", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const outreach = fs.readFileSync(path.join(root, "convex/outreach.ts"), "utf8");
  const action = fs.readFileSync(
    path.join(root, "convex/actions/outreach.ts"),
    "utf8",
  );
  const canaryAction = action.slice(
    action.indexOf("export const runControlledSmtpImapCanaryInternal"),
    action.indexOf("// ── Inbound reply", action.indexOf(
      "export const runControlledSmtpImapCanaryInternal",
    )),
  );
  assert.match(outreach, /filter\(\(message\) => !message\.controlledCanaryKind\)/);
  assert.match(outreach, /deliveryExternalAttemptedAt: now/);
  assert.match(outreach, /controlledCanarySignalAttemptedAt: now/);
  assert.match(canaryAction, /runControlledSmtpImapCanaryInternal/);
  assert.doesNotMatch(canaryAction, /toEmail:\s*args\./);
});
