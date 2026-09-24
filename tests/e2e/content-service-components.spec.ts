import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync, readdirSync } from "node:fs";

type MeasurementFixtureWindow = Window & { renderContentFixture: () => void; contentFixture: { measurementReads: number; outcome?: unknown } };

// Visual/interaction fixtures ONLY. Auth and transport are synthetic. These do
// not count as signed-in customer acceptance; registered-handler tests are
// separate, and the real owner-session gate below remains explicitly skipped.
const bundle = build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {ContentWorkOverview} from './src/components/content-work-overview';
  import {ContentWorkService} from './src/components/content-work-service';
  import {ContentStart} from './src/components/onboarding/content-start';
  const root = createRoot(document.getElementById('root'));
  window.renderContentFixture = () => {const fixture = window.contentFixture; root.render(fixture.screen === 'start' ? <ContentStart/> : ['controls','changed','independent','pricing_off','credit_interrupted','credit_restored','audit_failed','rollback'].includes(fixture.screen) ? <ContentWorkService siteId={fixture.state.siteId}/> : <ContentWorkOverview siteId={fixture.state.siteId}/>)};
  window.renderContentFixture();
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "explicit-synthetic-content-transport", setup(b) {
    b.onResolve({ filter: /^(convex\/react|@clerk\/nextjs|next\/link)$/ }, a => ({ path: a.path, namespace: "content-fixture" }));
    b.onLoad({ filter: /.*/, namespace: "content-fixture" }, a => {
      if (a.path === "next/link") return { contents: "import React from 'react'; export default function Link({children,...p}){return React.createElement('a',p,children)}", resolveDir: process.cwd() };
      if (a.path === "@clerk/nextjs") return { contents: "export const useAuth=()=>({isLoaded:true,userId:'synthetic-owner'});" };
      return { contents: `import {getFunctionName} from 'convex/server';
        const client={query:async(ref,args)=>{const f=window.contentFixture; const n=getFunctionName(ref);if(n!=='searchPerformance:contentOutcome')throw Error('Unexpected one-shot query '+n);f.measurementReads=(f.measurementReads??0)+1;return f.outcome??{status:'incomplete',current:null}}};
        export const useConvex=()=>client;
        export const useQuery=(ref,args)=>{const n=getFunctionName(ref); const f=window.contentFixture;
          if(n==='contentWork:readiness')return f.state; if(n==='selectedPages:list')return {complete:true,pages:[]};
          if(n==='searchPerformance:contentOutcome')return {status:'incomplete',current:null}; throw Error('Unexpected query '+n)};
        export const useMutation=ref=>async args=>{const f=window.contentFixture;f.calls.push({name:getFunctionName(ref),args});const r=f.response??{status:'preparing',issues:[]};if(getFunctionName(ref)==='contentWork:selectServiceMode'&&r.changed)f.state={...f.state,serviceMode:args.mode};return r};
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

test("SLC56 new owner-reviewed consent does not submit automatic-publication authority", async ({ page }) => {
  await page.route("**/*", route => {
    expect(new URL(route.request().url()).origin).toBe("http://pentra.test");
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://pentra.test/owner-setup");
  await page.evaluate(f => Object.assign(window, { contentFixture: f }), { screen: "controls",
    state: { ...state, serviceMode: "legacy_articles", setupPending: true, schedule: null, work: [] }, calls: [] });
  await page.addScriptTag({ content: await bundle });
  const confirm = page.getByRole("button", { name: "Enable owner-reviewed drafts" });
  await expect(confirm).toBeDisabled();
  await expect(page.getByLabel("First delivery deadline")).toHaveCount(0);
  await page.getByRole("checkbox", { name: /I confirm these saved business facts/ }).check();
  await expect(confirm).toBeEnabled(); await confirm.click();
  const calls = await page.evaluate(() => (window as unknown as { contentFixture: { calls: { name: string; args: Record<string, unknown> }[] } }).contentFixture.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0].name).toBe("contentWork:selectServiceMode");
  expect(calls[0].args).toMatchObject({ mode: "growth_first", ownerReviewedOnly: true, authorizeAutomaticPublication: false, confirmBusinessProfile: true });
  expect(calls[0].args.firstDeadlineAt).toBeUndefined(); expect(calls[0].args.intervalMs).toBeUndefined();
});

for (const screen of ["overview", "controls", "start", "changed", "independent", "pricing_off", "credit_interrupted", "credit_restored", "audit_failed", "rollback"]) test(`${screen === "audit_failed" ? "SLC47" : screen === "rollback" ? "SLC41" : screen.startsWith("credit_") ? "SLC38" : ["independent", "pricing_off"].includes(screen) ? "SLC35" : "SLC30"} synthetic component browser: ${screen} (not authenticated acceptance)`, async ({ page }, info) => {
  const css = readdirSync(".next/static/chunks").filter(f => f.endsWith(".css")).map(f => readFileSync(`.next/static/chunks/${f}`, "utf8")).join("\n");
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://pentra.test");
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic content component fixture</title><style>${css}</style><style>body{background:#08090e;color:#edeef1;font-family:Arial!important;margin:24px}#root{max-width:1000px;margin:auto}</style></head><body><p style="margin:12px auto;max-width:1000px">Synthetic local fixture — not an authenticated customer session</p><div id="root"></div></body></html>` });
  });
  await page.goto("http://pentra.test/content");
  await page.evaluate(f => Object.assign(window, { contentFixture: f }), { screen, state: screen === "changed" ? { ...state, bindingCurrent: false, ready: 0,
    reconciliation: { needed: true, staleItems: 2, issues: [{ code: "uncertain_delivery", action: "Inspect the retained delivery, then use its owner review after lease expiry.", articleId: "articles:fixture" }] } } : screen === "independent" ? { ...state,
      funding: { ...state.funding, pricingScope: "validation_run", accountAvailableMicroUsd: 9_600_000, independentAllowance: { totalMicroUsd: 20_000_000, state: "active", expiresAt: null } } }
      : screen === "pricing_off" ? { ...state, funding: { ...state.funding, pricingScope: "unavailable", status: "unconfigured", requestedMicroUsd: null,
        independentAllowance: { totalMicroUsd: 20_000_000, state: "stopped", expiresAt: null } } } : state, calls: [] });
  await page.addScriptTag({ content: await bundle });
  if (screen.startsWith("credit_")) {
    await page.evaluate(restored => {
      const w = window as unknown as { contentFixture: { state: typeof state & { work: unknown[] } }; renderContentFixture: () => void };
      w.contentFixture.state = { ...w.contentFixture.state, ready: 0, schedule: { ...w.contentFixture.state.schedule, paused: false }, work: [{ ...w.contentFixture.state.work[0], stage: "failed",
        failure: restored ? "Pentra has restored generation for this interrupted work. You can retry it once; the original deadline and earlier attempt remain recorded."
          : "Pentra's generation service is interrupted. Our team must restore it; you do not need to fund a provider or change your plan.",
        ...(restored ? { creditRetry: { jobId: "jobs:synthetic", callKey: "synthetic-private-call", token: "synthetic-private-token" } } : {}) }] } as typeof w.contentFixture.state;
      w.renderContentFixture();
    }, screen === "credit_restored");
    await expect(page.getByRole("alert").filter({ hasText: screen === "credit_restored" ? "Pentra has restored" : "Pentra's generation service" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("synthetic-private-token");
    await expect(page.locator("body")).not.toContainText("purchase credits");
    if (screen === "credit_restored") await page.getByRole("button", { name: "Retry interrupted preparation" }).click();
    else await expect(page.getByRole("button", { name: "Recheck existing work" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { contentFixture: { calls: unknown[] } }).contentFixture.calls)).toEqual(screen === "credit_restored" ? [
      { name: "contentWork:control", args: { siteId: state.siteId, action: "retry", reviewToken: state.reviewToken,
        ...(screen === "credit_restored" ? { creditRetry: { jobId: "jobs:synthetic", callKey: "synthetic-private-call", token: "synthetic-private-token" } } : {}) } },
    ] : []);
  }
  if (screen === "audit_failed") {
    await page.evaluate(() => {
      const w = window as unknown as { contentFixture: { state: typeof state & { work: unknown[] } }; renderContentFixture: () => void };
      w.contentFixture.state = { ...w.contentFixture.state, ready: 0, work: [{ ...w.contentFixture.state.work[0], stage: "failed", systemFailure: true,
        technicalReason: "content_audit_clarification_inconsistent", failure: "Pentra encountered an internal processing error. Our team must repair it. Your drafts, spending history and original deadline are preserved. You do not need to change your plan or fund a provider." }] } as typeof w.contentFixture.state;
      w.renderContentFixture();
    });
    await expect(page.getByText("Schedule: Delivery paused.", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "internal processing error" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pause new work|Resume preparation|Recheck existing|Retry interrupted/ })).toHaveCount(0);
    await expect(page.getByText(/Technical reason: content_audit_/)).not.toBeVisible();
    await page.getByText("Work history and technical references", { exact: true }).click();
    await expect(page.getByText(/Technical reason: content_audit_/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { contentFixture: { calls: unknown[] } }).contentFixture.calls)).toEqual([]);
  }
  if (screen === "rollback") {
    await page.getByText("Service mode and publication consent", { exact: true }).click();
    await page.getByLabel("Service mode", { exact: true }).selectOption("legacy_articles");
    await expect(page.getByText(/Switching back pauses new work/)).toBeVisible();
    for (const status of ["pending", "needs_action", "completed"]) {
      await page.evaluate(status => {
        const f = (window as unknown as { contentFixture: { response: unknown } }).contentFixture;
        f.response = { status, changed: status === "completed", issues: status === "completed" ? [] : [{ action: "Inspect the retained delivery before checking again." }] };
      }, status);
      await page.getByRole("button", { name: status === "pending" ? "Switch back safely" : "Check service switch again" }).click();
      await expect(page.getByRole("status")).toContainText(status === "pending" ? "Switch pending" : status === "needs_action" ? "Switch needs action" : "Service selection completed");
    }
    await expect(page.getByText("Current contract: Existing fixed-article delivery.", { exact: true })).toBeVisible();
    await expect(page.getByText("Work history and technical references", { exact: true })).toBeVisible();
    const calls = await page.evaluate(() => (window as unknown as { contentFixture: { calls: { name: string; args: Record<string, unknown> }[] } }).contentFixture.calls);
    expect(calls).toHaveLength(3);
    for (const call of calls) { expect(call.name).toBe("contentWork:selectServiceMode"); expect(call.args).toMatchObject({ siteId: state.siteId, mode: "legacy_articles", confirmBusinessProfile: false, reviewToken: state.reviewToken }); expect(call.args).not.toHaveProperty("firstDeadlineAt"); }
  } else if (screen === "overview") {
    for (const name of ["Upcoming work", "Verified changes", "Organic clicks", "Needs attention"]) await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText(/Overdue/)).toBeVisible(); await expect(page.getByText(/unavailable, not zero/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as MeasurementFixtureWindow).contentFixture.measurementReads)).toBe(1);
    await page.evaluate(() => { (window as unknown as MeasurementFixtureWindow).renderContentFixture(); });
    await expect(page.getByRole("button", { name: "Refresh measurements" })).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as MeasurementFixtureWindow).contentFixture.measurementReads)).toBe(1);
    await page.evaluate(() => { (window as unknown as MeasurementFixtureWindow).contentFixture.outcome = { status: "available", current: { start: "2026-08-01", end: "2026-08-28", clicks: 0 }, previous: null, cohorts: [], property: "sc-domain:fixture.example" }; });
    await page.getByRole("button", { name: "Refresh measurements" }).click();
    await expect(page.getByText(/0 clicks ·/)).toBeVisible();
    await expect(page.getByText(/No complete previous window/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as MeasurementFixtureWindow).contentFixture.measurementReads)).toBe(2);
  } else if (screen === "controls") {
    await expect(page.getByText("Preparation: 2/2 ready.")).toBeVisible();
    await expect(page.locator("#content-funding-details")).not.toHaveAttribute("open", "");
    await expect(page.getByText(/Available internal headroom/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause new work" })).toHaveCount(0);
    const primary = await page.getByRole("button", { name: "Resume preparation and schedule" }).boundingBox();
    const funding = await page.locator("#content-funding-details summary").boundingBox();
    expect(primary!.y).toBeLessThan(funding!.y);
    await page.screenshot({ path: info.outputPath("stage30-controls-primary.png"), fullPage: true });
    await page.locator("#changed-content-setup summary").click();
    await expect(page.getByText(/cedarcare\/website, branch main/)).toBeVisible();
    await page.locator("#content-funding-details summary").click();
    await expect(page.getByText(/Provider credit balance is unverified/)).toBeVisible();
    await page.getByRole("button", { name: "Resume preparation and schedule" }).click();
    const calls = await page.evaluate(() => (window as unknown as { contentFixture: { calls: unknown[] } }).contentFixture.calls);
    expect(calls).toEqual([{ name: "contentWork:control", args: { siteId: state.siteId, action: "resume", reviewToken: state.reviewToken } }]);
  } else if (screen === "independent") {
    await expect(page.getByText(/Ordinary capacity cannot extend this separate validation allowance/)).toBeVisible();
    await page.locator("#content-funding-details summary").click();
    await expect(page.getByText(/separately approved, non-renewing \$20\.0000 validation allowance/)).toBeVisible();
    await expect(page.getByText(/ordinary account and fleet capacity is unchanged/)).toBeVisible();
    await expect(page.getByText(/Model execution is enabled only for this saved validation run, not other sites/)).toBeVisible();
    await expect(page.getByText(/Each work item retains its original pricing and spending ceiling/)).toBeVisible();
    await expect(page.getByText("Fleet limits also apply.")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { contentFixture: { calls: unknown[] } }).contentFixture.calls)).toEqual([]);
  } else if (screen === "pricing_off") {
    await expect(page.getByText("Preparation: 2/2 ready.")).toBeVisible();
    await page.locator("#content-funding-details summary").click();
    await expect(page.getByText(/Model pricing is not enabled for this site's current scope/)).toBeVisible();
    await expect(page.getByText(/Already prepared delivery and verification do not require new model calls/)).toBeVisible();
    await expect(page.getByText(/validation allowance \(stopped\)/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { contentFixture: { calls: unknown[] } }).contentFixture.calls)).toEqual([]);
  } else if (screen === "changed") {
    const confirm = page.getByRole("button", { name: "Confirm changed setup and prepare fresh work" });
    await expect(confirm).toBeDisabled();
    await expect(page.getByRole("link", { name: "Open retained delivery and owner review" })).toHaveAttribute("href", "/articles/articles:fixture");
    const check = page.getByRole("checkbox", { name: /I confirm the changed facts/ });
    await check.check(); await expect(confirm).toBeEnabled();
    await page.evaluate(() => {
      const w = window as unknown as { contentFixture: { state: { reviewToken: string } }; renderContentFixture: () => void };
      w.contentFixture.state = { ...w.contentFixture.state, reviewToken: "synthetic-new-binding" }; w.renderContentFixture();
    });
    await expect(check).not.toBeChecked(); await expect(confirm).toBeDisabled();
    await check.check(); await confirm.click();
    expect(await page.evaluate(() => (window as unknown as { contentFixture: { calls: unknown[] } }).contentFixture.calls)).toEqual([
      { name: "contentWork:reconfirm", args: { siteId: state.siteId, reviewToken: "synthetic-new-binding", confirm: true } },
    ]);
  } else if (screen === "start") {
    await expect(page.getByRole("heading", { name: "Start your content service" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify existing plan and save profile" })).toBeDisabled();
    await expect(page.getByLabel("Content publishing destination")).toHaveValue("github");
    await expect(page.getByRole("option", { name: /WordPress/ })).toHaveAttribute("disabled", "");
    await expect(page.getByText(/No automatic schedule or outreach setup is required/)).toBeVisible();
  }
  await expect(page.locator("body")).not.toContainText("synthetic-reviewed-binding");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`stage30-${screen}.png`), fullPage: true });
});
