import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PENTRA_E2E_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    storageState: process.env.PENTRA_E2E_AUTH_STATE || undefined,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.PENTRA_E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
        url: `${baseURL}/unsubscribe/${"A".repeat(43)}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          NEXT_PUBLIC_CONVEX_URL:
            process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://example.convex.cloud",
          NEXT_PUBLIC_SITE_URL:
            process.env.NEXT_PUBLIC_SITE_URL ?? "https://pentra.dev",
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
            process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
            "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
          CLERK_SECRET_KEY:
            process.env.CLERK_SECRET_KEY ??
            "sk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
        },
      },
});
