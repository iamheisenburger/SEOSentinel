import { expect, test, type Page } from "@playwright/test";

// The Pentra Answers onboarding and dashboard, clicked through in the dev-only harness (synthetic data shaped like
// ops/design/answers-api.md; /e2e-acceptance returns 404 in production and on every other host).
const H = "/e2e-acceptance/answers";

async function openSheetAndClose(page: Page) {
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
}

test("a new account confirms what Pentra read, watches the first hour and lands on its snapshot and drafts", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`${H}/understood~free~live/start?site=site_kettlewood`);
  await expect(page.getByRole("heading", { name: "Here’s what we understood" })).toBeVisible();
  await page.getByRole("button", { name: "Remove Lone Star Deck & Fence" }).click();
  await page.getByPlaceholder("Name or website, like cedarrow.com").fill("greenline.com");
  await page.getByPlaceholder("Name or website, like cedarrow.com").press("Enter");
  await expect(page.getByRole("list", { name: "Competitors" })).toContainText("Greenline");
  await page.getByRole("button", { name: "Looks right. Ask the assistants" }).click();

  await expect(page.getByRole("heading", { name: /Asking the assistants about Kettlewood Decks/ })).toBeVisible();
  await expect(page.getByText("Safe to close this tab. We'll email you when it's ready.")).toBeVisible();
  await expect(page.getByText("Answers as they arrive · newest first")).toBeVisible({ timeout: 15_000 });

  await expect(page.getByRole("heading", { name: /What AI assistants say about Kettlewood Decks/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Named in/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Upgrade" })).toContainText("Publish these");

  await page.getByRole("tab", { name: /Draft pages/ }).click();
  await expect(page.getByText("Draft · not published").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: /Austin deck builders with fixed-price quotes/ }).click();
  await expect(page.getByText("Facts used · 5")).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Title").fill("Fixed-price deck builders in Austin");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Saved. Your words are kept exactly as written.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixed-price deck builders in Austin", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Publish with Pentra" }).first()).toHaveAttribute("href", `${H}/understood~free~live/upgrade`);
});

