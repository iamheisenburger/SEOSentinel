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
      if (name === "convex/react") return { useMutation: () => () => assert.fail("Render cannot mutate"), useAction: () => () => assert.fail("Render cannot call a provider"), useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
        const fn = getFunctionName(ref); calls.push(fn);
        if (fn === "contentWork:readiness") return queryState;
        if (fn === "searchPerformance:contentOutcome") return outcome;
        if (fn === "selectedPages:list") return { complete: true, pages: [] };
        assert.fail(`Unexpected query ${fn}`);
      } };
      return actual(name);
    },
  });
  const exported = component === "content-work-service" ? "ContentWorkService" : "ContentWorkOverview";
  return { html: renderToStaticMarkup(createElement(runtime.exports[exported], { siteId: "sites:synthetic" })), calls };
}
test("SLC29 synthetic component displays saved destination, real funding distinctions and pause/recovery controls", () => {
  const { html } = render("content-work-service");
  assert.match(html, /fixture\/website, branch main, content\/blog/);
  assert.match(html, /settled actual spend \$9\.0000/); assert.match(html, /conservative ceilings \$11\.0000/);
  assert.match(html, /Provider credit balance is unverified/);
  assert.match(html, /Pause new work/); assert.match(html, /Resume preparation and schedule/); assert.match(html, /Recheck existing work/);
  assert.doesNotMatch(html, /synthetic-consent|append-only/);
});
test("SLC29 synthetic overview separates upcoming, verified, organic and issues without turning missing data into zero", () => {
  const { html, calls } = render("content-work-overview");
  for (const heading of ["Upcoming work", "Verified changes", "Organic clicks", "Needs attention"]) assert.match(html, new RegExp(heading));
  assert.match(html, /Overdue/); assert.match(html, /unavailable, not zero/); assert.doesNotMatch(html, /0 clicks/);
  assert.deepEqual(calls, ["contentWork:readiness", "searchPerformance:contentOutcome"]);
  const available = render("content-work-overview", state, { status: "available", current: { start: "2026-08-01", end: "2026-08-28", clicks: 0 }, previous: null, cohorts: [], property: "sc-domain:fixture.example" });
  assert.match(available.html, /0 clicks/); assert.match(available.html, /No complete previous window/);
});

test("SLC38 customer rendering treats provider interruption as platform responsibility and exposes an exact restored retry", () => {
  const interrupted = { jobId: "jobs:fixture", intent: "create", stage: "failed", windowStartAt: 1, deadlineAt: 2,
    failure: "Pentra's generation service is interrupted. Our team must restore it; you do not need to fund a provider or change your plan." };
  const blocked = render("content-work-service", { ...state, work: [interrupted] }).html;
  assert.match(blocked, /generation service is interrupted/); assert.match(blocked, /you do not need to fund a provider/);
  assert.doesNotMatch(blocked, /Retry interrupted preparation|purchase credits|top up|Plans &amp; Billing/);
  const restored = render("content-work-service", { ...state, work: [{ ...interrupted,
    failure: "Pentra has restored generation for this interrupted work. You can retry it once; the original deadline and earlier attempt remain recorded.",
    creditRetry: { jobId: interrupted.jobId, callKey: "synthetic-private-call", token: "synthetic-private-token" } }] }).html;
  assert.match(restored, /Retry interrupted preparation/); assert.match(restored, /original deadline and earlier attempt remain recorded/);
  assert.doesNotMatch(restored, /synthetic-private-call|synthetic-private-token|purchase credits/);
});
