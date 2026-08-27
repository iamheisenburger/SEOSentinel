import { expect, test } from "@playwright/test";

test("a protected product route lands inside Pentra-branded authentication", async ({ page }) => {
  await page.goto("/backlinks");
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Fbacklinks/);
  await expect(page.getByLabel("Pentra home")).toBeVisible();
  await expect(page.getByText("Product home")).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await expect(page.getByText("Autonomous SEO operations")).toBeVisible();
    await expect(page.getByText("Pentra growth loop")).toBeVisible();
  } else {
    await expect(page.getByText("Pentra workspace")).toBeVisible();
  }
});

test("sign-up remains inside the same Pentra product shell", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByLabel("Pentra home")).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await expect(page.getByText("Put search growth")).toBeVisible();
    await expect(page.getByText("Pentra growth loop")).toBeVisible();
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
    !process.env.PENTRA_E2E_AUTH_STATE,
    "Set PENTRA_E2E_AUTH_STATE to a dedicated test tenant storage state.",
  );

  test("dashboard and backlinks expose customer-visible loop state", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Growth loop")).toBeVisible();
    await page.goto("/backlinks");
    await expect(page.getByRole("heading", { name: "Backlinks" })).toBeVisible();
    await expect(page.getByText("Sending inbox")).toBeVisible();
  });
});
