import { expect, test } from "@playwright/test";

test("a protected product route lands inside Pentra-branded authentication", async ({ page }) => {
  await page.goto("/backlinks");
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Fbacklinks/);
  await expect(page.getByLabel("Pentra home")).toBeVisible();
  await expect(page.getByText("Product home")).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await expect(page.getByText("SEO articles you approve")).toBeVisible();
    await expect(page.getByText("How Pentra works")).toBeVisible();
  } else {
    await expect(page.getByText("Pentra workspace")).toBeVisible();
  }
});

test("sign-up remains inside the same Pentra product shell", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByLabel("Pentra home")).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await expect(page.getByText("Accurate SEO articles,")).toBeVisible();
    await expect(page.getByText("How Pentra works")).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  }
});

test("unsubscribe is branded, confirmation-first, and never cacheable", async ({ page }) => {
  const response = await page.goto(`/unsubscribe/${"A".repeat(43)}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page.getByText("Pentra", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stop outreach emails" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unsubscribe" })).toBeVisible();
});

test("invalid OAuth returns stay branded and fail closed", async ({ page }) => {
  for (const [path, title, error] of [
    ["/api/github/callback", "Pentra - GitHub", "Authorization failed"],
    ["/api/gsc/callback", "Pentra - Search Console", "Authorization failed"],
    ["/api/outreach/gmail/callback", "Pentra Gmail", "authorization failed"],
  ] as const) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(400);
    await expect(page).toHaveTitle(title);
    await expect(page.getByText(new RegExp(error))).toBeVisible();
  }
});

test("One Setup exposes bootstrap-v1 adapters and visibly gates managed beta choices", async ({ page }) => {
  await page.goto("/e2e-acceptance/one-setup");
  await expect(page.getByRole("heading", { name: "Set up Pentra once" })).toBeVisible();
  for (const label of ["GitHub", "Gmail", "SMTP"]) {
    const choice = page.getByRole("button", { name: new RegExp(label) });
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(choice).toHaveClass(/border-\[#0EA5E9\]/);
  }
  for (const label of ["WordPress", "Signed webhook", "Managed sender"]) {
    const choice = page.getByRole("button", { name: new RegExp(label) });
    await expect(choice).toBeVisible();
    await expect(choice).toBeDisabled();
  }
  await expect(page.getByText(/mandatory approval mode/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Start one setup/ })).toBeDisabled();
});

test.describe("authenticated, read-only customer acceptance", () => {
  test.skip(
    !process.env.PENTRA_E2E_AUTH_STATE || !process.env.PENTRA_E2E_CONTENT_SITE_ID,
    "Requires a reviewed deployed candidate, an authorized owner session (PENTRA_E2E_AUTH_STATE), and exact PENTRA_E2E_CONTENT_SITE_ID. Synthetic fixtures do not satisfy this gate.",
  );

  test("exact-site owner sees content readiness and page controls", async ({ page }) => {
    const siteId = process.env.PENTRA_E2E_CONTENT_SITE_ID!;
    const authorizedDomains: Record<string, string> = {
      jh74txye54jna4t85m6y7p4d6h82v9ab: "pentra.dev",
      jh7cccny67df67rdm4jp65tmtn8am982: "leadpilot.chat",
    };
    expect(authorizedDomains[siteId], "Use only an explicitly authorized production tenant").toBeTruthy();
    await page.goto(`/sites/${encodeURIComponent(siteId)}?tab=settings`);
    await expect(page).not.toHaveURL(/\/sign-in/);
    await expect(page.getByText(new RegExp(`^${authorizedDomains[siteId].replaceAll(".", "\\.")}(?: · .+)?$`)).first()).toBeVisible();
    await page.goto("/settings");
    const service = page.getByRole("region", { name: "Content delivery service" });
    await expect(service).toHaveAttribute("data-content-site-id", siteId);
    await expect(service.getByRole("link", { name: authorizedDomains[siteId], exact: true })).toHaveAttribute("href", `/sites/${siteId}?tab=settings`);
    const funding = service.locator("#content-funding-details");
    await funding.locator("summary", { hasText: "Funding readiness and retained spending" }).click();
    await expect(funding).toHaveAttribute("open", "");
    await expect(funding.getByText(/Account monthly limit.*settled actual spend.*retained reservations/)).toBeVisible();
    await expect(funding.getByText(/Provider credit balance is unverified/)).toBeVisible();
    await expect(service.getByRole("heading", { name: "Pages Pentra may improve" })).toBeVisible();
  });
});
