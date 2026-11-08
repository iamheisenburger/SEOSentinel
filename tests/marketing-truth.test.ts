import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ANNUAL_MONTHS_FREE, ANNUAL_PER_MONTH, ANNUAL_SAVINGS, PENTRA_PLAN, formatUsd, planDisplayName } from "../src/lib/pricing.ts";
import { ASSISTANTS, HONESTY_LINE, PUBLISH_TARGETS } from "../src/lib/product-facts.ts";
import { ANSWERS_PLAN, ANSWERS_PLAN_FEATURE } from "../convex/lib/answersAccess.ts";
import { ALL_FEATURE_KEYS } from "../convex/planLimits.ts";

const read = (path: string) => readFileSync(path, "utf8");

function loadComponent<T>(entry: string): T {
  const code = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", packages: "external",
    write: false, jsx: "automatic", alias: { "next/link": "./tests/helpers/next-link-stub.tsx" } }).outputFiles[0]!.text;
  const runtime = { exports: {} as T };
  runInNewContext(code, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url), console });
  return runtime.exports;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

/** Every public marketing surface of the Nov 2026 rebuild. */
const MARKETING = [
  "src/app/page.tsx",
  "src/app/pricing/page.tsx",
  "src/app/method/page.tsx",
  "src/app/start/page.tsx",
  "src/app/contact/page.tsx",
  "src/app/layout.tsx",
  "src/components/auth/auth-shell.tsx",
  "src/components/layout/landing-nav.tsx",
  ...files("src/components/marketing"),
  // The onboarding and the Answers dashboard (Nov 2026) are held to the same copy rules.
  ...files("src/components/answers"),
  "src/components/billing/pentra-plan-block.tsx",
];
const marketing = MARKETING.map((path) => [path, read(path)] as const);

