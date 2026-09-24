// Synthetic component checks, NOT Clerk-authenticated browser acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

const actual = createRequire(import.meta.url);
test("Content progress reports its actual stage without claiming unused legacy research and media steps", () => {
  const code = buildSync({ entryPoints: ["src/components/ui/article-progress.tsx"], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  for (const [stage, label] of [["prepare", "Preparing your draft"], ["review", "Reviewing your draft"],
    ["publish", "Publishing approved content"], ["verify", "Checking the live page"]]) {
    const runtime = { exports: {} as Record<string, never> };
    runInNewContext(code, { module: runtime, exports: runtime.exports,
      require: (name: string) => name === "convex/react" ? { useQuery: () => ({ type: "article",
        contentWork: { stage }, stepProgress: { current: 9, total: 9 } }) } : actual(name) });
    const html = renderToStaticMarkup(createElement(runtime.exports.ArticleProgress, { siteId: "sites:synthetic" }));
    assert.match(html, new RegExp(label));
    assert.doesNotMatch(html, /Web research|YouTube|Site screenshot|Image search|Featured image|9\/9|Generating article/);
  }
});
const state = { siteId: "sites:synthetic", setupPending: false, serviceMode: "growth_first", reviewToken: "synthetic-consent", profile: { name: "Fixture business", summary: "Confirmed facts", audience: "Garden owners", productUsage: "Visit planning", offerings: [] },
  destination: { kind: "github", domain: "fixture.example", repository: "fixture/website", branch: "main", contentDirectory: "content/blog", verified: true },
  entitlement: true, enabled: true, approvalRequired: false, bindingCurrent: true, schedule: { active: false, paused: true, nextDeadlineAt: 1, intervalMs: 86_400_000, timezone: "UTC" },
  funding: { status: "blocked", checkedAt: 2, monthlyLimitMicroUsd: 20_000_000, settledActualMicroUsd: 9_000_000, heldCeilingMicroUsd: 11_000_000, accountAvailableMicroUsd: 0, requestedMicroUsd: 500_000, dailyResetAt: 86_400_000, monthlyResetAt: 2_678_400_000, incrementalLimitMicroUsd: null },
  complete: true, ready: 0, work: [] };
function render(component: string, queryState: unknown = state, outcome: unknown = { status: "incomplete", current: null }) {
  const code = buildSync({ entryPoints: [`src/components/${component}.tsx`], bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const runtime = { exports: {} as Record<string, never> }, calls: string[] = [];
  runInNewContext(code, { module: runtime, exports: runtime.exports, TextEncoder, URL, Intl,
    require: (name: string) => {
      if (name === "next/link") return function SyntheticLink({ href, children }: { href: string; children: never }) { return createElement("a", { href }, children); };
      if (name === "convex/react") return { useConvex: () => ({ query: () => assert.fail("Server rendering cannot fetch measurements") }), useMutation: () => () => assert.fail("Render cannot mutate"), useAction: () => () => assert.fail("Render cannot call a provider"), useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
        const fn = getFunctionName(ref); calls.push(fn);
        if (fn === "contentWork:readiness") return queryState;
        if (fn === "searchPerformance:contentOutcome") return outcome;
        if (fn === "selectedPages:list") return { complete: true, pages: [] };
        if (fn === "siteHealth:latest") return null;
        if (fn === "topics:listBySite") return [
          { _id: "t1", label: "Irrigation valve inspection checklist", primaryKeyword: "irrigation valve inspection", status: "planned", priority: 90 },
          { _id: "t2", label: "Already written topic", primaryKeyword: "written", status: "used", priority: 99 },
        ];
        assert.fail(`Unexpected query ${fn}`);
      } };
      return actual(name);
    },
  });
  const exported = component === "content-work-service" ? "ContentWorkService" : "ContentWorkOverview";
  return { html: renderToStaticMarkup(createElement(runtime.exports[exported], { siteId: "sites:synthetic" })), calls };
}

test("Owner-reviewed setup has no automatic consent or artificial overdue deadline in its UI", () => {
  const setup = render("content-work-service", { ...state, setupPending: true, serviceMode: "legacy_articles", schedule: null });
  assert.match(setup.html, /Enable owner-reviewed drafts/);
  assert.doesNotMatch(setup.html, /First deadline|Hours between deadlines|scheduled creation\/improvement service/);
  const ready = { ...state, approvalRequired: true, enabled: false, schedule: { ...state.schedule, ownerReviewedOnly: true } };
  for (const component of ["content-work-service", "content-work-overview"]) {
    const result = render(component, ready);
    assert.match(result.html, /Articles/);
    assert.doesNotMatch(result.html, /Overdue|Fixed window|Next fixed deadline|Resume preparation|Automatic publication consent is not active/);
  }
  const changed = render("content-work-service", { ...ready, bindingCurrent: false }).html;
  assert.match(changed, /Drafts still require your explicit publication approval/);
  assert.doesNotMatch(changed, /authorize automatic publication|Confirm changed setup and prepare fresh work/);
});

test("new customers see one clear Autopilot or Review-first choice, not delivery windows", () => {
  const setup = render("content-work-service", { ...state, setupPending: true, serviceMode: "legacy_articles", schedule: null,
    autopilot: { selectable: true, on: false }, plan: { tier: "starter", articlesPerMonth: 10, autopilotIntervalMs: 259_200_000 } }).html;
  assert.match(setup, /Turn on Pentra/); assert.match(setup, /Autopilot \(recommended\)/); assert.match(setup, /Review first/);
  assert.match(setup, /10 new articles a month/); assert.match(setup, /about one every 3 days/);
  assert.doesNotMatch(setup, /First deadline|Hours between deadlines|buffer|fixed window/i);
  const running = render("content-work-overview", { ...state, autopilot: { selectable: true, on: true },
    plan: { tier: "starter", articlesPerMonth: 10, autopilotIntervalMs: 259_200_000 },
    schedule: { ...state.schedule, paused: false, autopilotSelected: true }, results: { live: 3, liveThisMonth: 2, planUsedThisMonth: 4 } }).html;
  assert.match(running, /Autopilot is on/); assert.match(running, /Switch to review first/); assert.match(running, /Site health/);
  assert.match(running, /Coming up next/); assert.match(running, /Irrigation valve inspection checklist/); assert.doesNotMatch(running, /Already written topic/);
  assert.doesNotMatch(running, /Ready buffer|Fixed window|original deadline/);
  assert.match(running, /Articles live/); assert.match(running, /4 of 10 plan articles used \(all sites\)/);
});

function renderSidebar(queryState: unknown, siteOverrides: Record<string, unknown> = {}) {
  const code = buildSync({ entryPoints: ["src/components/layout/sidebar.tsx"], bundle: true, platform: "node", format: "cjs",
    packages: "external", external: ["@/hooks/usePlanLimits", "@/contexts/site-context"], write: false }).outputFiles[0].text;
  const runtime = { exports: {} as Record<string, never> }, calls: unknown[] = [];
  const activeSite = { _id: state.siteId, serviceMode: "growth_first", autopilotEnabled: true, name: "Fixture", domain: "fixture.example", ...siteOverrides };
  runInNewContext(code, { module: runtime, exports: runtime.exports, TextEncoder, URL, Intl,
    require: (name: string) => {
      if (name === "next/link") return function SyntheticLink({ href, children }: { href: string; children: never }) { return createElement("a", { href }, children); };
      if (name === "next/navigation") return { usePathname: () => "/dashboard" };
      if (name === "@clerk/nextjs") return { UserButton: () => null };
      if (name === "@/hooks/usePlanLimits") return { usePlanLimits: () => ({ isFreePlan: false, isPlanLoaded: true }) };
      if (name === "@/contexts/site-context") return { useActiveSite: () => ({ activeSite, sites: [activeSite], setActiveSiteId: () => assert.fail("Render cannot select another site") }) };
      if (name === "convex/react") return { useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
        assert.equal(getFunctionName(ref), "contentWork:readiness"); calls.push(args); return args === "skip" ? undefined : queryState;
      } };
      return actual(name);
    },
  });
  return { html: renderToStaticMarkup(createElement(runtime.exports.Sidebar)), calls };
}

test("SLC47 real sidebar, overview and settings agree on paused, preparing, failed, ready and active delivery", () => {
  const problem = { jobId: "jobs:fixture", intent: "create", stage: "failed", systemFailure: true, windowStartAt: 1, deadlineAt: 2,
    technicalReason: "content_audit_clarification_inconsistent",
    failure: "Pentra encountered an internal processing error. Our team must repair it. Your drafts, spending history and original deadline are preserved. You do not need to change your plan or fund a provider." };
  const base = { ...state, funding: { ...state.funding, status: "available" }, schedule: { ...state.schedule, paused: false } };
  for (const [value, label] of [[state, "Paused"], [base, "Preparing — not active"],
    [{ ...base, ready: 2 }, "Ready — schedule not active"],
    [{ ...base, schedule: { ...base.schedule, active: true } }, "Schedule active"],
    [{ ...state, work: [problem] }, "Delivery paused"]] as const) {
    const sidebar = renderSidebar(value);
    assert.equal(JSON.stringify(sidebar.calls), JSON.stringify([{ siteId: state.siteId }]));
    for (const html of [sidebar.html, render("content-work-overview", value).html, render("content-work-service", value).html]) {
      assert.ok(html.includes(label), label); assert.doesNotMatch(html, /Autopilot on/);
    }
  }
  for (const component of ["content-work-overview", "content-work-service"]) {
    const html = render(component, { ...state, work: [problem] }).html;
    assert.match(html, /internal processing error/); assert.match(html, /do not need to change your plan or fund a provider/);
    assert.match(html, /<details[^>]*>[\s\S]*content_audit_clarification_inconsistent/);
    assert.doesNotMatch(html, /Pause new work|Resume preparation and schedule|Recheck existing work|Retry interrupted preparation/);
  }
  const wrongSite = renderSidebar({ ...base, siteId: "sites:not-selected", schedule: { ...base.schedule, active: true } }).html;
  assert.match(wrongSite, /Checking delivery status/); assert.doesNotMatch(wrongSite, /Schedule active|Autopilot on/);
  const parked = renderSidebar(base, { planAccessStatus: "parked" }).html;
  assert.match(parked, /Parked by plan/); assert.doesNotMatch(parked, /Preparing — not active|Autopilot on/);
  for (const enabled of [true, false]) {
    const legacy = renderSidebar(base, { serviceMode: "legacy_articles", autopilotEnabled: enabled });
    assert.deepEqual(legacy.calls, ["skip"]); assert.ok(legacy.html.includes(enabled ? "Autopilot on" : "Manual"));
  }
});
test("SLC29 synthetic component displays saved destination, real funding distinctions and pause/recovery controls", () => {
  const { html } = render("content-work-service");
  assert.match(html, /fixture\/website, branch main, content\/blog/);
  assert.match(html, /settled actual spend \$9\.0000/); assert.match(html, /conservative ceilings \$11\.0000/);
  assert.match(html, /Provider credit balance is unverified/);
  assert.doesNotMatch(html, /Pause new work|Recheck existing work/); assert.match(html, /Resume preparation and schedule/);
  assert.doesNotMatch(html, /synthetic-consent|append-only/);
});
test("SLC29 synthetic overview separates upcoming, verified, organic and issues without turning missing data into zero", () => {
  const { html, calls } = render("content-work-overview");
  for (const heading of ["Upcoming work", "Verified changes", "Organic clicks", "Needs attention"]) assert.match(html, new RegExp(heading));
  assert.match(html, /Overdue/); assert.match(html, /Loading measurements/); assert.doesNotMatch(html, /0 clicks/);
  assert.deepEqual(calls, ["contentWork:readiness", "siteHealth:latest"]);
  assert.match(html, /Refresh measurements/);
});

test("SLC38 customer rendering treats provider interruption as platform responsibility and exposes an exact restored retry", () => {
  const interrupted = { jobId: "jobs:fixture", intent: "create", stage: "failed", windowStartAt: 1, deadlineAt: 2,
    failure: "Pentra's generation service is interrupted. Our team must restore it; you do not need to fund a provider or change your plan." };
  const blocked = render("content-work-service", { ...state, work: [interrupted] }).html;
  assert.match(blocked, /generation service is interrupted/); assert.match(blocked, /you do not need to fund a provider/);
  assert.doesNotMatch(blocked, /Retry interrupted preparation|purchase credits|top up|Plans &amp; Billing/);
  const restored = render("content-work-service", { ...state, schedule: { ...state.schedule, paused: false }, work: [{ ...interrupted,
    failure: "Pentra has restored generation for this interrupted work. You can retry it once; the original deadline and earlier attempt remain recorded.",
    creditRetry: { jobId: interrupted.jobId, callKey: "synthetic-private-call", token: "synthetic-private-token" } }] }).html;
  assert.match(restored, /Retry interrupted preparation/); assert.match(restored, /original deadline and earlier attempt remain recorded/);
  assert.doesNotMatch(restored, /synthetic-private-call|synthetic-private-token|purchase credits/);
});
