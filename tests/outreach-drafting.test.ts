import assert from "node:assert/strict";
import test from "node:test";

import {
  draftFollowUp,
  draftOutreachMessage,
  isUsableMentionContext,
  outreachThreadKey,
  sharesBrandName,
} from "../convex/lib/outreachDrafting.ts";
import { outreachComplianceIssues } from "../convex/lib/outreachPacing.ts";

const BROKEN = {
  type: "broken_link",
  sourceUrl: "https://example-blog.com/posts/cro-guide",
  sourceDomain: "example-blog.com",
  targetUrl: "https://tenant.com/blog/conversion-optimization-tools",
  brokenUrl: "https://deadvendor.io/tools",
  anchorText: "conversion tools roundup",
  brandName: "Tenant",
  senderName: "Sam Rivers",
  physicalMailingAddress: "123 Market Street, San Francisco, CA 94105",
};

const MENTION = {
  type: "unlinked_mention",
  sourceUrl: "https://example-blog.com/posts/stack",
  sourceDomain: "example-blog.com",
  targetUrl: "https://tenant.com/",
  context: "We have been trialling Tenant alongside two other tools this quarter.",
  brandName: "Tenant",
  senderName: "Sam Rivers",
  physicalMailingAddress: "123 Market Street, San Francisco, CA 94105",
};

test("a broken-link draft names only verified facts", () => {
  const draft = draftOutreachMessage(BROKEN);
  assert.ok(draft);
  assert.ok(draft.body.includes(BROKEN.sourceUrl));
  assert.ok(draft.body.includes(BROKEN.brokenUrl));
  assert.ok(draft.body.includes(BROKEN.targetUrl));
  assert.ok(draft.body.includes("conversion tools roundup"));
  assert.doesNotMatch(draft.body, /covers the same ground/i);
  assert.match(draft.body, /assess as a replacement/i);
  assert.match(draft.subject, /Dead link on \/posts\/cro-guide/);
});

test("an unlinked-mention draft quotes the mention verbatim", () => {
  const draft = draftOutreachMessage(MENTION);
  assert.ok(draft);
  assert.ok(draft.body.includes(MENTION.context));
  assert.ok(draft.body.includes(MENTION.targetUrl));
});

test("every generated draft passes compliance unchanged", () => {
  for (const evidence of [BROKEN, MENTION]) {
    const draft = draftOutreachMessage(evidence);
    assert.ok(draft);
    assert.deepEqual(
      outreachComplianceIssues({
        body: draft.body,
        toEmail: "editor@example-blog.com",
        fromEmail: "sam@tenant.com",
        physicalMailingAddress: evidence.physicalMailingAddress,
      }),
      [],
      evidence.type,
    );
  }
});

test("drafts make no performance, traffic or ranking claim", () => {
  const forbidden =
    /\b(rank(ing)?s? (higher|better)|traffic (boost|increase)|guarantee|SEO juice|domain authority will|drive \d+)/i;
  for (const evidence of [BROKEN, MENTION]) {
    const draft = draftOutreachMessage(evidence);
    assert.ok(draft);
    assert.equal(forbidden.test(draft.body), false, evidence.type);
  }
});

test("incomplete evidence produces no draft at all", () => {
  assert.equal(draftOutreachMessage({ ...BROKEN, brokenUrl: "" }), null);
  assert.equal(draftOutreachMessage({ ...MENTION, context: "" }), null);
  assert.equal(draftOutreachMessage({ ...BROKEN, senderName: " " }), null);
  assert.equal(draftOutreachMessage({ ...BROKEN, type: "purchased_link" }), null);
});

test("follow-ups exist for two steps only and the last one says so", () => {
  const first = draftFollowUp({ evidence: BROKEN, sequenceStep: 1 });
  const last = draftFollowUp({ evidence: BROKEN, sequenceStep: 2 });
  assert.ok(first && last);
  assert.match(first.subject, /^Re: /);
  assert.match(last.body, /will not follow up again/);
  assert.equal(draftFollowUp({ evidence: BROKEN, sequenceStep: 3 }), null);
  assert.equal(draftFollowUp({ evidence: BROKEN, sequenceStep: 0 }), null);
});

test("scraped navigation chrome is not a mention worth quoting", () => {
  // The exact string production produced for leadpilot.com: menu labels, not
  // a sentence about anyone.
  assert.equal(
    isUsableMentionContext(
      "Customers - LeadPilot Skip to content Platform Platform Product overview Explore the power of LeadPilot Integrations Connect your tools Features Find leads New B2B leads automatic…",
    ),
    false,
  );
  assert.equal(isUsableMentionContext("Tenant is great."), false, "too short");
  assert.equal(
    isUsableMentionContext(
      "We have been trialling Tenant alongside two other tools this quarter and it handled the qualification step better than the rest.",
    ),
    true,
  );
});

test("a namesake company is never asked for a link", () => {
  assert.equal(sharesBrandName("https://leadpilot.com/en/customers/", "LeadPilot"), true);
  assert.equal(sharesBrandName("blog.adobe.com", "LeadPilot"), false);
  assert.equal(sharesBrandName("acme.io", "Ac"), false, "short brands must not match");

  assert.equal(
    draftOutreachMessage({
      ...MENTION,
      sourceUrl: "https://leadpilot.com/en/customers/",
      sourceDomain: "leadpilot.com",
      brandName: "LeadPilot",
      context:
        "We have been trialling LeadPilot alongside two other tools this quarter and it handled the qualification step better than the rest.",
    }),
    null,
  );
});

test("a brand with no human sender signs once, not twice", () => {
  const draft = draftOutreachMessage({
    ...BROKEN,
    senderName: "LeadPilot",
    brandName: "LeadPilot",
  });
  assert.ok(draft);
  assert.equal(draft.body.includes("LeadPilot, LeadPilot"), false);
  assert.match(draft.body, /Thanks,\nLeadPilot\n/);
  assert.match(draft.body, /123 Market Street/);
});

test("thread keys group a domain per tenant and never across tenants", () => {
  assert.equal(
    outreachThreadKey("siteA", "https://www.Example-Blog.com/x"),
    outreachThreadKey("siteA", "example-blog.com"),
  );
  assert.notEqual(
    outreachThreadKey("siteA", "example-blog.com"),
    outreachThreadKey("siteB", "example-blog.com"),
  );
});