test("public Pentra copy sells only what the product delivers", () => {
  for (const [path, text] of marketing) {
    // The five assistants are ChatGPT, Perplexity, Gemini and Google's two; Copilot is not one of them.
    assert.doesNotMatch(text, /Copilot/, path);
    // No vanity score, no hype, no promised outcome.
    assert.doesNotMatch(text, /visibility score of|AI grade|\bsupercharge|\bunlock|dominate AI|revolutionary|guaranteed (?:results|rankings|recommendations)/i, path);
    // Old-product claims are gone from the marketing site.
    assert.doesNotMatch(text, /Autopilot SEO|auto-refresh|builds backlinks|More customers from Google/i, path);
  }
  assert.deepEqual(ASSISTANTS.map((assistant) => assistant.name), ["ChatGPT", "Perplexity", "Gemini", "Google AI Mode", "Google AI Overviews"]);
  // The publisher supports these (coordinator, Nov 7 2026); the list is defined once and rendered from it.
  assert.deepEqual(PUBLISH_TARGETS.map((target) => target.id), ["wordpress", "webflow", "shopify", "ghost", "github", "webhook", "hosted"]);
  assert.match(read("src/components/marketing/publish-targets.tsx"), /PUBLISH_TARGETS\.map\(/);
  // Wrong-fact findings aren't built (coordinator, Nov 8 2026): no page, the sign-in panel or the FAQ claims them.
  for (const [path, text] of [...marketing, ["src/components/marketing/faq-data.ts", read("src/components/marketing/faq-data.ts")] as const]) {
    assert.doesNotMatch(text, /wrong fact|what they get wrong|gets? (?:my|your) business wrong|states? incorrectly|kind: "wrong"|\{ wrong:/i, path);
  }
  assert.match(read("src/components/marketing/first-hour.tsx"), /title: "Shows who gets named instead"/);
  // Never name data suppliers in marketing copy.
  for (const [path, text] of marketing) assert.doesNotMatch(text, /DataForSEO|SerpApi|Bright ?Data/i, path);
});

test("the homepage examples read right on first paint: final counts, plain step titles, and 'named instead' lists only competitors", () => {
  // The example counts are in the server's markup as their final values; nothing ticks up from zero or waits for a scroll.
  const problem = read("src/components/marketing/problem-count.tsx");
  assert.doesNotMatch(problem, /CountUp|count-up/);
  assert.match(problem, /\{row\.count\.toLocaleString\("en-US"\)\}/);
  assert.doesNotMatch(files("src").map(read).join("\n"), /from "@\/components\/ui\/count-up"/);
  const { ProblemCount } = loadComponent<{ ProblemCount: () => ReactNode }>("src/components/marketing/problem-count.tsx");
  const html = renderToStaticMarkup(createElement(ProblemCount));
  for (const count of ["41", "27"]) assert.match(html, new RegExp(`<span class="type-number text-text">${count}</span>`), count);
  // "Asks 5 assistants every question", not "all of them"; the business is never in its own "Named instead" list.
  const firstHour = read("src/components/marketing/first-hour.tsx");
  assert.match(firstHour, /title: `Asks \$\{SNAPSHOT\.assistants\} assistants every question`/);
  assert.doesNotMatch(firstHour, /all of them|\(you\)/);
  const { FirstHour } = loadComponent<{ FirstHour: () => ReactNode }>("src/components/marketing/first-hour.tsx");
  const steps = renderToStaticMarkup(createElement(FirstHour));
  const namedInstead = steps.slice(steps.indexOf("Named instead"), steps.indexOf("Sources they cite"));
  assert.ok(namedInstead.length > 0);
  assert.doesNotMatch(namedInstead, /Kettlewood/, "only the businesses named instead of the sample business");
  assert.equal(namedInstead.match(/class="hl-rival truncate"/g)?.length, 3);
  assert.match(steps, /In about 15 minutes you have a snapshot/);
});

test("the honesty line is said where buyers decide: the FAQ, pricing, the method page and sign-up", () => {
  assert.equal(HONESTY_LINE, "We can't make an assistant recommend you. We show every answer we collect, so you can see exactly what changed.");
  const faq = read("src/components/marketing/faq-data.ts");
  assert.match(faq, /question: "Can you guarantee I'll be recommended\?",\s*answer: `No\. \$\{HONESTY_LINE\}/);
  for (const path of ["src/app/pricing/page.tsx", "src/app/method/page.tsx", "src/components/auth/auth-shell.tsx", "src/app/start/page.tsx"]) {
    assert.match(read(path), /\{HONESTY_LINE\}/, path);
  }
});

test("the method page states how answers are collected and why counts show both numbers", () => {
  const method = read("src/app/method/page.tsx");
  assert.match(method, /live product/);
  assert.match(method, /fresh\s+session with web search, from your country/);
  assert.match(method, /never turn a run\s+into a percentage or a score/);
  assert.match(method, /&ldquo;144 of \{SNAPSHOT\.answers\}\{" "\}\s*answered&rdquo;/);
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /"\/method"/, "the method page is public");
  assert.match(proxy, /"method", "start"/, "and never rewritten to a customer's blog");
  assert.match(read("src/app/sitemap.ts"), /url: `\$\{baseUrl\}\/method`/);
});

test("sample data is always labelled as an example and never passes for a customer", () => {
  assert.match(read("src/components/marketing/samples.ts"), /SAMPLE DATA\. A fictional business/);
  assert.match(read("src/components/marketing/samples.ts"), /export const SAMPLE_LABEL = "Example answer · sample business";/);
  assert.match(read("src/components/marketing/hero.tsx"), /label=\{SAMPLE_LABEL\}/);
  assert.match(read("src/components/marketing/hero.tsx"), /A sample business with fictional names\./);
  assert.match(read("src/components/marketing/problem-count.tsx"), /Illustration of the snapshot format, not real data\./);
  assert.match(read("src/components/marketing/first-hour.tsx"), /Fragments show a sample business\./);
  assert.match(read("src/components/marketing/proof.tsx"), /Example data for a sample business\./);
  assert.match(read("src/components/marketing/proof.tsx"), /eyebrow="Example data · sample business"/);
  assert.match(read("src/components/marketing/after-hour.tsx"), /Example email for a sample business\./);
  assert.match(read("src/app/method/page.tsx"), /Example answer for a sample business with fictional names\./);
  // Example evidence never pretends it was recorded, and its sources are not links to pages that don't exist.
  const card = read("src/components/ui/evidence-card.tsx");
  assert.match(card, /sample \? "Pentra asks from a fresh session with web search" : "Asked by Pentra from a fresh session"/);
  assert.match(card, /linked=\{!sample\}/);
  assert.match(read("src/components/ui/evidence-card.tsx"), /<EvidenceCard\s+answer=\{answer\}\s+variant="hero"\s+sample/);
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
  const faq = read("src/components/marketing/faq-data.ts");
  const terms = read("src/app/legal/terms/page.tsx");

  assert.match(faq, /Cancel from Billing and your plan stays active until the end of the period you paid for/);
  assert.match(faq, /The pages Pentra published stay yours/);
  assert.doesNotMatch(faq, /All plans are month-to-month/);
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

test("the upgrade screen never pretends URL parameters preselect Clerk checkout, and never lists the old tiers", () => {
  const upgrade = read("src/app/(dashboard)/upgrade/page.tsx");
  // Checkout starts only from an explicit plan button (Clerk's CheckoutButton) for the "pentra" plan.
  assert.match(upgrade, /<CheckoutButton/);
  // Without a "pentra" plan in Clerk (or when it can't be read), the same plan block shows a calm note and an email
  // address. Clerk's own PricingTable is never the fallback: it lists every Clerk plan, the old tiers included.
  assert.doesNotMatch(upgrade, /PricingTable/);
  assert.match(upgrade, /<CheckoutSoonNote email=\{SUPPORT_EMAIL\} \/>/);
  assert.match(read("src/components/billing/pentra-plan-block.tsx"), /Checkout opens shortly\. Email/);
  // After checkout the dashboard confirms the plan and says the free hour's drafts publish within the hour.
  assert.match(upgrade, /newSubscriptionRedirectUrl=\{AFTER_CHECKOUT\}/);
  assert.match(upgrade, /useState<BillingSubscriptionPlanPeriod>\("month"\)/);
  assert.doesNotMatch(upgrade, /Enterprise/i);
  assert.doesNotMatch(upgrade, /useSearchParams|PLAN_PRICES|PLAN_LABELS/);
  assert.doesNotMatch(upgrade, /Complete checkout for|billed annually \(save/);
  assert.doesNotMatch(upgrade, /secure table below/);
  // The in-app plan is the public plan: read from the one pricing module, matched to Clerk by slug or name.
  assert.match(upgrade, /from "@\/lib\/pricing"/);
  assert.match(upgrade, /plans\.data\.find\(\(plan\) => isPentraPlan\(plan\)\)/);
  assert.match(upgrade, /billingTerms\(interval\)/, "terms are stated before the charge");
  assert.doesNotMatch(upgrade, /\b(?:249|2,?490|49|99|199)\b/, "no price is typed into the upgrade screen");
  assert.doesNotMatch(upgrade, /\bTIERS\b|Starter|"Scale"/);
});

test("one plan, $249/month or $2,490/year, is defined once and used by the landing page, /pricing, /upgrade and the Terms", () => {
  // The plan is entitled by the Clerk feature on the Clerk plan "pentra" (convex/lib/answersAccess.ts ANSWERS_PLAN_FEATURE),
  // not by an article-volume tier: the site's prices and the backend's plan are one definition.
  assert.deepEqual(PENTRA_PLAN, { key: "pentra", name: "Pentra", monthly: 249, annual: 2490 });
  assert.deepEqual({ key: PENTRA_PLAN.key, name: PENTRA_PLAN.name, monthly: PENTRA_PLAN.monthly, annual: PENTRA_PLAN.annual },
    { key: ANSWERS_PLAN.slug, name: ANSWERS_PLAN.name, monthly: ANSWERS_PLAN.monthlyUsd, annual: ANSWERS_PLAN.annualUsd });
  assert.ok(ALL_FEATURE_KEYS.includes(ANSWERS_PLAN_FEATURE), "the plan's feature passes the Convex entitlement filter");
  assert.equal(formatUsd(PENTRA_PLAN.monthly), "$249");
  assert.equal(formatUsd(PENTRA_PLAN.annual), "$2,490");
  assert.equal(formatUsd(ANNUAL_PER_MONTH), "$207.50");
  assert.equal(ANNUAL_SAVINGS, 498);
  assert.equal(ANNUAL_MONTHS_FREE, 2);
  for (const path of ["src/components/marketing/pricing-plan.tsx", "src/app/pricing/page.tsx", "src/app/(dashboard)/upgrade/page.tsx",
    "src/app/legal/terms/page.tsx", "src/components/marketing/faq-data.ts", "src/app/page.tsx"]) {
    assert.match(read(path), /from "@\/lib\/pricing"/, `${path} reads the plan from src/lib/pricing.ts`);
  }
  // No other source file states the price, and the old four tiers are gone from every screen.
  const offenders = files("src").filter((path) => path !== join("src", "lib", "pricing.ts"))
    .filter((path) => /\$249|\$2,490|\b2490\b|monthlyPrice|annualPrice/.test(read(path)));
  assert.deepEqual(offenders, []);
  for (const path of ["src/app/page.tsx", "src/app/pricing/page.tsx", "src/app/(dashboard)/upgrade/page.tsx", "src/app/(dashboard)/settings/page.tsx",
    "src/components/marketing/pricing-plan.tsx", "src/app/contact/page.tsx"]) {
    assert.doesNotMatch(read(path), /PLAN_NAMES|\bStarter\b|\bScale\b|Enterprise|Unlimited|articles \/ month/, path);
  }
  // Subscribers from before the single plan keep what they bought; it shows as Legacy, never priced or sold.
  assert.equal(planDisplayName("starter"), "Legacy");
  assert.equal(planDisplayName("pentra"), "Pentra");
  assert.equal(planDisplayName("free"), "Free");
  assert.match(read("src/app/(dashboard)/settings/page.tsx"), /planDisplayName\(tier\)/);
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

test("the retired founding-beta and free-check pages permanently redirect home and stay public", () => {
  for (const path of ["src/app/beta/page.tsx", "src/app/check/page.tsx", "src/app/check/[domain]/page.tsx"]) {
    assert.match(read(path), /permanentRedirect\("\/"\);/, path);
  }
  const proxy = read("src/proxy.ts");
  assert.match(proxy, /"\/beta"/, "the beta redirect is public");
  assert.match(proxy, /"contact", "beta"/, "the beta path is never rewritten to the blog");
  assert.doesNotMatch(read("src/app/sitemap.ts"), /url: `\$\{baseUrl\}\/(?:check|beta)`/, "redirects are not listed in the sitemap");
});
