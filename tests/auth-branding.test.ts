import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  authCounterpartUrl,
  postAuthDestination,
  safeAuthDestination,
} from "../src/lib/auth-redirect.ts";
import { startAuthHref } from "../src/lib/domain-input.ts";

/**
 * Regression for unbranded authentication.
 *
 * Protected routes are guarded with auth.protect(). Without an explicit
 * signInUrl, Clerk redirects to its hosted Account Portal on
 * accounts.pentra.dev, which shows a generic card with no Pentra logo, no
 * product context and a "Secured by Clerk" footer — while the branded pages
 * already existed at /sign-in and /sign-up and were never reached.
 *
 * The first screen an unauthenticated customer sees is the product.
 */

const layout = readFileSync(
  new URL("../src/app/layout.tsx", import.meta.url),
  "utf8",
);
const middleware = readFileSync(
  new URL("../src/proxy.ts", import.meta.url),
  "utf8",
);
const landingNav = readFileSync(
  new URL("../src/components/layout/landing-nav.tsx", import.meta.url),
  "utf8",
);
const sidebar = readFileSync(
  new URL("../src/components/layout/sidebar.tsx", import.meta.url),
  "utf8",
);

test("Clerk redirects to Pentra's own sign-in, never the hosted portal", () => {
  assert.match(layout, /signInUrl=["']\/sign-in["']/);
  assert.match(layout, /signUpUrl=["']\/sign-up["']/);
});

test("the branded auth pages exist and carry Pentra context", () => {
  for (const route of ["sign-in", "sign-up"] as const) {
    const page = readFileSync(
      new URL(`../src/app/${route}/[[...${route}]]/page.tsx`, import.meta.url),
      "utf8",
    );
    assert.match(page, /AuthShell/, `${route} must use the Pentra auth shell`);
    assert.match(page, /postAuthDestination/);
  }

  const shell = readFileSync(
    new URL("../src/components/auth/auth-shell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(shell, /Pentra/);
  // Nov 2026: the shell sells the AI-answer snapshot, from the shared product facts (never a hard-coded list).
  assert.match(shell, /See what AI assistants say about your business\./);
  assert.match(shell, /ASSISTANT_NAMES_SENTENCE/);
  assert.match(shell, /HONESTY_LINE/);
  assert.doesNotMatch(shell, /Autopilot SEO|More customers from Google/);
  assert.match(shell, /How Pentra works/);
  assert.match(shell, /AuthFormLoading/);
  assert.match(shell, /\/legal\/terms/);
  assert.match(shell, /\/legal\/privacy/);
});

test("middleware sends unauthenticated visitors to the branded page", () => {
  // ClerkProvider is a client component; middleware never sees its signInUrl,
  // so auth.protect() must be told explicitly or it falls back to the hosted
  // Account Portal.
  assert.match(middleware, /auth\.protect\(\{\s*unauthenticatedUrl/);
  assert.match(middleware, /new URL\(["']\/sign-in["']/);
  assert.match(middleware, /request\.nextUrl\.pathname/);
  assert.doesNotMatch(
    middleware,
    /searchParams\.set\(\s*["']redirect_url["'],\s*request\.url/,
  );
});

test("the requested protected route survives sign-in and sign-up", () => {
  assert.equal(safeAuthDestination("/backlinks"), "/backlinks");
  assert.equal(
    safeAuthDestination("/articles?status=ready#latest"),
    "/articles?status=ready#latest",
  );
  assert.equal(
    safeAuthDestination("https://pentra.dev/settings/billing"),
    "/settings/billing",
  );

  assert.equal(
    authCounterpartUrl("/sign-up", {
      redirectUrl: "/backlinks",
      plan: null,
      billing: null,
    }),
    "/sign-up?redirect_url=%2Fbacklinks",
  );
});

test("post-auth redirects cannot leave Pentra or loop through auth", () => {
  for (const unsafe of [
    "https://example.com/phish",
    "javascript:alert(1)",
    "/sign-in",
    "/sign-up/verify",
  ]) {
    assert.equal(safeAuthDestination(unsafe), "/dashboard");
  }

  assert.equal(
    postAuthDestination({
      redirectUrl: "/backlinks",
      plan: "pro",
      billing: "annual",
    }),
    "/upgrade?plan=pro&billing=annual",
  );
  assert.equal(
    postAuthDestination({
      redirectUrl: "/backlinks",
      plan: "invented",
      billing: "weekly",
    }),
    "/backlinks",
  );
});

test("every customer auth entry stays inside branded Pentra UI", () => {
  assert.doesNotMatch(landingNav, /SignInButton|SignUpButton|mode=["']modal/);
  assert.match(landingNav, /href=["']\/sign-in["']/);
  // Nov 2026: account creation starts from the free snapshot: the nav's "Check my site" opens /start, and /start
  // hands over to Pentra's own /sign-up or /sign-in (never Clerk's modal or hosted portal), coming back to /start with
  // the domain kept, so the site is created and the check continues where it left off.
  assert.match(landingNav, /href=["']\/start["']/);
  assert.equal(startAuthHref("/sign-up", "example.com"), "/sign-up?redirect_url=%2Fstart%3Fdomain%3Dexample.com");
  assert.equal(startAuthHref("/sign-in", "example.com"), "/sign-in?redirect_url=%2Fstart%3Fdomain%3Dexample.com");
  assert.equal(postAuthDestination({ redirectUrl: "/start?domain=example.com", plan: null, billing: null }), "/start?domain=example.com");
  assert.equal(authCounterpartUrl("/sign-in", { redirectUrl: "/start?domain=example.com", plan: null, billing: null }),
    "/sign-in?redirect_url=%2Fstart%3Fdomain%3Dexample.com");
  const flow = readFileSync(new URL("../src/components/answers/onboarding/start-flow.tsx", import.meta.url), "utf8");
  assert.match(flow, /startAuthHref\("\/sign-up", domain\)/);
  assert.match(flow, /startAuthHref\("\/sign-in", domain\)/);
  for (const path of ["../src/app/start/page.tsx", "../src/app/start/start-gate.tsx", "../src/components/answers/onboarding/start-flow.tsx"]) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), "utf8"), /SignUpButton|SignInButton|mode=["']modal/, path);
  }
  assert.match(landingNav, /userProfileMode=["']modal["']/);
  assert.match(sidebar, /userProfileMode=["']modal["']/);
  assert.match(layout, /afterSignOutUrl=["']\/["']/);
});

test("fallback screens remain visibly inside Pentra", () => {
  for (const route of ["not-found", "error", "global-error"] as const) {
    const page = readFileSync(
      new URL(`../src/app/${route}.tsx`, import.meta.url),
      "utf8",
    );
    assert.match(page, /BrandedErrorState/);
  }

  const fallback = readFileSync(
    new URL(
      "../src/components/layout/branded-error-state.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(fallback, /Pentra/);
  assert.match(fallback, /Back to Pentra/);
});

test("public unsubscribe confirmation and settlement remain Pentra-branded", () => {
  const route = readFileSync(
    new URL("../src/app/unsubscribe/[token]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /brandedPage/);
  assert.match(route, /<span>Pentra<\/span>/);
  assert.match(route, /Stop outreach emails/);
  assert.match(route, /You are unsubscribed/);
  assert.match(route, /Cache-Control[\s\S]*no-store/);
  assert.match(route, /frame-ancestors 'none'/);
});
