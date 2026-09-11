import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { resolveActiveSite } from "../src/lib/active-site.ts";
import type { SiteJobActivity } from "../convex/lib/siteJobActivity.ts";

const owned = [
  { _id: "site-irrigation", domain: "irrigation.example", siteName: "Irrigation service", cadencePerWeek: 7 },
  { _id: "site-freight", domain: "freight.example", siteName: "Freight dispatch", cadencePerWeek: 21 },
];
const code = buildSync({ entryPoints: ["src/app/(dashboard)/dashboard/page.tsx"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false,
  external: ["@/contexts/site-context", "@/hooks/usePlanLimits", "@/components/onboarding/setup-wizard",
    "@/components/growth-loop/growth-loop-status", "@/components/ui/article-progress"],
}).outputFiles[0].text;

function render(selected: string | undefined, data?: SiteJobActivity, routeSiteId?: string) {
  const actualRequire = createRequire(import.meta.url);
  const activeSite = resolveActiveSite(owned, selected, routeSiteId);
  const queries: unknown[] = [];
  const runtime = { exports: {} as { default: () => ReactNode } };
  runInNewContext(code, { module: runtime, exports: runtime.exports,
    require: (name: string) => {
      if (name === "@/contexts/site-context") return { useActiveSite: () => ({ activeSite, sites: owned }) };
      if (name === "@/hooks/usePlanLimits") return { usePlanLimits: () => ({ maxSites: 9999, maxArticles: 150 }) };
      if (name === "@/components/onboarding/setup-wizard") return { SetupWizard: () => createElement("aside", null, "Setup") };
      if (name === "@/components/growth-loop/growth-loop-status") return { GrowthLoopStatus: () => null };
      if (name === "@/components/ui/article-progress") return { ArticleProgress: () => null };
      if (name === "@clerk/nextjs") return { useAuth: () => ({ userId: "synthetic-owner" }) };
      if (name === "next/link") return function SyntheticLink({ children, href }: { children: ReactNode; href: string }) { return createElement("a", { href }, children); };
      if (name === "convex/react") return {
        useAction: () => () => { assert.fail("Rendering must never invoke an action"); },
        useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
          const fn = getFunctionName(ref);
          assert.notEqual(fn, "jobs:listAll", "No account-wide feed is allowed on the site dashboard");
          if (fn === "jobs:getDashboardActivity") { queries.push(structuredClone(args)); return args === "skip" ? undefined : data; }
          if (args === "skip") return undefined;
          if (fn === "articles:countThisMonth") return 0;
          if (fn === "autopilot:getHealthForSite") return { health: { status: "healthy" }, alerts: [] };
          if (fn.startsWith("searchPerformance:")) return null;
          return [];
        },
      };
      return actualRequire(name);
    },
  });
  return { html: renderToStaticMarkup(createElement(runtime.exports.default)), queries };
}

function activity(siteId: string, running = 0): SiteJobActivity {
  return { siteId, observedAt: Date.now(), recent: { status: "complete", jobs: running
    ? [{ _id: "jobs:synthetic-plan" as never, type: "plan", status: "running", createdAt: 1, updatedAt: 1 }] : [] },
    running: { status: "complete", count: running }, pending: { status: "complete", count: 0 } };
}

test("real dashboard render binds its query and job display to either arbitrary selected site", () => {
  const first = render(owned[0]._id, activity(owned[0]._id, 1));
  assert.deepEqual(first.queries, [{ siteId: owned[0]._id }]);
  assert.match(first.html, /irrigation\.example/); assert.match(first.html, /1 running/); assert.match(first.html, /Topic generation/);
  const second = render(owned[1]._id, activity(owned[1]._id));
  assert.deepEqual(second.queries, [{ siteId: owned[1]._id }]);
  assert.match(second.html, /freight\.example/); assert.match(second.html, /Idle/); assert.doesNotMatch(second.html, /Topic generation/);
  assert.match(second.html, /No pipeline activity yet/);
});

test("real dashboard never turns loading or a stale selection response into idle, empty or foreign activity", () => {
  for (const data of [undefined, activity(owned[0]._id, 1)]) {
    const result = render(owned[1]._id, data);
    assert.deepEqual(result.queries, [{ siteId: owned[1]._id }]);
    assert.match(result.html, /Checking activity/); assert.match(result.html, /Loading this site/);
    assert.doesNotMatch(result.html, /Idle|Topic generation|No pipeline activity yet/);
  }
  const truncated = activity(owned[1]._id, 1);
  truncated.running = { status: "truncated", lowerBound: 51 }; truncated.recent.status = "truncated";
  assert.match(render(owned[1]._id, truncated).html, /≥51 running/);
  assert.match(render(owned[1]._id, truncated).html, /older activity is not shown/);
});

test("deep-link route ownership wins before effects; unauthorized/no selected route skips the job query", () => {
  const exact = render(owned[0]._id, activity(owned[1]._id), owned[1]._id);
  assert.deepEqual(exact.queries, [{ siteId: owned[1]._id }]);
  assert.match(exact.html, /freight\.example/);
  const denied = render(owned[0]._id, activity(owned[0]._id, 1), "unowned-route");
  assert.deepEqual(denied.queries, ["skip"]); assert.doesNotMatch(denied.html, /Topic generation|1 running/);
});
