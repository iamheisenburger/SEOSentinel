import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// P170 (Oct 24 2026): reply monitoring read the newest 100 messages of each of four statuses on every 15-minute poll
// (a flat 256 KB, 25 MB of Convex reads a day) and then kept only those sent in the last 90 days.
test("an IMAP poll reads only the inbox's messages sent in the last 90 days", () => {
  const schema = readFileSync("convex/schema.ts", "utf8");
  assert.match(schema, /\.index\("by_inbox_status_sent", \["inboxId", "status", "sentAt"\]\)/);
  const outreach = readFileSync("convex/outreach.ts", "utf8");
  const claim = outreach.slice(outreach.indexOf("export const claimImapPollInternal"), outreach.indexOf("export const recordImapReceiptInternal"));
  assert.match(claim, /withIndex\("by_inbox_status_sent", \(q\) => q\.eq\("inboxId", inbox\._id\)\.eq\("status", status\)\.gte\("sentAt", sentSince\)\)/);
  assert.doesNotMatch(claim, /withIndex\("by_site_status"/, "never the newest 100 of each status whatever their age");
  assert.match(claim, /message\.siteId === siteId && message\.inboxId === inbox\._id/, "tenant and inbox are still checked on every row");
});
