import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public Pentra copy sells only what the product delivers", () => {
  const homepage = readFileSync("src/app/page.tsx", "utf8");
  const onboarding = readFileSync(
    "src/components/onboarding/setup-wizard.tsx",
    "utf8",
  );
  const combined = `${homepage}\n${onboarding}`;
  assert.doesNotMatch(combined, /auto-refresh/i);
  assert.doesNotMatch(combined, /automatically refresh/i);
  assert.doesNotMatch(combined, /builds backlinks/i);
  assert.doesNotMatch(homepage, /hero images|infographic|approval-first outreach|autonomous/i);
  assert.match(homepage, /Autopilot only publishes articles that pass the fact check/);
  // Limits are stated where buyers ask about them (FAQ), not as a "does not do" list.
  assert.match(homepage, /automatic publishing there is coming soon/);
  assert.match(homepage, /No one can honestly guarantee rankings/);
  assert.doesNotMatch(homepage, /backlink/i);
  assert.doesNotMatch(homepage, /94%|142 keywords|2,847 words|3-5 minutes|64% of B2B teams/);
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

  assert.doesNotMatch(homepage, /Syndicates to Medium|Auto-distribute to Medium|Syndicate to|syndication/i);
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
  // Checkout starts only from an explicit plan button (Clerk's CheckoutButton),
  // and Clerk's own table remains the fallback so checkout always works.
  assert.match(upgrade, /<CheckoutButton/);
  assert.match(upgrade, /<PricingTable for="user" newSubscriptionRedirectUrl="\/dashboard"/);
  assert.match(upgrade, /useState<BillingSubscriptionPlanPeriod>\("month"\)/);
  assert.doesNotMatch(upgrade, /Enterprise/i);
  assert.doesNotMatch(upgrade, /useSearchParams|PLAN_PRICES|PLAN_LABELS/);
  assert.doesNotMatch(upgrade, /Complete checkout for|billed annually \(save/);
  assert.doesNotMatch(upgrade, /secure table below/);
  // In-app plan cards must match the public pricing exactly.
  const pricing = readFileSync("src/components/landing/pricing-section.tsx", "utf8");
  const prices = [...pricing.matchAll(/monthlyPrice: (\d+),\s*annualPrice: (\d+),/g)];
  const allowances = [...pricing.matchAll(/(sites|articles): "([^"]+)"/g)];
  assert.equal(prices.length, 4);
  for (const [, monthly, annual] of prices) {
    assert.match(upgrade, new RegExp(`monthlyPrice: ${monthly},\\s*annualPrice: ${annual},`));
  }
  for (const [, field, value] of allowances) assert.ok(upgrade.includes(`${field}: "${value}"`), value);
});

test("public pricing matches the enforced monthly article allowance and hides Enterprise", async () => {
  const pricing = readFileSync(
    "src/components/landing/pricing-section.tsx",
    "utf8",
  );
  const contentWork = readFileSync("convex/contentWork.ts", "utf8");
  const allowance = /OWNER_DRAFTS_PER_MONTH = \{ free: (\d+), starter: (\d+), pro: (\d+), scale: (\d+),/.exec(contentWork);
  assert.ok(allowance);
  const [, free, starter, pro, scale] = allowance;
  assert.match(pricing, new RegExp(`articles: "${free} articles? / month"`));
  for (const count of [starter, pro, scale]) assert.match(pricing, new RegExp(`articles: "${count} articles / month"`));
  assert.doesNotMatch(pricing, /Enterprise|Unlimited/);
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

test("founding beta page promises only the Starter plan's real allowance and no results", () => {
  const beta = readFileSync("src/app/beta/page.tsx", "utf8");
  const contentWork = readFileSync("convex/contentWork.ts", "utf8");
  const starter = /OWNER_DRAFTS_PER_MONTH = \{ free: \d+, starter: (\d+),/.exec(contentWork)?.[1];
  assert.ok(starter);
  assert.match(beta, new RegExp(`${starter} articles a month on 1 website`));
  assert.match(beta, /not a guaranteed traffic spike/);
  assert.doesNotMatch(beta, /guarantee(?!d traffic spike)/i);
  const proxy = readFileSync("src/proxy.ts", "utf8");
  assert.match(proxy, /"\/beta"/, "the beta page is public");
  assert.match(proxy, /"contact", "beta"/, "the beta page is never rewritten to the blog");
});

