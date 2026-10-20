import assert from "node:assert/strict";
import test from "node:test";
import { firstArticleEmail, missedSlotCause, missedSlotEmail } from "../convex/lib/customerNotices.ts";

// D4 (P125-P126, Oct 20 2026): what Pentra tells a site's owner, in plain words.

test("a late article's cause: the connection first, then the failure, then topics", () => {
  const base = { destinationVerified: true, plannedTopics: 5, failure: null };
  assert.equal(missedSlotCause({ ...base, destinationVerified: false, failure: "content_provider_unavailable" }), "connection");
  assert.equal(missedSlotCause({ ...base, failure: "account_entitlement_unverified" }), "plan");
  assert.equal(missedSlotCause({ ...base, failure: "content_provider_credit_unavailable" }), "writing_service");
  assert.equal(missedSlotCause({ ...base, failure: "content_recovery_attempts_exhausted" }), "internal");
  assert.equal(missedSlotCause({ ...base, failure: "bounded_content_quality_exhausted" }), "checks");
  assert.equal(missedSlotCause({ ...base, plannedTopics: 0 }), "no_topics");
  assert.equal(missedSlotCause(base), "preparing");
  assert.equal(missedSlotCause({ ...base, plannedTopics: null }), "preparing", "unknown topics are not reported as none");
});

test("the late-article email says why, and asks the owner to act only when they can", () => {
  const deadlineAt = Date.UTC(2026, 9, 20, 18);
  const connection = missedSlotEmail({ domain: "cedarcare.example", deadlineAt, timeZone: "America/Los_Angeles", cause: "connection" });
  assert.equal(connection.subject, "Your Tuesday, October 20 article for cedarcare.example is late");
  assert.match(connection.text, /^The article Pentra scheduled for cedarcare\.example on Tuesday, October 20 hasn't been published yet\./);
  assert.match(connection.text, /Why: Pentra couldn't publish to your site because the publishing connection needs to be checked\./);
  assert.match(connection.text, /What to do: Open Settings \(https:\/\/pentra\.dev\/settings\), go to Publishing and check the connection\./);
  const outage = missedSlotEmail({ domain: "cedarcare.example", deadlineAt, cause: "writing_service" });
  assert.match(outage.text, /Why: A temporary problem with the writing service Pentra uses\. Nothing was published or charged to you\./);
  assert.match(outage.text, /You don't need to do anything\. Pentra keeps working on it and catches up missed articles at most one extra a day\./);
  assert.doesNotMatch(outage.text, /What to do/);
  for (const email of [connection, outage]) assert.match(email.text, /turn these emails off in Settings: https:\/\/pentra\.dev\/settings$/);
  const zone = missedSlotEmail({ domain: "cedarcare.example", deadlineAt: Date.UTC(2026, 9, 21, 2), timeZone: "Not/AZone", cause: "preparing" });
  assert.match(zone.subject, /^Your Wednesday, October 21 article/, "an invalid time zone falls back to UTC");
});

test("the first-article email names the article, the next slot and what Search Console unlocks", () => {
  const email = firstArticleEmail({ domain: "cedarcare.example", title: "How to prepare for a garden visit", url: "https://cedarcare.example/blog/visit",
    nextAt: Date.UTC(2026, 9, 22, 17), intervalMs: 86_400_000, timeZone: "UTC", searchConsole: true });
  assert.equal(email.subject, "Your first article is live on cedarcare.example");
  assert.match(email.text, /"How to prepare for a garden visit"\nhttps:\/\/cedarcare\.example\/blog\/visit/);
  assert.match(email.text, /around Thursday, October 22, then keeps to your schedule \(about 7 a week\)/);
  assert.match(email.text, /Your Google Search Console is connected/);
});
