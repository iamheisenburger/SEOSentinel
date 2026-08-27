import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decryptOutreachCredentials,
  encryptOutreachCredentials,
  outreachCredentialBinding,
  outreachCredentialKeyConfig,
} from "../convex/lib/outreachCredentialEncryption.ts";
import {
  classifyImapEvidence,
  imapEventKey,
  type ImapCandidate,
  type ImapEvidence,
} from "../convex/lib/outreachImap.ts";

const KEY = {
  keyId: "test-v1",
  keyBase64: Buffer.alloc(32, 7).toString("base64"),
};
const BINDING = outreachCredentialBinding({
  siteId: "site-a",
  configurationVersion: 3,
  fromEmail: "sender@example.com",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "sender@example.com",
  imapHost: "imap.example.com",
  imapPort: 993,
  imapUsername: "sender@example.com",
});

test("SMTP and IMAP secrets round-trip only under the exact tenant binding", async () => {
  const encrypted = await encryptOutreachCredentials({
    secrets: { smtpPassword: "smtp-value", imapPassword: "imap-value" },
    binding: BINDING,
    key: KEY,
  });
  assert.equal(encrypted.credentialKeyId, KEY.keyId);
  assert.doesNotMatch(encrypted.credentialCiphertext, /smtp-value|imap-value/);
  assert.deepEqual(await decryptOutreachCredentials({
    encrypted, binding: BINDING, key: KEY,
  }), { smtpPassword: "smtp-value", imapPassword: "imap-value" });
  await assert.rejects(
    decryptOutreachCredentials({ encrypted, binding: `${BINDING}:other`, key: KEY }),
    /binding is not current/,
  );
});

test("credential tampering and key rotation fail closed", async () => {
  const encrypted = await encryptOutreachCredentials({
    secrets: { smtpPassword: "first-value", imapPassword: "second-value" },
    binding: BINDING,
    key: KEY,
  });
  const [iv, body] = encrypted.credentialCiphertext.split(".");
  await assert.rejects(decryptOutreachCredentials({
    encrypted: { ...encrypted, credentialCiphertext: `${iv}.${body.slice(0, -2)}AA` },
    binding: BINDING,
    key: KEY,
  }));
  await assert.rejects(decryptOutreachCredentials({
    encrypted,
    binding: BINDING,
    key: { keyId: "test-v2", keyBase64: Buffer.alloc(32, 8).toString("base64") },
  }));
  assert.deepEqual(outreachCredentialKeyConfig({
    OUTREACH_CREDENTIAL_ENCRYPTION_KEY_ID: "test-v2",
    OUTREACH_CREDENTIAL_ENCRYPTION_KEY_V1:
      Buffer.alloc(32, 8).toString("base64"),
    OUTREACH_CREDENTIAL_ENCRYPTION_KEYRING_V1: JSON.stringify({
      "test-v1": KEY.keyBase64,
    }),
  }, "test-v1"), KEY);
});

const CANDIDATE: ImapCandidate = {
  messageId: "message-a",
  toEmail: "recipient@company.example",
  toDomain: "company.example",
  sentAt: 1_000,
  outboundMessageIdHash: "a".repeat(64),
};

function evidence(overrides: Partial<ImapEvidence> = {}): ImapEvidence {
  return {
    uidValidity: "42",
    uid: 8,
    inboundMessageIdHash: "b".repeat(64),
    referencedMessageIdHashes: [CANDIDATE.outboundMessageIdHash],
    fromEmail: CANDIDATE.toEmail,
    subject: "Re: useful resource",
    bodyText: "Thanks for sharing this.",
    mimeTypes: [],
    failedRecipients: [],
    authenticationResults:
      "mx.example; dmarc=pass header.from=company.example; dkim=pass header.d=company.example",
    receivedAt: 2_000,
    ...overrides,
  };
}

test("IMAP classifies exact replies and STOP while rejecting unbound mail", () => {
  assert.equal(classifyImapEvidence({
    evidence: evidence(), candidates: [CANDIDATE], mailboxEmail: "sender@example.com",
  })?.kind, "reply");
  assert.equal(classifyImapEvidence({
    evidence: evidence({ bodyText: "STOP" }),
    candidates: [CANDIDATE], mailboxEmail: "sender@example.com",
  })?.kind, "unsubscribe");
  assert.equal(classifyImapEvidence({
    evidence: evidence({ referencedMessageIdHashes: [] }),
    candidates: [CANDIDATE], mailboxEmail: "sender@example.com",
  }), null);
  assert.equal(classifyImapEvidence({
    evidence: evidence({ authenticationResults: "dmarc=fail" }),
    candidates: [CANDIDATE], mailboxEmail: "sender@example.com",
  }), null);
});

test("hard bounces require both the random message binding and exact failed recipient", () => {
  const bounce = evidence({
    fromEmail: "mailer-daemon@example.com",
    subject: "Delivery Status Notification (Failure)",
    mimeTypes: ["message/delivery-status"],
    failedRecipients: [CANDIDATE.toEmail],
  });
  assert.equal(classifyImapEvidence({
    evidence: bounce, candidates: [CANDIDATE], mailboxEmail: "sender@example.com",
  })?.kind, "bounce");
  assert.equal(classifyImapEvidence({
    evidence: { ...bounce, failedRecipients: ["other@company.example"] },
    candidates: [CANDIDATE], mailboxEmail: "sender@example.com",
  }), null);
});

test("IMAP cursor identity is tenant and UIDVALIDITY scoped", () => {
  assert.equal(imapEventKey({
    siteId: "site-a", inboxId: "inbox-a", uidValidity: "42", uid: 8,
  }), imapEventKey({
    siteId: "site-a", inboxId: "inbox-a", uidValidity: "42", uid: 8,
  }));
  assert.notEqual(imapEventKey({
    siteId: "site-a", inboxId: "inbox-a", uidValidity: "42", uid: 8,
  }), imapEventKey({
    siteId: "site-b", inboxId: "inbox-a", uidValidity: "42", uid: 8,
  }));
});

test("production wiring encrypts before persistence and keeps SMTP approval-only", () => {
  const outreach = readFileSync("convex/outreach.ts", "utf8");
  const actions = readFileSync("convex/actions/outreach.ts", "utf8");
  const schema = readFileSync("convex/schema.ts", "utf8");
  assert.match(outreach, /encryptOutreachCredentials/);
  assert.match(outreach, /smtpPassword: undefined/);
  assert.match(outreach, /Customer-managed SMTP\/IMAP is approval-only/);
  assert.match(outreach, /PENTRA_FULL_MANAGED_BETA_ENABLED !== "true"/);
  assert.match(outreach, /inbox\.provider !== "smartlead"/);
  assert.match(outreach, /claimImapPollInternal/);
  assert.match(outreach, /recordImapReceiptInternal/);
  assert.match(outreach, /cancelQueuedThread/);
  assert.match(actions, /simpleParser/);
  assert.match(actions, /OUTREACH_IMAP_MAX_MESSAGE_BYTES/);
  assert.match(actions, /inboundRelayMessageIdHash\(imapOutboundRfcMessageId\)/);
  assert.match(schema, /outreach_imap_receipts: defineTable/);
  assert.match(schema, /by_inbox_uid/);
});
