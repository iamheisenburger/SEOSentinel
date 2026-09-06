import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const bundle = buildSync({ entryPoints: ["src/components/onboarding/setup-readiness.tsx"],
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  jsx: "automatic" }).outputFiles[0].text;

function render(execution: Record<string, unknown>) {
  const localRequire = createRequire(import.meta.url);
  const runtime = { exports: {} as { SetupReadiness: () => ReturnType<typeof createElement> } };
  const readiness = {
    requestExists: true, stages: [], aggregate: { status: "in_progress", readyCount: 6, totalCount: 7, percent: 85 },
    initialPlanExecution: execution,
  };
  runInNewContext(bundle, { module: runtime, exports: runtime.exports,
    require: (name: string) => name === "convex/react"
      ? { useQuery: () => readiness, useMutation: () => async () => ({}) }
      : localRequire(name),
  });
  return renderToStaticMarkup(createElement(runtime.exports.SetupReadiness));
}

test("the actual setup component distinguishes reserved internal capacity from provider funding and active work", () => {
  const nextEligibleAt = Date.UTC(2026, 8, 7, 0, 0, 1);
  for (const blockerCode of ["provider_account_daily_budget_reserved", "provider_fleet_monthly_budget_reserved", "article_quota_no_headroom"]) {
    const html = render({ status: "pending", nextEligibleAt, blockerCode });
    assert.match(html, /Planning is waiting—not currently generating/);
    assert.match(html, /separate from your provider wallet balance/);
    assert.match(html, /Automatic retry:/);
    assert.match(html, /No repeat click is needed/);
    assert.doesNotMatch(html, /Retry content plan/);
  }
  const active = render({ status: "running", nextEligibleAt, blockerCode: "plan_in_progress" });
  assert.doesNotMatch(active, /Planning is waiting/);
  const complete = render({ status: "completed", nextEligibleAt, blockerCode: "old_budget_reason" });
  assert.doesNotMatch(complete, /Planning is waiting/);
  const cooling = render({ status: "pending", nextEligibleAt, blockerCode: "provider_account_preflight_cooling_down" });
  assert.match(cooling, /queued for a later automatic retry/);
  assert.doesNotMatch(cooling, /adding provider credits/);
});
