import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync, readdirSync } from "node:fs";

// Visual/interaction fixtures ONLY. Auth and transport are synthetic. These do
// not count as signed-in customer acceptance; registered-handler tests are
// separate, and the real owner-session gate below remains explicitly skipped.
const bundle = build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ContentWorkOverview} from './src/components/content-work-overview';
  import {ContentWorkService} from './src/components/content-work-service';
  import {ContentStart} from './src/components/onboarding/content-start';
  const fixture = window.contentFixture;
  createRoot(document.getElementById('root')).render(fixture.screen === 'start' ? <ContentStart/> : fixture.screen === 'controls' ? <ContentWorkService siteId={fixture.state.siteId}/> : <ContentWorkOverview siteId={fixture.state.siteId}/>);
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "explicit-synthetic-content-transport", setup(b) {
    b.onResolve({ filter: /^(convex\/react|@clerk\/nextjs|next\/link)$/ }, a => ({ path: a.path, namespace: "content-fixture" }));
    b.onLoad({ filter: /.*/, namespace: "content-fixture" }, a => {
      if (a.path === "next/link") return { contents: "import React from 'react'; export default function Link({children,...p}){return React.createElement('a',p,children)}", resolveDir: process.cwd() };
      if (a.path === "@clerk/nextjs") return { contents: "export const useAuth=()=>({isLoaded:true,userId:'synthetic-owner'});" };
      return { contents: `import {getFunctionName} from 'convex/server';
        export const useQuery=(ref,args)=>{const n=getFunctionName(ref); const f=window.contentFixture;
          if(n==='contentWork:readiness')return f.state; if(n==='selectedPages:list')return {complete:true,pages:[]};
          if(n==='searchPerformance:contentOutcome')return {status:'incomplete',current:null}; throw Error('Unexpected query '+n)};
        export const useMutation=ref=>async args=>{window.contentFixture.calls.push({name:getFunctionName(ref),args})};
        export const useAction=useMutation;`, resolveDir: process.cwd() };
    });
  } }] }).then(r => r.outputFiles[0].text);

const state = { siteId: "sites:synthetic", setupPending: false, serviceMode: "growth_first", reviewToken: "synthetic-reviewed-binding",
  profile: { name: "CedarCare", summary: "Garden maintenance visits for local residents.", audience: "Residents planning a garden visit.", productUsage: "Describe your garden and arrange an appropriate maintenance visit.", offerings: ["Garden maintenance"] },
  destination: { kind: "github", domain: "cedarcare.example", repository: "cedarcare/website", branch: "main", contentDirectory: "content/blog", verified: true },
  entitlement: true, enabled: true, approvalRequired: false, bindingCurrent: true, complete: true, ready: 2,
  schedule: { active: true, paused: true, nextDeadlineAt: Date.UTC(2026, 8, 14, 12), intervalMs: 86_400_000, timezone: "UTC" },
  funding: { status: "blocked", checkedAt: Date.UTC(2026, 8, 14, 13), monthlyLimitMicroUsd: 20_000_000, settledActualMicroUsd: 9_000_000, heldCeilingMicroUsd: 11_000_000, accountAvailableMicroUsd: 0, requestedMicroUsd: 500_000, dailyResetAt: Date.UTC(2026,8,15), monthlyResetAt: Date.UTC(2026,9,1), incrementalLimitMicroUsd: null },
  work: [{ jobId: "jobs:synthetic", intent: "create", stage: "ready", windowStartAt: Date.UTC(2026,8,14,11,55), deadlineAt: Date.UTC(2026,8,14,12) }] };

for (const screen of ["overview", "controls", "start"]) test(`SLC29 synthetic component browser: ${screen} (not authenticated acceptance)`, async ({ page }, info) => {
  const css = readdirSync(".next/static/chunks").filter(f => f.endsWith(".css")).map(f => readFileSync(`.next/static/chunks/${f}`, "utf8")).join("\n");
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://pentra.test");
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic content component fixture</title><style>${css}</style><style>body{background:#08090e;color:#edeef1;font-family:Arial!important;margin:24px}#root{max-width:1000px;margin:auto}</style></head><body><p style="margin:12px auto;max-width:1000px">Synthetic local fixture — not an authenticated customer session</p><div id="root"></div></body></html>` });
  });
  await page.goto("http://pentra.test/content");
  await page.evaluate(f => Object.assign(window, { contentFixture: f }), { screen, state, calls: [] });
  await page.addScriptTag({ content: await bundle });
  if (screen === "overview") {
    for (const name of ["Upcoming work", "Verified changes", "Organic clicks", "Needs attention"]) await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText(/Overdue/)).toBeVisible(); await expect(page.getByText(/unavailable, not zero/)).toBeVisible();
  } else if (screen === "controls") {
    await expect(page.getByText(/cedarcare\/website, branch main/)).toBeVisible();
    await expect(page.getByText(/Provider credit balance is unverified/)).toBeVisible();
    await page.getByRole("button", { name: "Pause new work" }).click();
    const calls = await page.evaluate(() => (window as unknown as { contentFixture: { calls: unknown[] } }).contentFixture.calls);
    expect(calls).toEqual([{ name: "contentWork:control", args: { siteId: state.siteId, action: "pause", reviewToken: state.reviewToken } }]);
  } else {
    await expect(page.getByRole("heading", { name: "Start your content service" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify existing plan and save profile" })).toBeDisabled();
    await page.getByLabel("Content publishing destination").selectOption("wordpress");
    await expect(page.getByLabel("Content publishing destination")).toHaveValue("wordpress");
  }
  await expect(page.locator("body")).not.toContainText("synthetic-reviewed-binding");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`stage29-${screen}.png`), fullPage: true });
});
