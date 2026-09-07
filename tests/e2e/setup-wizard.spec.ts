import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { newCustomerFixture, type Args } from "../helpers/new-customer-fixture.ts";

// Functional browser acceptance of the REAL layout, wizard and readiness
// components, backed by their REAL registered owner mutations in a local DB.
// Only authentication/transport and unrelated dashboard children are fixtures.
// No production endpoint, test auth bypass, OAuth grant or provider call exists.
const bundle = build({
  stdin: { contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { SetupWizard } from "./src/components/onboarding/setup-wizard";
    import { DashboardLayout } from "./src/components/layout/dashboard-layout";
    createRoot(document.getElementById("root")).render(
      <DashboardLayout><SetupWizard /></DashboardLayout>);
  `, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
  plugins: [{ name: "isolated-setup-transport", setup(builder) {
    builder.onResolve({ filter: /^(convex\/react|@clerk\/nextjs|next\/link|\.\/sidebar|\.\/over-limit-banner|@\/contexts\/site-context)$/ },
      args => ({ path: args.path, namespace: "setup-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "setup-fixture" }, args => {
      if (args.path === "convex/react") return { contents: `
        import { useSyncExternalStore } from "react";
        import { getFunctionName } from "convex/server";
        const subscribe = fn => {
          window.addEventListener("fixture-auth", fn);
          return () => window.removeEventListener("fixture-auth", fn);
        };
        export function useConvexAuth() {
          return useSyncExternalStore(subscribe, () => window.fixture.auth);
        }
        export function useQuery(ref, args) {
          if (args === "skip") return undefined;
          if (window.fixture.auth.isLoading || !window.fixture.auth.isAuthenticated)
            throw new Error("Private query mounted before authenticated Convex session");
          const name = getFunctionName(ref);
          window.fixture.queries.push({ name, args });
          if (name === "sites:getCadenceCapacity") return window.fixture.capacity;
          if (name === "sites:getOneSetupReadiness") return window.fixture.readiness;
          throw new Error("Unexpected query " + name);
        }
        export const useMutation = ref => args => window.fixtureCall(getFunctionName(ref), args);
        export const useAction = useMutation;
      `, resolveDir: process.cwd() };
      if (args.path === "@clerk/nextjs") return { contents: 'export const useAuth = () => ({userId: "customer", isLoaded: true});' };
      if (args.path === "next/link") return { contents: 'import React from "react"; export default ({children, ...props}) => React.createElement("a", props, children);', resolveDir: process.cwd() };
      return { contents: 'export const Sidebar = () => null; export const OverLimitBanner = () => null; export const SiteProvider = ({children}) => children;' };
    });
  } }],
}).then(result => result.outputFiles[0].text);

async function mount(page: Page, options: { loading?: boolean; failBillingOnce?: boolean } = {}) {
  const f = newCustomerFixture();
  const capacity = await f.run("sites", "getCadenceCapacity", {});
  const calls: Array<{ name: string; args: Args }> = [];
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.exposeBinding("fixtureCall", async (_source, name: string, args: Args) => {
    calls.push({ name, args });
    if (name === "sites:upsert") return f.run("sites", "upsert", args);
    if (name === "sites:saveOneSetupRequest") return f.run("sites", "saveOneSetupRequest", args);
    if (name === "actions/pipeline:resumeOneSetupExecution") {
      const request = f.tables.managed_provisioning_requests[0];
      expect(args).toEqual({ siteId: request.siteId, requestId: request._id,
        configurationRevision: request.configurationRevision });
      // Stop at the external-provider boundary, without claiming it was tested.
      return { state: "pending", reason: "provider_authorization_required" };
    }
    throw new Error(`Unexpected external operation ${name}`);
  });
  let billingCalls = 0;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://pentra.test");
    if (url.pathname === "/api/billing/sync-plan") {
      expect(route.request().method()).toBe("POST");
      billingCalls++;
      return route.fulfill({ status: options.failBillingOnce && billingCalls === 1 ? 503 : 200,
        contentType: "application/json", body: "{}" });
    }
    expect(url.pathname).toBe("/setup");
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><title>Isolated setup acceptance</title><style>svg{width:16px;height:16px}label{display:block;margin:8px}input,textarea{margin:4px}button{margin:4px}body{background:#08090e;color:white}</style></head><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://pentra.test/setup");
  await page.evaluate(({ capacity, loading }) => {
    Object.assign(window, { fixture: {
      auth: { isLoading: loading, isAuthenticated: !loading }, capacity, queries: [],
      readiness: {
        aggregate: { status: "action_required", readyCount: 0, totalCount: 3, percent: 0 },
        requestExists: true, publishingRolloutLive: false, configurationRevision: 1,
        stages: [{ key: "publisher", label: "Publishing", state: "action_required",
          actionRequiredBy: "owner", actionMessage: "Connect your publishing repository.",
          actionKind: "connect_publishing", actionLabel: "Connect GitHub" }],
      },
    } });
  }, { capacity, loading: Boolean(options.loading) });
  await page.addScriptTag({ content: await bundle });
  await expect.poll(async () => ({
    mounted: await page.locator("#root > *").count() > 0, errors: browserErrors,
  })).toEqual({ mounted: true, errors: [] });
  return { f, calls, browserErrors, billingCalls: () => billingCalls };
}

async function fillRequired(page: Page, cadence: number, consent = true) {
  await page.getByLabel("Website", { exact: true }).fill("https://www.customer.example/");
  await page.getByLabel("Business or product name", { exact: true }).fill("Customer");
  await page.getByLabel("Primary target country", { exact: true }).fill("Germany");
  await page.getByLabel("What the business sells and why it is different", { exact: true }).fill("Project reporting software for independent service businesses.");
  await page.getByLabel("Ideal customer", { exact: true }).fill("Owners of small service businesses");
  await page.getByLabel("How customers use it", { exact: true }).fill("Track their projects and share weekly reports.");
  await page.getByLabel("Articles per week", { exact: true }).fill(String(cadence));
  await page.getByLabel("Sender name", { exact: true }).fill("Customer Team");
  await page.getByLabel("Postal address shown in email footers", { exact: true }).fill("1 Example Street, Example City 12345, Germany");
  if (consent) {
    for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  }
}

test("new-customer UI waits for auth and saves its exact chosen cadence with a durable closed-browser wake", async ({ page }) => {
  const { f, calls, browserErrors } = await mount(page, { loading: true });
  await expect(page.getByRole("status")).toHaveText("Connecting your workspace…");
  await expect(page.getByRole("heading", { name: "Set up Pentra once" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { fixture: { queries: unknown[] } }).fixture.queries)).toEqual([]);
  await page.evaluate(() => {
    Object.assign((window as unknown as { fixture: object }).fixture, { auth: { isLoading: false, isAuthenticated: true } });
    window.dispatchEvent(new Event("fixture-auth"));
  });
  await fillRequired(page, 13, false);
  const start = page.getByRole("button", { name: /Start one setup/ });
  await expect(start).toBeDisabled();
  expect(calls).toEqual([]);
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByRole("heading", { name: "Setup progress" })).toBeVisible();
  await expect(page.getByText(/saved setup execution is pending/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Setup complete", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect GitHub", exact: true })).toBeVisible();
  expect(f.tables.sites).toHaveLength(1);
  expect(f.tables.sites[0].cadencePerWeek).toBe(13);
  expect(f.tables.sites[0].approvalRequired).toBe(false);
  expect(f.tables.sites[0].publicationAdapterVerifiedAt).toBeUndefined();
  expect(f.tables.managed_provisioning_requests[0].requestedCadencePerWeek).toBe(13);
  expect(browserErrors).toEqual([]);
  await page.close();
  const wake = f.scheduled.find(item => item.name === "oneSetupExecutions:bootstrapSavedExecution")!;
  expect(wake).toBeDefined();
  const result = await f.run("oneSetupExecutions", "bootstrapSavedExecution", wake.args);
  expect(result.state).toBe("execution_bootstrapped");
  expect(f.tables.one_setup_executions[0].requestedCadencePerWeek).toBe(13);
  expect(f.scheduled.some(item => item.name === "oneSetupExecutions:recoverScheduledResumeDispatch")).toBe(true);
  expect(f.tables.jobs).toHaveLength(0);
});

test("billing retry reuses the saved site, receipt and cadence instead of creating or planning twice", async ({ page }) => {
  const h = await mount(page, { failBillingOnce: true });
  await fillRequired(page, 21);
  await page.getByRole("button", { name: /Start one setup/ }).click();
  await expect(page.getByText(/choices were saved, but plan verification needs to be retried/)).toBeVisible();
  expect(h.calls.map(call => call.name)).toEqual(["sites:upsert", "sites:saveOneSetupRequest"]);
  const requestId = h.f.tables.managed_provisioning_requests[0]._id;
  await page.getByRole("button", { name: "Retry saved setup", exact: true }).click();
  await expect(page.getByText(/saved setup execution is pending/)).toBeVisible();
  expect(h.calls.map(call => call.name)).toEqual([
    "sites:upsert", "sites:saveOneSetupRequest", "actions/pipeline:resumeOneSetupExecution",
  ]);
  expect(h.calls.at(-1)?.args.requestId).toBe(requestId);
  expect(h.f.tables.sites).toHaveLength(1);
  expect(h.f.tables.managed_provisioning_requests).toHaveLength(1);
  expect(h.f.tables.sites[0].cadencePerWeek).toBe(21);
  expect(h.billingCalls()).toBe(2);
  expect(h.browserErrors).toEqual([]);
});

test("invalid cadence and unavailable publishing adapters cannot be submitted by a new customer", async ({ page }) => {
  const h = await mount(page);
  await fillRequired(page, 7);
  for (const adapter of ["WordPress", "Signed webhook", "Managed sender"]) {
    await expect(page.getByRole("button", { name: new RegExp(adapter) })).toBeDisabled();
  }
  for (const value of ["0", "22", "-1", "", "1.5"]) {
    await page.getByLabel("Articles per week", { exact: true }).fill(value);
    await expect(page.getByRole("button", { name: /Start one setup/ })).toBeDisabled();
  }
  await expect(page.getByLabel("Articles per week", { exact: true })).toHaveValue("1.5");
  await expect(page.getByRole("alert")).toContainText("Choose a whole-number target cadence from 1 to 21 articles per week.");
  for (let cadence = 1; cadence <= 21; cadence++) {
    await page.getByLabel("Articles per week", { exact: true }).fill(String(cadence));
    await expect(page.getByLabel("Articles per week", { exact: true })).toHaveValue(String(cadence));
    await expect(page.getByRole("button", { name: /Start one setup/ })).toBeEnabled();
  }
  expect(h.calls).toEqual([]);
  expect(h.browserErrors).toEqual([]);
});
