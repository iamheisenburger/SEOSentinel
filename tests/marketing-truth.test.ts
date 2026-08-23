import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public Pentra copy does not claim unsupported autonomous refresh or acquired backlinks", () => {
  const homepage = readFileSync("src/app/page.tsx", "utf8");
  const onboarding = readFileSync(
    "src/components/onboarding/setup-wizard.tsx",
    "utf8",
  );
  const combined = `${homepage}\n${onboarding}`;
  assert.doesNotMatch(combined, /auto-refresh/i);
  assert.doesNotMatch(combined, /automatically refresh/i);
  assert.doesNotMatch(combined, /builds backlinks/i);
  assert.match(homepage, /approval-first outreach/i);
  assert.match(homepage, /exact-link receipts/i);
  assert.doesNotMatch(homepage, /94%|142 keywords|2,847 words|3-5 minutes|64% of B2B teams/);
  assert.match(homepage, /Generation time varies with research depth/);
});

test("disabled syndication is not advertised or offered as a credential-collecting control", () => {
  const homepage = readFileSync("src/app/page.tsx", "utf8");
  const onboarding = readFileSync(
    "src/components/onboarding/setup-wizard.tsx",
    "utf8",
  );
  const settings = readFileSync(
    "src/app/(dashboard)/sites/[siteId]/page.tsx",
    "utf8",
  );
  const backend = readFileSync("convex/actions/syndication.ts", "utf8");

  assert.doesNotMatch(homepage, /Syndicates to Medium|Auto-distribute to Medium|Syndicate to/);
  assert.match(homepage, /Automatic Medium and LinkedIn syndication is not currently available/);
  for (const ui of [onboarding, settings]) {
    assert.match(ui, /Automatic Medium and LinkedIn syndication is not available yet/);
    assert.doesNotMatch(ui, /Auto-Syndicate|Medium Integration Token|LinkedIn Access Token/);
    assert.doesNotMatch(ui, /mediumToken\s*:|linkedinAccessToken\s*:|syndicationEnabled\s*:/);
  }
  assert.equal(
    backend.match(/Syndication is disabled pending an audited downstream delivery workflow/g)?.length,
    3,
  );
});

test("published content exposes the immutable revision boundary instead of a broken refresh button", () => {
  const article = readFileSync(
    "src/app/(dashboard)/articles/[id]/page.tsx",
    "utf8",
  );
  assert.match(article, /article\.status === "published"/);
  assert.match(article, /will not overwrite the live page without a newly audited revision/);
  assert.match(article, /Direct model refresh is disabled/);
  assert.doesNotMatch(article, /refreshArticleAction|Refresh Article/);
});

test("annual billing copy matches cancellation-through-period-end semantics", () => {
  const homepage = readFileSync("src/app/page.tsx", "utf8");
  const terms = readFileSync("src/app/legal/terms/page.tsx", "utf8");

  assert.match(homepage, /Monthly and annual plans can be canceled anytime/);
  assert.match(homepage, /remains active through the end of the current billing period/);
  assert.doesNotMatch(homepage, /All plans are month-to-month/);
  assert.match(terms, /Billing is processed monthly or annually/);
  assert.match(terms, /remain active until the end of the current billing period/);
});

test("account-deletion copy matches immediate revocation and resumable purge semantics", () => {
  const terms = readFileSync("src/app/legal/terms/page.tsx", "utf8");
  const privacy = readFileSync("src/app/legal/privacy/page.tsx", "utf8");
  const combined = `${terms}\n${privacy}`;

  assert.match(combined, /immediately stops (?:execution|automated execution)/);
  assert.match(combined, /revokes stored publishing, search, and outreach credentials/);
  assert.match(combined, /bounded, resumable purge/);
  assert.match(combined, /minimal billing, abuse-prevention, quota, and provider-spend receipts/);
  assert.doesNotMatch(combined, /retained for 30 days|removed within 30 days/);
});

test("the upgrade screen never pretends URL parameters preselect Clerk checkout", () => {
  const upgrade = readFileSync(
    "src/app/(dashboard)/upgrade/page.tsx",
    "utf8",
  );
  assert.match(upgrade, /Choose your plan and billing period in the secure table below/);
  assert.match(upgrade, /<PricingTable/);
  assert.doesNotMatch(upgrade, /useSearchParams|PLAN_PRICES|PLAN_LABELS/);
  assert.doesNotMatch(upgrade, /Complete checkout for|billed annually \(save/);
});

test("public pricing limits Enterprise's unlimited claim to sites", () => {
  const pricing = readFileSync(
    "src/components/landing/pricing-section.tsx",
    "utf8",
  );
  assert.match(pricing, /Unlimited sites for large operations/);
  assert.match(pricing, /articles: "150 articles \/ month"/);
  assert.doesNotMatch(pricing, /Unlimited scale/);
});

test("legacy direct refresh authenticates and fails before unmetered providers", () => {
  const decay = readFileSync("convex/actions/contentDecay.ts", "utf8");
  const start = decay.indexOf("export const refreshArticle = action(");
  const end = decay.indexOf("// ── Auto-Refresh:", start);
  const block = decay.slice(start, end);
  const ownerCheck = block.indexOf("identity.subject !== site.userId");
  const disabledAt = block.indexOf("bypasses article quota and provider budgets");
  assert.ok(start >= 0 && end > start);
  assert.ok(ownerCheck >= 0 && disabledAt > ownerCheck);
  assert.match(block, /audited recovery and revision workflow/);
  assert.doesNotMatch(block, /openai|anthropic|messages\.create|responses\.create/);
});
