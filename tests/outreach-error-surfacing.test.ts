import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const OUTREACH = readFileSync(
  new URL("../convex/outreach.ts", import.meta.url),
  "utf8",
);

/**
 * Regression for undiagnosable outreach setup failures.
 *
 * Convex redacts plain Error messages in production, so every validation
 * reason in configureSmtpInbox reached the operator as "Server Error". An
 * owner whose mailbox was already connected to one of their other sites was
 * told nothing at all, and the only way to find out was to read the database.
 * ConvexError messages are delivered to the client intact.
 */

function configureSmtpInboxSource(): string {
  const start = OUTREACH.indexOf("export const configureSmtpInbox = mutation");
  assert.ok(start > 0, "configureSmtpInbox must exist");
  const next = OUTREACH.indexOf("export const", start + 10);
  return OUTREACH.slice(start, next);
}

test("ConvexError is imported so messages survive production redaction", () => {
  assert.match(OUTREACH, /import \{ ConvexError, v \} from "convex\/values"/);
});

test("no owner-actionable failure in SMTP setup throws a redacted Error", () => {
  const block = configureSmtpInboxSource();
  assert.doesNotMatch(
    block,
    /throw new Error\(/,
    "a plain Error reaches the operator as 'Server Error' and cannot be acted on",
  );
  assert.match(block, /throw new ConvexError\(/);
});

test("a mailbox conflict names the owner's other site", () => {
  const block = configureSmtpInboxSource();
  assert.match(block, /outboundIdentityConflictLabel/);
  assert.match(block, /already the outreach mailbox for/);
  assert.match(block, /Disconnect it there first/);
});

test("a conflict on someone else's account is never named", () => {
  // Disclosing another customer's site would leak their configuration.
  assert.match(OUTREACH, /holderSite\.userId !== ownerUserId\) continue/);
  assert.match(OUTREACH, /already connected as an outreach mailbox on another account/);
});

test("the postal-address rule states the actual minimum", () => {
  const block = configureSmtpInboxSource();
  assert.match(block, /at least 15 characters/);
});
