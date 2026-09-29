import assert from "node:assert/strict";
import test from "node:test";
import { SIGNUP_REPORT_WINDOW_MS, shouldReportSignup, signupReportKey } from "../src/lib/signup-conversion.ts";

test("a new account reports one sign-up; older accounts and repeats never do", () => {
  const now = Date.UTC(2026, 8, 29, 12);
  assert.equal(shouldReportSignup(now - 60_000, now, false), true, "just signed up");
  assert.equal(shouldReportSignup(now - 60_000, now, true), false, "already reported in this browser");
  assert.equal(shouldReportSignup(now - SIGNUP_REPORT_WINDOW_MS - 1, now, false), false, "an existing user signing in");
  assert.equal(shouldReportSignup(null, now, false), false);
  assert.equal(shouldReportSignup(now + 60_000, now, false), false, "clock skew never reports");
  assert.equal(signupReportKey("user_1"), "pentra_signup_reported_user_1");
});