test("every count in the snapshot opens the answers behind it, and Raw shows the answer as given", async ({ page }) => {
  await page.goto(`${H}/drafts~free/start?site=site_kettlewood`);
  await page.getByRole("button", { name: /answers named Kettlewood Decks\. Open them\./ }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Answers naming Kettlewood Decks" })).toBeVisible();
  await expect(sheet.getByText(/Named you/).first()).toBeVisible();
  await sheet.getByRole("button", { name: "Raw" }).first().click();
  await expect(sheet.getByRole("button", { name: "Copy the answer as given" })).toBeVisible();
  await sheet.getByRole("button", { name: "Back" }).click();
  await expect(sheet.getByRole("heading", { name: "Answers naming Kettlewood Decks" })).toBeVisible();
  await openSheetAndClose(page);
});

test("signed out, /start keeps the domain through Pentra's own sign-up", async ({ page }) => {
  await page.goto(`${H}/reading~free~signed-out/start?domain=kettlewooddecks.com`);
  await expect(page.getByRole("heading", { name: "Create your account to check kettlewooddecks.com" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Create free account/ })).toHaveAttribute("href", "/sign-up?redirect_url=%2Fstart%3Fdomain%3Dkettlewooddecks.com");
  await expect(page.getByRole("link", { name: "I have an account" })).toHaveAttribute("href", "/sign-in?redirect_url=%2Fstart%3Fdomain%3Dkettlewooddecks.com");
});

test("the dashboard: questions open their evidence, drafts publish, failures retry, the plan's run spacing is said", async ({ page }) => {
  await page.goto(`${H}/dashboard~paid/dashboard`);
  await expect(page.getByText(/^Named in 13 of 146 answers\./)).toBeVisible();
  await page.getByRole("button", { name: "Ask again now" }).click();
  await expect(page.getByText("The assistants were asked less than six hours ago. Try again later.")).toBeVisible();

  await page.goto(`${H}/dashboard~paid/dashboard/questions`);
  await expect(page.getByRole("heading", { name: "Questions", level: 1 })).toBeVisible();
  await page.getByPlaceholder(/Add a question your buyers ask/).fill("Is Kettlewood Decks any good?");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("Write it as one question your buyers would ask, without your business's name.")).toBeVisible();
  await page.getByPlaceholder(/Add a question your buyers ask/).fill("Do composite decks fade in the Texas sun?");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("Added. Pentra asks it in the next run.")).toBeVisible();
  await page.getByRole("radio", { name: /Winnable/ }).click();
  await page.getByRole("button", { name: "Pressure-treated pine or cedar for a deck in Austin?", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Every answer to this question")).toBeVisible();
  await openSheetAndClose(page);

  await page.goto(`${H}/dashboard~paid/dashboard/pages`);
  await page.getByRole("tab", { name: /Drafts/ }).click();
  await expect(page.getByText(/GitHub refused the commit \(403\)/)).toBeVisible();
  await page.getByRole("button", { name: "Retry publish" }).click();
  await expect(page.getByText("Publishing. The row updates when it's live.")).toBeVisible();
  await page.getByRole("tab", { name: /Published/ }).click();
  await expect(page.getByText("Composite decking brands that handle Texas heat")).toBeVisible({ timeout: 10_000 });
});

test("settings: the hosted address shows its DNS record; a WordPress connection is saved and checked", async ({ page }) => {
  await page.goto(`${H}/new-plan~paid/dashboard/settings`);
  await expect(page.getByText("Not connected. Pages wait in Drafts until they have somewhere to go.")).toBeVisible();
  await page.getByRole("radio", { name: /answers\.kettlewooddecks\.com/ }).click();
  await page.getByRole("button", { name: "Use answers.kettlewooddecks.com" }).click();
  await expect(page.getByRole("cell", { name: "CNAME", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "cname.vercel-dns.com" })).toBeVisible();
  await expect(page.getByText("Waiting for DNS").first()).toBeVisible();

  await page.getByRole("radio", { name: /Your site's blog/ }).click();
  await page.getByRole("radio", { name: "WordPress", exact: true }).click();
  await page.getByLabel("WordPress address").fill("https://kettlewooddecks.com");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Application password").fill("abcd efgh ijkl mnop");
  await page.getByRole("button", { name: "Save and check" }).click();
  await expect(page.getByText("Checked: Pentra can publish here.")).toBeVisible();
  await expect(page.getByText(/Publishing to kettlewooddecks\.com \(WordPress\)/)).toBeVisible();
});

test("an articles site keeps its dashboard and can switch to Pentra Answers after confirming", async ({ page }) => {
  await page.goto(`${H}/dashboard~paid~legacy/dashboard`);
  await page.getByRole("button", { name: "Switch to Pentra Answers" }).click();
  await expect(page.getByRole("dialog", { name: /Switch oakhollowirrigation\.com to Pentra Answers\?/ })).toBeVisible();
  await page.getByRole("button", { name: "Switch this site" }).click();
  await expect(page).toHaveURL(/\/start\?site=site_oakhollow$/);
  await expect(page.getByRole("heading", { name: /Reading oakhollowirrigation\.com|Here’s what we understood/ })).toBeVisible();
});

test("the sidebar moves between the dashboard's screens and marks where you are", async ({ page, isMobile }) => {
  test.skip(isMobile, "the phone menu has its own test");
  await page.goto(`${H}/dashboard~paid/dashboard`);
  await page.getByRole("link", { name: "Competitors" }).click();
  await expect(page.getByRole("heading", { name: "Competitors", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Competitors" })).toHaveAttribute("aria-current", "page");
});

test("on a phone the dashboard menu opens and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${H}/dashboard~paid/dashboard`);
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Citations" }).click();
  await expect(page.getByRole("heading", { name: "Citations", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
