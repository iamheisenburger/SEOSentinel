import assert from "node:assert/strict";
import test from "node:test";

import {
  SMTP_IMPLICIT_TLS_PORT,
  SMTP_PRESETS,
  SMTP_SUBMISSION_PORT,
  classifySmtpFailure,
  describeSmtpIssue,
  smtpConfigIssues,
  smtpTransportOptions,
} from "../convex/lib/outreachSmtp.ts";

/**
 * SMTP exists because Gmail OAuth cannot be the only path: gmail.send is a
 * Google restricted scope, so an unverified app serves only hand-added
 * testers. A general SaaS cannot require the operator to approve each paying
 * customer, so every tenant must be able to connect a mailbox unaided.
 */

const VALID = {
  host: "smtp.gmail.com",
  port: SMTP_SUBMISSION_PORT,
  username: "sender@example.com",
  password: "app-password",
  fromEmail: "sender@example.com",
};

test("a complete configuration is accepted", () => {
  assert.deepEqual(smtpConfigIssues(VALID), []);
});

test("every missing field is reported at once, not one per failed save", () => {
  const issues = smtpConfigIssues({});
  assert.deepEqual(issues.sort(), [
    "from_email_invalid",
    "host_missing",
    "password_missing",
    "port_missing",
    "username_missing",
  ]);
  for (const issue of issues) {
    assert.ok(describeSmtpIssue(issue).length > 0, issue);
  }
});

test("relay and unsupported ports are refused before they can silently fail", () => {
  assert.deepEqual(smtpConfigIssues({ ...VALID, port: 25 }), ["plaintext_port"]);
  assert.deepEqual(smtpConfigIssues({ ...VALID, port: 8080 }), ["port_unsupported"]);
  assert.deepEqual(smtpConfigIssues({ ...VALID, port: SMTP_IMPLICIT_TLS_PORT }), []);
});

test("an invalid host or sender address is caught", () => {
  assert.deepEqual(smtpConfigIssues({ ...VALID, host: "not a host" }), ["host_invalid"]);
  assert.deepEqual(smtpConfigIssues({ ...VALID, fromEmail: "nope" }), ["from_email_invalid"]);
});

test("transport always negotiates TLS, on either port", () => {
  const starttls = smtpTransportOptions(VALID);
  assert.equal(starttls.secure, false);
  assert.equal(starttls.requireTLS, true, "587 must be forced to upgrade");
  assert.equal(starttls.host, "smtp.gmail.com");
  assert.equal(starttls.port, SMTP_SUBMISSION_PORT);

  const implicit = smtpTransportOptions({ ...VALID, port: SMTP_IMPLICIT_TLS_PORT });
  assert.equal(implicit.secure, true, "465 is implicit TLS");
});

test("an incomplete configuration can never build a transport", () => {
  assert.throws(() => smtpTransportOptions({ ...VALID, password: "" }));
  assert.throws(() => smtpTransportOptions({}));
});

test("presets cover the providers tenants actually use", () => {
  const ids = SMTP_PRESETS.map((preset) => preset.id);
  for (const expected of ["gmail", "outlook", "zoho"]) {
    assert.ok(ids.includes(expected), expected);
  }
  for (const preset of SMTP_PRESETS) {
    assert.deepEqual(
      smtpConfigIssues({
        host: preset.host,
        port: preset.port,
        username: VALID.username,
        password: VALID.password,
        fromEmail: VALID.fromEmail,
      }),
      [],
      preset.id,
    );
  }
});

test("failures are classified into an action the tenant can take", () => {
  const auth = classifySmtpFailure("535-5.7.8 Username and Password not accepted");
  assert.equal(auth.reason, "authentication_failed");
  assert.equal(auth.retryable, false);
  assert.match(auth.operatorMessage, /app password/i);

  assert.equal(classifySmtpFailure("ECONNREFUSED 1.2.3.4:587").reason, "connection_failed");
  assert.equal(classifySmtpFailure("ECONNREFUSED").retryable, true);
  assert.equal(classifySmtpFailure("STARTTLS not supported").reason, "tls_failed");
  assert.equal(classifySmtpFailure("550 mailbox unavailable").reason, "recipient_rejected");
  assert.equal(classifySmtpFailure("4.7.0 too many login attempts").reason, "rate_limited");
  assert.equal(classifySmtpFailure("something odd").reason, "unknown");
});

test("classification never echoes the provider's raw text", () => {
  const raw = "535 auth failed for sender@example.com on mail.internal.corp";
  const classified = classifySmtpFailure(raw);
  assert.equal(classified.operatorMessage.includes("sender@example.com"), false);
  assert.equal(classified.operatorMessage.includes("mail.internal.corp"), false);
});
